#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: RDPS_RESTORE_DATABASE_URL=<isolated-target-url> RDPS_RESTORE_CONFIRM=YES $0 <backup.dump>" >&2
  exit 64
fi
archive=$1
[[ "${RDPS_RESTORE_CONFIRM:-}" == "YES" ]] || { echo "Set RDPS_RESTORE_CONFIRM=YES only after confirming the target is an isolated, disposable restore database." >&2; exit 64; }
[[ -n "${RDPS_RESTORE_DATABASE_URL:-}" ]] || { echo "RDPS_RESTORE_DATABASE_URL is required." >&2; exit 64; }
docker_container=${RDPS_RESTORE_DOCKER_CONTAINER:-}
if [[ -n "$docker_container" ]]; then
  command -v docker >/dev/null || { echo "docker is required for container-backed restore." >&2; exit 69; }
  RDPS_PG_RESTORE_DOCKER_CONTAINER="$docker_container" \
    "$(dirname "$0")/verify-postgres-backup.sh" "$archive"
  docker exec -i "$docker_container" sh -ec \
    'export PGHOST=127.0.0.1 PGPORT=5432 PGUSER="$POSTGRES_USER" PGPASSWORD="$POSTGRES_PASSWORD" PGDATABASE="$POSTGRES_DB"; exec pg_restore --exit-on-error --no-owner --no-acl --dbname="$POSTGRES_DB"' < "$archive"
else
  command -v pg_restore >/dev/null || { echo "pg_restore is required." >&2; exit 69; }
  "$(dirname "$0")/verify-postgres-backup.sh" "$archive"
  pg_restore --exit-on-error --no-owner --no-acl --dbname="$RDPS_RESTORE_DATABASE_URL" "$archive"
fi
echo "Restore finished. Run the documented application-level smoke checks against the isolated target."
