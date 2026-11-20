#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <backup.dump>" >&2
  exit 64
fi
archive=$1
[[ -f "$archive" ]] || { echo "Backup archive not found: $archive" >&2; exit 66; }
[[ -f "$archive.sha256" ]] || { echo "Checksum file not found: $archive.sha256" >&2; exit 66; }
command -v sha256sum >/dev/null || { echo "sha256sum is required." >&2; exit 69; }
docker_container=${RDPS_PG_RESTORE_DOCKER_CONTAINER:-}
if [[ -n "$docker_container" ]]; then
  command -v docker >/dev/null || { echo "docker is required for container-backed archive verification." >&2; exit 69; }
else
  command -v pg_restore >/dev/null || { echo "pg_restore is required." >&2; exit 69; }
fi

(cd "$(dirname "$archive")" && sha256sum --check "$(basename "$archive").sha256")
if [[ -n "$docker_container" ]]; then
  docker exec -i "$docker_container" pg_restore --list < "$archive" >/dev/null
else
  pg_restore --list "$archive" >/dev/null
fi
echo "Checksum and PostgreSQL archive structure verified: $archive"
