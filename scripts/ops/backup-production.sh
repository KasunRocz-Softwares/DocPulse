#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
root_dir=$(cd -- "$script_dir/../.." && pwd)
cd -- "$root_dir"

record_preflight_failure() {
  local exit_code=$?
  local file=${RDPS_BACKUP_METRICS_FILE:-}
  local expected=${RDPS_BACKUP_EXPECTED_INTERVAL_SECONDS:-86400}
  local previous_success=0
  local current_time
  local temporary_file
  local directory

  (( exit_code != 0 )) || return 0
  [[ "$file" == /* || "$file" =~ ^[A-Za-z]:[/\\] ]] || return 0
  directory=$(dirname -- "$file")
  [[ -d "$directory" && -w "$directory" ]] || return 0
  command -v mktemp >/dev/null 2>&1 || return 0
  [[ "$expected" =~ ^[1-9][0-9]{0,8}$ ]] || expected=86400
  if [[ -f "$file" ]]; then
    while read -r metric_name metric_value _; do
      if [[ "$metric_name" == rdps_backup_last_success_timestamp_seconds && "$metric_value" =~ ^[0-9]+$ ]]; then
        previous_success=$metric_value
        break
      fi
    done < "$file"
  fi
  current_time=$(date +%s)
  temporary_file=$(mktemp -- "$file.preflight.XXXXXXXX") || return 0
  {
    printf '# HELP rdps_backup_last_run_timestamp_seconds Unix timestamp of the latest RDPS backup job.\n'
    printf '# TYPE rdps_backup_last_run_timestamp_seconds gauge\n'
    printf 'rdps_backup_last_run_timestamp_seconds %s\n' "$current_time"
    printf '# HELP rdps_backup_last_run_success Whether the latest complete backup and retention job succeeded.\n'
    printf '# TYPE rdps_backup_last_run_success gauge\n'
    printf 'rdps_backup_last_run_success 0\n'
    printf '# HELP rdps_backup_last_upload_success Whether the latest run uploaded an authenticated snapshot.\n'
    printf '# TYPE rdps_backup_last_upload_success gauge\n'
    printf 'rdps_backup_last_upload_success 0\n'
    printf '# HELP rdps_backup_last_success_timestamp_seconds Unix timestamp of the latest successful off-site upload.\n'
    printf '# TYPE rdps_backup_last_success_timestamp_seconds gauge\n'
    printf 'rdps_backup_last_success_timestamp_seconds %s\n' "$previous_success"
    printf '# HELP rdps_backup_retention_success Whether Restic retention completed successfully on the latest run.\n'
    printf '# TYPE rdps_backup_retention_success gauge\n'
    printf 'rdps_backup_retention_success 0\n'
    printf '# HELP rdps_backup_expected_interval_seconds Approved expected interval between successful RDPS backups.\n'
    printf '# TYPE rdps_backup_expected_interval_seconds gauge\n'
    printf 'rdps_backup_expected_interval_seconds %s\n' "$expected"
  } > "$temporary_file" || return 0
  chmod 644 -- "$temporary_file" && mv -f -- "$temporary_file" "$file"
}
trap record_preflight_failure EXIT

lock_held=false
if [[ $# -gt 1 || ( $# -eq 1 && "$1" != --lock-held ) ]]; then
  echo "Usage: $0 [--lock-held]" >&2
  exit 64
fi
if [[ $# -eq 1 ]]; then lock_held=true; fi
backup_root=${RDPS_BACKUP_DIRECTORY:?set RDPS_BACKUP_DIRECTORY to protected durable staging storage}
compose_file=${RDPS_COMPOSE_FILE:-"$root_dir/docker-compose.production.yml"}
compose=(docker compose --file "$compose_file")
metrics_file=${RDPS_BACKUP_METRICS_FILE:?set RDPS_BACKUP_METRICS_FILE to the Node Exporter textfile path}
expected_interval=${RDPS_BACKUP_EXPECTED_INTERVAL_SECONDS:?set the approved expected backup interval in seconds}

for utility in docker flock mktemp restic jq sha256sum pg_restore tar; do
  command -v "$utility" >/dev/null || {
    echo "$utility is required for the production backup job." >&2
    exit 69
  }
done
[[ "${RESTIC_REPOSITORY:-}" == s3:* ]] || {
  echo 'RESTIC_REPOSITORY must use an S3-compatible Restic repository (s3:...).' >&2
  exit 64
}
restic_password=${RESTIC_PASSWORD:-}
[[ -n "$restic_password" && ${#restic_password} -ge 20 ]] || {
  echo 'RESTIC_PASSWORD must contain at least 20 characters.' >&2
  exit 64
}
[[ -f "$compose_file" ]] || { echo "Production Compose file not found: $compose_file" >&2; exit 66; }
[[ ( "$metrics_file" == /* || "$metrics_file" =~ ^[A-Za-z]:[/\\] ) && "$metrics_file" == *.prom && "$metrics_file" != *"/../"* && "$metrics_file" != *"\\..\\"* ]] || {
  echo 'RDPS_BACKUP_METRICS_FILE must be an absolute .prom path without parent traversal.' >&2
  exit 64
}
[[ "$expected_interval" =~ ^[1-9][0-9]{0,8}$ ]] || {
  echo 'RDPS_BACKUP_EXPECTED_INTERVAL_SECONDS must be a positive integer in seconds.' >&2
  exit 64
}
metrics_directory=$(dirname -- "$metrics_file")
[[ -d "$metrics_directory" && -w "$metrics_directory" ]] || {
  echo "Node Exporter textfile directory must exist and be writable: $metrics_directory" >&2
  exit 73
}

mkdir -p -- "$backup_root"
backup_root=$(cd -- "$backup_root" && pwd -P)
[[ "$backup_root" != / ]] || { echo 'RDPS_BACKUP_DIRECTORY cannot be the filesystem root.' >&2; exit 64; }
umask 077
lock_file=${RDPS_BACKUP_LOCK_FILE:-"$backup_root/.rdps-backup.lock"}
if [[ "$lock_held" == true ]]; then
  [[ -f "$lock_file" ]] || {
    echo 'The deployment lock was not found; refusing to run without serialization.' >&2
    exit 75
  }
else
  exec 9>"$lock_file"
  if ! flock --nonblock 9; then
    echo 'Another RDPS production backup or deployment is already running; this run was not started.' >&2
    exit 75
  fi
fi

stamp=$(date -u +%Y%m%dT%H%M%SZ)
run_directory=$(mktemp -d -- "$backup_root/rdps-backup-$stamp-XXXXXXXX")
chmod 700 -- "$run_directory"
started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
status_file="$run_directory/job-status.txt"
write_job_status() {
  local state=$1
  local exit_code=$2
  local temp="$status_file.partial"
  {
    printf 'started_at=%s\n' "$started_at"
    printf 'finished_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'status=%s\n' "$state"
    printf 'exit_code=%s\n' "$exit_code"
  } > "$temp"
  chmod 600 -- "$temp"
  mv -- "$temp" "$status_file"
}
write_backup_metrics() {
  local state=$1
  local exit_code=$2
  local previous_success=0
  local upload_success=0
  local retention_success=0
  local run_success=0
  local current_time
  local metric_tmp="$metrics_file.$$.tmp"

  if [[ -f "$metrics_file" ]]; then
    while read -r metric_name metric_value _; do
      if [[ "$metric_name" == rdps_backup_last_success_timestamp_seconds && "$metric_value" =~ ^[0-9]+$ ]]; then
        previous_success=$metric_value
        break
      fi
    done < "$metrics_file"
  fi
  if [[ -f "$run_directory/manifest.txt" ]]; then
    while IFS='=' read -r manifest_key manifest_value; do
      case "$manifest_key:$manifest_value" in
        upload_status:succeeded) upload_success=1 ;;
        retention_status:applied) retention_success=1 ;;
      esac
    done < "$run_directory/manifest.txt"
  fi
  current_time=$(date +%s)
  if (( upload_success == 1 )); then previous_success=$current_time; fi
  if [[ "$state" == completed && "$exit_code" == 0 ]]; then run_success=1; fi

  {
    printf '# HELP rdps_backup_last_run_timestamp_seconds Unix timestamp of the latest RDPS backup job.\n'
    printf '# TYPE rdps_backup_last_run_timestamp_seconds gauge\n'
    printf 'rdps_backup_last_run_timestamp_seconds %s\n' "$current_time"
    printf '# HELP rdps_backup_last_run_success Whether the latest complete backup and retention job succeeded.\n'
    printf '# TYPE rdps_backup_last_run_success gauge\n'
    printf 'rdps_backup_last_run_success %s\n' "$run_success"
    printf '# HELP rdps_backup_last_upload_success Whether the latest run uploaded an authenticated snapshot.\n'
    printf '# TYPE rdps_backup_last_upload_success gauge\n'
    printf 'rdps_backup_last_upload_success %s\n' "$upload_success"
    printf '# HELP rdps_backup_last_success_timestamp_seconds Unix timestamp of the latest successful off-site upload.\n'
    printf '# TYPE rdps_backup_last_success_timestamp_seconds gauge\n'
    printf 'rdps_backup_last_success_timestamp_seconds %s\n' "$previous_success"
    printf '# HELP rdps_backup_retention_success Whether Restic retention completed successfully on the latest run.\n'
    printf '# TYPE rdps_backup_retention_success gauge\n'
    printf 'rdps_backup_retention_success %s\n' "$retention_success"
    printf '# HELP rdps_backup_expected_interval_seconds Approved expected interval between successful RDPS backups.\n'
    printf '# TYPE rdps_backup_expected_interval_seconds gauge\n'
    printf 'rdps_backup_expected_interval_seconds %s\n' "$expected_interval"
  } > "$metric_tmp"
  chmod 644 -- "$metric_tmp"
  mv -f -- "$metric_tmp" "$metrics_file"
}
record_job_status() {
  local exit_code=$?
  if (( exit_code == 0 )); then
    write_job_status completed 0
    write_backup_metrics completed 0
  else
    write_job_status failed "$exit_code"
    write_backup_metrics failed "$exit_code"
    echo "Backup failed; local recovery artifacts and status were preserved in $run_directory." >&2
  fi
}
trap record_job_status EXIT
write_job_status running 0
echo "Writing coordinated backup artifacts to $run_directory"

require_healthy_service() {
  local service=$1
  local container_ids
  local container_id
  local health

  container_ids=$("${compose[@]}" ps -q "$service")
  [[ -n "$container_ids" ]] || {
    echo "Required production service is not running: $service" >&2
    return 1
  }
  while IFS= read -r container_id; do
    [[ -n "$container_id" ]] || continue
    health=$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}unhealthy{{end}}' "$container_id")
    [[ "$health" == 'running healthy' ]] || {
      echo "Required production service is not healthy: $service" >&2
      return 1
    }
  done <<< "$container_ids"
}

require_healthy_service postgres
require_healthy_service redis
RDPS_PG_DUMP_VIA_COMPOSE=1 RDPS_COMPOSE_FILE="$compose_file" \
  "$root_dir/scripts/operations/backup-postgres.sh" "$run_directory"
"$root_dir/scripts/operations/backup-attachments-volume.sh" "$run_directory"
"$root_dir/scripts/operations/backup-offsite.sh" "$run_directory"

printf 'RDPS production backup completed in %s.\n' "$run_directory"
printf 'RDPS_BACKUP_RUN_DIRECTORY=%s\n' "$run_directory"
