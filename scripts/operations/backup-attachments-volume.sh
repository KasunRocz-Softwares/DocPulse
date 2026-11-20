#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <backup-directory>" >&2
  exit 64
fi
command -v docker >/dev/null || { echo "docker is required." >&2; exit 69; }
command -v tar >/dev/null || { echo "tar is required." >&2; exit 69; }
command -v sha256sum >/dev/null || { echo "sha256sum is required." >&2; exit 69; }

volume_name=${RDPS_ATTACHMENTS_VOLUME_NAME:-rdps-production-attachments}
[[ "$volume_name" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || {
  echo "RDPS_ATTACHMENTS_VOLUME_NAME contains unsupported characters." >&2
  exit 64
}
backup_dir=$1
mkdir -p -- "$backup_dir"
backup_dir=$(cd -- "$backup_dir" && pwd)
umask 077
stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="$backup_dir/rdps-attachments-$stamp.tar.gz"
tmp="$archive.partial"
trap 'rm -f -- "$tmp"' EXIT

docker volume inspect "$volume_name" >/dev/null 2>&1 || {
  echo "Attachment source volume does not exist; refusing to back up an empty replacement: $volume_name" >&2
  exit 66
}
volume_project=$(docker volume inspect --format '{{ index .Labels "com.docker.compose.project" }}' "$volume_name")
volume_key=$(docker volume inspect --format '{{ index .Labels "com.docker.compose.volume" }}' "$volume_name")
expected_project=${COMPOSE_PROJECT_NAME:-rdps-production}
if [[ "$volume_project" != "$expected_project" || "$volume_key" != "rdps_production_attachments" ]]; then
  echo "Attachment source volume is not the configured production Compose volume (project=$expected_project, key=rdps_production_attachments)." >&2
  exit 65
fi
MSYS_NO_PATHCONV=1 docker run --rm \
  --mount "type=volume,source=$volume_name,target=/attachments,readonly" \
  node:24-bookworm-slim \
  tar --create --gzip --file=- --directory=/attachments --owner=0 --group=0 --numeric-owner . > "$tmp"
while IFS= read -r member; do
  path=${member#./}
  path=${path%/}
  [[ "$path" == "." || "$path" == "" || "$path" =~ ^[0-9a-fA-F-]{36}$ ]] || {
    echo "Attachment archive contains an unexpected path." >&2
    exit 65
  }
done < <(tar --list --gzip --file="$tmp")
mv -- "$tmp" "$archive"
filename=$(basename -- "$archive")
(cd -- "$backup_dir" && sha256sum -- "$filename" > "$filename.sha256")
chmod 600 -- "$archive" "$archive.sha256"
printf 'Durable attachment volume backed up: %s\n' "$archive"
