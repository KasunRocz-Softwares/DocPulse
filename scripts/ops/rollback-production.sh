#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
root_dir=$(cd -- "$script_dir/../.." && pwd)
cd "$root_dir"
if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <release-state.json>" >&2
  exit 64
fi
state_file=$1
backup_root=${RDPS_BACKUP_DIRECTORY:?set RDPS_BACKUP_DIRECTORY to protected durable backup storage}
compose=(docker compose --file "${RDPS_PRODUCTION_COMPOSE_FILE:-$root_dir/docker-compose.production.yml}")

for utility in docker flock jq curl; do
  command -v "$utility" >/dev/null || {
    echo "$utility is required for a locked application rollback." >&2
    exit 69
  }
done
[[ -f "$state_file" && -r "$state_file" ]] || {
  echo "Release state file is missing or unreadable: $state_file" >&2
  exit 66
}
backup_root=$(cd -- "$backup_root" && pwd -P)
state_directory=$(cd -- "$(dirname -- "$state_file")" && pwd -P)
case "$state_directory" in
  "$backup_root"/rdps-backup-*) ;;
  *) echo 'Release state must be inside a protected backup run directory.' >&2; exit 64 ;;
esac
[[ -f "$state_directory/manifest.txt" ]] || {
  echo 'Release state has no adjacent verified backup manifest.' >&2
  exit 65
}
snapshot_id=$(sed -n 's/^snapshot_id=//p' "$state_directory/manifest.txt" | tail -n 1)
if ! jq --exit-status --arg snapshot "$snapshot_id" '
  .schema_version == 1 and
  .restic_snapshot_id == $snapshot and
  ($snapshot | test("^[a-f0-9]{64}$")) and
  (.previous_images | type == "object" and
    all([.api, .worker, .web, .alertmanager][];
      type == "string" and test("^[a-z0-9.-]+(:[0-9]+)?/[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)+@sha256:[a-f0-9]{64}$")))
' "$state_file" >/dev/null; then
  echo 'Release state is incomplete, has no prior runtime image set, or does not match its verified backup snapshot.' >&2
  exit 65
fi

mkdir -p -- "$backup_root"
lock_file=${RDPS_BACKUP_LOCK_FILE:-"$backup_root/.rdps-backup.lock"}
umask 077
exec 9>"$lock_file"
if ! flock --nonblock 9; then
  echo 'Another RDPS backup, deployment, or rollback is already running.' >&2
  exit 75
fi

export RDPS_API_IMAGE=$(jq --raw-output '.previous_images.api' "$state_file")
export RDPS_WORKER_IMAGE=$(jq --raw-output '.previous_images.worker' "$state_file")
export RDPS_WEB_IMAGE=$(jq --raw-output '.previous_images.web' "$state_file")
export RDPS_ALERTMANAGER_IMAGE=$(jq --raw-output '.previous_images.alertmanager' "$state_file")
release_tag=$(jq --raw-output '.release_tag' "$state_file")
echo "Restoring the application images that preceded release $release_tag; database migrations will not be rerun."
"${compose[@]}" up --detach --wait --no-deps api worker web alertmanager

smoke_output=
for attempt in {1..30}; do
  if smoke_output=$(RDPS_PRODUCTION_COMPOSE_FILE="${RDPS_PRODUCTION_COMPOSE_FILE:-$root_dir/docker-compose.production.yml}" \
    "$script_dir/production-smoke-check.sh" 2>&1); then
    printf '%s\n' "$smoke_output"
    echo 'Application rollback smoke checks passed. The database schema was left unchanged.'
    exit 0
  fi
  if (( attempt < 30 )); then sleep 2; fi
done
printf '%s\n' "$smoke_output" >&2
echo 'Application rollback smoke checks failed; preserve logs and escalate recovery.' >&2
"${compose[@]}" ps >&2
exit 1
