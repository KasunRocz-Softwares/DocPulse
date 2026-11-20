#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <backup-directory>" >&2
  exit 64
fi
command -v sha256sum >/dev/null || { echo "sha256sum is required." >&2; exit 69; }
use_compose=${RDPS_PG_DUMP_VIA_COMPOSE:-0}
docker_container=${RDPS_PG_DUMP_DOCKER_CONTAINER:-}
if [[ -n "$docker_container" || "$use_compose" == "1" ]]; then
  command -v docker >/dev/null || { echo "docker is required for Compose database backup." >&2; exit 69; }
  [[ -n "${DATABASE_URL:-}" ]] || { echo "DATABASE_URL must match the migration target for Compose database backup." >&2; exit 64; }
else
  [[ -n "${DATABASE_URL:-}" ]] || { echo "DATABASE_URL must be provided by the runtime secret store." >&2; exit 64; }
  command -v pg_dump >/dev/null || { echo "pg_dump is required." >&2; exit 69; }
  command -v node >/dev/null || { echo "node is required to parse DATABASE_URL without exposing it in process arguments." >&2; exit 69; }
  command -v pg_restore >/dev/null || { echo "pg_restore is required." >&2; exit 69; }
fi

backup_dir=$1
umask 077
mkdir -p "$backup_dir"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="$backup_dir/rdps-postgres-$stamp.dump"
tmp="$archive.partial"
trap 'rm -f "$tmp"' EXIT

if [[ -n "$docker_container" ]]; then
  docker exec "$docker_container" sh -ec \
    'export PGHOST=127.0.0.1 PGPORT=5432 PGUSER="$POSTGRES_USER" PGPASSWORD="$POSTGRES_PASSWORD" PGDATABASE="$POSTGRES_DB"; exec pg_dump --format=custom --no-owner --no-acl' > "$tmp"
  docker exec -i "$docker_container" pg_restore --list < "$tmp" >/dev/null
elif [[ "$use_compose" == "1" ]]; then
  compose_file=${RDPS_COMPOSE_FILE:?RDPS_COMPOSE_FILE is required when RDPS_PG_DUMP_VIA_COMPOSE=1}
  docker compose --file "$compose_file" run --rm --no-deps -T --env DATABASE_URL \
    --entrypoint sh postgres -ec \
    'PGDATABASE="$DATABASE_URL" exec pg_dump --format=custom --no-owner --no-acl' > "$tmp"
  docker compose --file "$compose_file" run --rm --no-deps -T -i \
    --entrypoint pg_restore postgres --list < "$tmp" >/dev/null
else
  node "$(dirname -- "$0")/pg-backup-from-url.mjs" "$tmp"
  pg_restore --list "$tmp" >/dev/null
fi
mv -- "$tmp" "$archive"
filename=$(basename "$archive")
(cd "$backup_dir" && sha256sum "$filename" > "$filename.sha256")
chmod 600 "$archive" "$archive.sha256"
printf 'Backup created and archive-checked: %s\n' "$archive"
printf 'Checksum file: %s.sha256\n' "$archive"
