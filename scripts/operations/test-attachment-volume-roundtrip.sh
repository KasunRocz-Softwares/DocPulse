#!/usr/bin/env bash
set -Eeuo pipefail

command -v docker >/dev/null || { echo "docker is required." >&2; exit 69; }
root=$(mktemp -d "${TMPDIR:-/tmp}/rdps-attachment-volume-test.XXXXXX")
suffix="$(date -u +%Y%m%d%H%M%S)-${RANDOM}-${RANDOM}"
source_volume="rdps-audit-src-$suffix"
restore_volume="rdps-restore-audit-$suffix"
missing_volume="rdps-audit-missing-$suffix"
storage_key=01234567-89ab-cdef-0123-456789abcdef
source_created=false
restore_created=false

cleanup() {
  if [[ "$source_created" == true ]]; then docker volume rm "$source_volume" >/dev/null; fi
  if [[ "$restore_created" == true ]]; then docker volume rm "$restore_volume" >/dev/null; fi
  rm -rf -- "$root"
}
trap cleanup EXIT

if docker volume inspect "$source_volume" >/dev/null 2>&1 ||
  docker volume inspect "$restore_volume" >/dev/null 2>&1 ||
  docker volume inspect "$missing_volume" >/dev/null 2>&1; then
  echo "Generated test volume name already exists; refusing to reuse it." >&2
  exit 73
fi

docker volume create \
  --label 'com.docker.compose.project=rdps-production' \
  --label 'com.docker.compose.volume=rdps_production_attachments' \
  "$source_volume" >/dev/null
source_created=true
MSYS_NO_PATHCONV=1 docker run --rm \
  --mount "type=volume,source=$source_volume,target=/attachments" \
  node:24-bookworm-slim \
  sh -c "printf 'attachment volume recovery fixture' > /attachments/$storage_key"

if RDPS_ATTACHMENTS_VOLUME_NAME="$missing_volume" \
  COMPOSE_PROJECT_NAME=rdps-production \
  scripts/operations/backup-attachments-volume.sh "$root/missing-backup"; then
  echo "Attachment backup unexpectedly created a missing source volume." >&2
  exit 1
else
  status=$?
  [[ $status -eq 66 ]] || exit "$status"
fi
if docker volume inspect "$missing_volume" >/dev/null 2>&1; then
  echo "Missing-volume refusal created a Docker volume." >&2
  exit 1
fi

RDPS_ATTACHMENTS_VOLUME_NAME="$source_volume" \
  COMPOSE_PROJECT_NAME=rdps-production \
  scripts/operations/backup-attachments-volume.sh "$root/backups"
archive=$(find "$root/backups" -maxdepth 1 -type f -name '*.tar.gz' -print -quit)
[[ -n "$archive" ]] || { echo "Attachment volume archive was not created." >&2; exit 1; }
RDPS_RESTORE_ATTACHMENTS_CONFIRM=YES \
  scripts/operations/restore-attachments-volume.sh "$archive" "$restore_volume"
restore_created=true

restored_project=$(docker volume inspect --format '{{ index .Labels "com.docker.compose.project" }}' "$restore_volume")
restored_key=$(docker volume inspect --format '{{ index .Labels "com.docker.compose.volume" }}' "$restore_volume")
[[ "$restored_project" == rdps-production && "$restored_key" == rdps_production_attachments ]] || {
  echo 'Restored attachment volume is missing the production Compose identity labels.' >&2
  exit 1
}

MSYS_NO_PATHCONV=1 docker run --rm \
  --mount "type=volume,source=$source_volume,target=/source,readonly" \
  --mount "type=volume,source=$restore_volume,target=/restored,readonly" \
  node:24-bookworm-slim \
  sh -c "cmp /source/$storage_key /restored/$storage_key"

restored_mode=$(MSYS_NO_PATHCONV=1 docker run --rm \
  --mount "type=volume,source=$restore_volume,target=/restored,readonly" \
  node:24-bookworm-slim \
  stat -c '%u:%g:%a' "/restored/$storage_key")
[[ "$restored_mode" == 10001:10001:600 ]] || {
  echo "Restored attachment owner/mode is wrong: $restored_mode" >&2
  exit 1
}
MSYS_NO_PATHCONV=1 docker run --rm --user 10001:10001 \
  --mount "type=volume,source=$restore_volume,target=/restored" \
  node:24-bookworm-slim \
  sh -c "test -r /restored/$storage_key && test -w /restored && printf 'api-user-write' > /restored/fedcba98-7654-3210-fedc-ba9876543210"

RDPS_ATTACHMENTS_VOLUME_NAME="$restore_volume" \
  COMPOSE_PROJECT_NAME=rdps-production \
  scripts/operations/backup-attachments-volume.sh "$root/restored-backups"
[[ -n "$(find "$root/restored-backups" -maxdepth 1 -type f -name '*.tar.gz' -print -quit)" ]] || {
  echo 'Standard backup rejected the restored attachment volume.' >&2
  exit 1
}

echo "Docker attachment volume identity, backup, restore, and content checks passed."
