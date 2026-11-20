#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: RDPS_RESTORE_ATTACHMENTS_CONFIRM=YES $0 <backup.tar.gz> <new-rdps-restore-volume-name>" >&2
  exit 64
fi
[[ "${RDPS_RESTORE_ATTACHMENTS_CONFIRM:-}" == "YES" ]] || {
  echo "Set RDPS_RESTORE_ATTACHMENTS_CONFIRM=YES only for a new isolated volume." >&2
  exit 64
}
volume_name=$2
[[ "$volume_name" =~ ^rdps-restore-[A-Za-z0-9._-]{1,80}$ ]] || {
  echo "Volume name must start with rdps-restore-." >&2
  exit 64
}
command -v docker >/dev/null || { echo "docker is required." >&2; exit 69; }
repo_root=$(cd -- "$(dirname -- "$0")/../.." && pwd)
staging_root=$(mktemp -d "${TMPDIR:-/tmp}/rdps-attachment-volume-restore.XXXXXX")
trap 'rm -rf -- "$staging_root"' EXIT
"$repo_root/scripts/operations/restore-attachments-safe.sh" "$1" "$staging_root/files"

if docker volume inspect "$volume_name" >/dev/null 2>&1; then
  echo "Restore volume already exists; choose a new volume name." >&2
  exit 64
fi
expected_project=${COMPOSE_PROJECT_NAME:-rdps-production}
docker volume create \
  --label "com.docker.compose.project=$expected_project" \
  --label 'com.docker.compose.volume=rdps_production_attachments' \
  "$volume_name" >/dev/null
tar --create --gzip --file=- --directory="$staging_root/files" \
  --owner=0 --group=0 --numeric-owner . |
MSYS_NO_PATHCONV=1 docker run --rm \
  --interactive \
  --mount "type=volume,source=$volume_name,target=/target" \
  node:24-bookworm-slim \
  sh -ec 'test -z "$(find /target -mindepth 1 -print -quit)" && tar --extract --gzip --file=- --directory=/target && chown -R 10001:10001 /target && chmod 0700 /target && find /target -type f -exec chmod 0600 {} +'
printf 'Restored attachment volume: %s\n' "$volume_name"
printf 'Set RDPS_ATTACHMENTS_VOLUME_NAME=%s before bringing the API back up.\n' "$volume_name"
