#!/usr/bin/env bash
set -Eeuo pipefail

restore_url=${RDPS_RESTORE_DATABASE_URL:-}
if [[ -z "$restore_url" ]]; then
  echo 'RDPS_RESTORE_DATABASE_URL is required.' >&2
  exit 64
fi
case "$restore_url" in
  *rdps_dev_only*|*localhost:5432/rdps*|*127.0.0.1:5432/rdps*)
    echo 'Refusing the known development database URL. Restore only to an isolated disposable target.' >&2
    exit 64
    ;;
esac
if [[ "${RDPS_RESTORE_CONFIRM:-}" != YES ]]; then
  echo 'Set RDPS_RESTORE_CONFIRM=YES only after confirming the target is an isolated, disposable restore database.' >&2
  exit 64
fi

root_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
exec "$root_dir/scripts/operations/restore-postgres.sh" "$@"
