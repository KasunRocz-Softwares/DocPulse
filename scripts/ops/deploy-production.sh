#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
root_dir=$(cd -- "$script_dir/../.." && pwd)
cd "$root_dir"
if ! command -v curl >/dev/null 2>&1; then
  echo 'curl is required for production deployment smoke checks.' >&2
  exit 64
fi
if ! command -v jq >/dev/null 2>&1; then
  echo 'jq is required for production deployment smoke checks.' >&2
  exit 64
fi
"$script_dir/production-preflight.sh"

backup_dir=${RDPS_BACKUP_DIRECTORY:?set RDPS_BACKUP_DIRECTORY to durable, access-controlled backup storage}
for utility in flock mktemp restic sha256sum pg_restore tar; do
  command -v "$utility" >/dev/null || {
    echo "$utility is required for a verified off-site pre-migration backup." >&2
    exit 69
  }
done
mkdir -p -- "$backup_dir"
backup_dir=$(cd -- "$backup_dir" && pwd -P)
[[ "$backup_dir" != / ]] || { echo 'RDPS_BACKUP_DIRECTORY cannot be the filesystem root.' >&2; exit 64; }
umask 077
lock_file=${RDPS_BACKUP_LOCK_FILE:-"$backup_dir/.rdps-backup.lock"}
exec 9>"$lock_file"
if ! flock --nonblock 9; then
  echo 'Another RDPS backup or production deployment is already running.' >&2
  exit 75
fi

compose=(docker compose --file docker-compose.production.yml)
release_compose=("${compose[@]}" --profile release)
"${release_compose[@]}" pull \
  postgres redis clamav api worker web migrate prometheus alertmanager \
  postgres-exporter redis-exporter blackbox-exporter node-exporter
"${release_compose[@]}" run --rm --no-deps --entrypoint /bin/promtool \
  prometheus check config /etc/prometheus/prometheus.yml
"${release_compose[@]}" run --rm --no-deps --entrypoint /bin/blackbox_exporter \
  blackbox-exporter --config.check --config.file=/etc/blackbox/blackbox.yml
"${release_compose[@]}" run --rm --no-deps alertmanager /bin/amtool \
  check-config /tmp/alertmanager.yml
attachment_volume=${RDPS_ATTACHMENTS_VOLUME_NAME:-rdps-production-attachments}
if ! docker volume inspect "$attachment_volume" >/dev/null 2>&1; then
  if [[ "${RDPS_INITIAL_DEPLOYMENT:-NO}" != "YES" ]]; then
    echo 'Attachment volume is missing. Set RDPS_INITIAL_DEPLOYMENT=YES only for a genuinely new installation.' >&2
    exit 66
  fi
  docker volume create \
    --label "com.docker.compose.project=${COMPOSE_PROJECT_NAME:-rdps-production}" \
    --label 'com.docker.compose.volume=rdps_production_attachments' \
    "$attachment_volume" >/dev/null
  echo "Created the explicitly authorized empty attachment volume: $attachment_volume"
fi
if [[ "${RDPS_INITIAL_DEPLOYMENT:-NO}" == YES ]]; then
  "${compose[@]}" up --detach --wait postgres redis
fi
backup_output=
if ! backup_output=$(RDPS_BACKUP_DIRECTORY="$backup_dir" \
  RDPS_BACKUP_LOCK_FILE="$lock_file" \
  RDPS_COMPOSE_FILE="$root_dir/docker-compose.production.yml" \
  "$script_dir/backup-production.sh" --lock-held 2>&1); then
  printf '%s\n' "$backup_output" >&2
  exit 1
fi
printf '%s\n' "$backup_output"
backup_run_directory=$(printf '%s\n' "$backup_output" | sed -n 's/^RDPS_BACKUP_RUN_DIRECTORY=//p' | tail -n 1)
[[ -n "$backup_run_directory" && -f "$backup_run_directory/manifest.txt" ]] || {
  echo 'The completed backup did not report its recovery directory and manifest.' >&2
  exit 65
}
case "$backup_run_directory" in
  "$backup_dir"/rdps-backup-*) ;;
  *) echo 'Backup recovery directory is outside the protected backup root.' >&2; exit 65 ;;
esac
snapshot_id=$(sed -n 's/^snapshot_id=//p' "$backup_run_directory/manifest.txt" | tail -n 1)
[[ "$snapshot_id" =~ ^[a-f0-9]{64}$ ]] || {
  echo 'The completed backup has no valid authenticated Restic snapshot ID.' >&2
  exit 65
}

previous_api=
previous_worker=
previous_web=
previous_alertmanager=
capture_previous_image() {
  local service=$1
  local result_variable=$2
  local container_ids
  local container_id
  local image=
  container_ids=$("${compose[@]}" ps -q "$service")
  if [[ -z "$container_ids" ]]; then
    if [[ "${RDPS_INITIAL_DEPLOYMENT:-NO}" == YES ]]; then
      printf -v "$result_variable" '%s' ''
      return 0
    fi
    echo "Could not capture the currently deployed image for $service." >&2
    return 1
  fi
  while IFS= read -r container_id; do
    [[ -n "$container_id" ]] || continue
    local current_image
    current_image=$(docker inspect --format '{{.Config.Image}}' "$container_id")
    [[ "$current_image" =~ @sha256:[a-f0-9]{64}$ ]] || {
      echo "Current $service image is not digest-pinned; refusing to record an unsafe rollback: $current_image" >&2
      return 1
    }
    if [[ -n "$image" && "$image" != "$current_image" ]]; then
      echo "Current $service containers use mixed images; refusing to record an ambiguous rollback." >&2
      return 1
    fi
    image=$current_image
  done <<< "$container_ids"
  printf -v "$result_variable" '%s' "$image"
}
image=
capture_previous_image api previous_api
image=
capture_previous_image worker previous_worker
image=
capture_previous_image web previous_web
image=
capture_previous_image alertmanager previous_alertmanager
previous_images_json=$(jq --null-input \
  --arg api "$previous_api" \
  --arg worker "$previous_worker" \
  --arg web "$previous_web" \
  --arg alertmanager "$previous_alertmanager" \
  '{api: $api, worker: $worker, web: $web, alertmanager: $alertmanager}')
release_state="$backup_run_directory/release-state.json"
jq --null-input \
  --arg release_tag "$RDPS_IMAGE_TAG" \
  --arg source_commit "$(jq --raw-output '.source_commit' "$RDPS_RELEASE_MANIFEST")" \
  --arg backup_directory "$backup_run_directory" \
  --arg restic_snapshot_id "$snapshot_id" \
  --argjson previous_images "$previous_images_json" \
  --arg api "$RDPS_API_IMAGE" \
  --arg worker "$RDPS_WORKER_IMAGE" \
  --arg migrate "$RDPS_MIGRATE_IMAGE" \
  --arg web "$RDPS_WEB_IMAGE" \
  --arg alertmanager "$RDPS_ALERTMANAGER_IMAGE" \
  '{schema_version: 1, release_tag: $release_tag, source_commit: $source_commit,
    backup_directory: $backup_directory, restic_snapshot_id: $restic_snapshot_id,
    previous_images: $previous_images,
    candidate_images: {api: $api, worker: $worker, migrate: $migrate, web: $web, alertmanager: $alertmanager}}' \
  > "$release_state"
chmod 600 -- "$release_state"
echo "Recorded previous runtime images and backup snapshot in $release_state"

"${release_compose[@]}" run --rm migrate
"${compose[@]}" up -d --remove-orphans postgres redis api worker web prometheus alertmanager postgres-exporter redis-exporter blackbox-exporter node-exporter
"${compose[@]}" up -d --wait --force-recreate --no-deps prometheus alertmanager blackbox-exporter

smoke_output=
for attempt in {1..30}; do
  if smoke_output=$(RDPS_PRODUCTION_COMPOSE_FILE="$root_dir/docker-compose.production.yml" \
    "$script_dir/production-smoke-check.sh" 2>&1); then
    printf '%s\n' "$smoke_output"
    echo 'Production smoke checks passed.'
    exit 0
  fi
  if (( attempt < 30 )); then sleep 2; fi
done
printf '%s\n' "$smoke_output" >&2
echo 'Post-deployment smoke checks failed. Preserve logs and follow the rollback runbook.' >&2
"${compose[@]}" ps >&2
exit 1
