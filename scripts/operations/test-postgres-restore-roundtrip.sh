#!/usr/bin/env bash
set -Eeuo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_root=$(cd -- "$script_dir/../.." && pwd)

for required_command in docker sha256sum; do
  command -v "$required_command" >/dev/null 2>&1 || {
    printf '%s is required for the PostgreSQL restore round-trip.\n' "$required_command" >&2
    exit 69
  }
done

image=${RDPS_POSTGRES_TEST_IMAGE:-postgres:17-alpine}
run_id="$(date -u +%Y%m%dT%H%M%SZ)-$$-${RANDOM}-${RANDOM}"
label_key=com.rdps.postgres-roundtrip.run
resource_label="$label_key=$run_id"
source_container="rdps-pg-roundtrip-source-$run_id"
restore_container="rdps-pg-roundtrip-restore-$run_id"
source_volume="rdps-pg-roundtrip-source-data-$run_id"
restore_volume="rdps-pg-roundtrip-restore-data-$run_id"
database_name=rdps_restore_audit
database_user=rdps_audit
database_password="RdpsAudit${RANDOM}${RANDOM}X9"
root=$(mktemp -d "${TMPDIR:-/tmp}/rdps-postgres-roundtrip.XXXXXX")
cleanup_status=0

# Docker Desktop's Git Bash path conversion can rewrite container paths.
export MSYS_NO_PATHCONV=1

container_has_run_label() {
  local container_name=$1
  [[ "$(docker inspect --format "{{ index .Config.Labels \"$label_key\" }}" "$container_name" 2>/dev/null || true)" == "$run_id" ]]
}

volume_has_run_label() {
  local volume_name=$1
  [[ "$(docker volume inspect --format "{{ index .Labels \"$label_key\" }}" "$volume_name" 2>/dev/null || true)" == "$run_id" ]]
}

cleanup() {
  local exit_status=$?
  trap - EXIT
  set +e

  for container_name in "$source_container" "$restore_container"; do
    if container_has_run_label "$container_name"; then
      docker rm --force "$container_name" >/dev/null || {
        printf 'Could not remove test-owned container: %s\n' "$container_name" >&2
        cleanup_status=1
      }
    elif docker inspect "$container_name" >/dev/null 2>&1; then
      printf 'Refusing to remove container without this run label: %s\n' "$container_name" >&2
      cleanup_status=1
    fi
  done

  for volume_name in "$source_volume" "$restore_volume"; do
    if volume_has_run_label "$volume_name"; then
      docker volume rm "$volume_name" >/dev/null || {
        printf 'Could not remove test-owned volume: %s\n' "$volume_name" >&2
        cleanup_status=1
      }
    elif docker volume inspect "$volume_name" >/dev/null 2>&1; then
      printf 'Refusing to remove volume without this run label: %s\n' "$volume_name" >&2
      cleanup_status=1
    fi
  done

  rm -rf -- "$root" || cleanup_status=1
  if [[ $exit_status -eq 0 && $cleanup_status -ne 0 ]]; then
    exit_status=1
  fi
  exit "$exit_status"
}
trap cleanup EXIT

for resource_name in "$source_container" "$restore_container"; do
  if docker inspect "$resource_name" >/dev/null 2>&1; then
    printf 'Generated test container name already exists; refusing to reuse it: %s\n' "$resource_name" >&2
    exit 73
  fi
done
for resource_name in "$source_volume" "$restore_volume"; do
  if docker volume inspect "$resource_name" >/dev/null 2>&1; then
    printf 'Generated test volume name already exists; refusing to reuse it: %s\n' "$resource_name" >&2
    exit 73
  fi
done

create_database_container() {
  local role=$1
  local container_name=$2
  local volume_name=$3

  docker volume create \
    --label "$resource_label" \
    --label "com.rdps.postgres-roundtrip.role=$role-data" \
    "$volume_name" >/dev/null
  if ! volume_has_run_label "$volume_name"; then
    printf 'Created volume did not carry this run label; refusing to use it: %s\n' "$volume_name" >&2
    return 1
  fi
  docker run --detach \
    --name "$container_name" \
    --label "$resource_label" \
    --label "com.rdps.postgres-roundtrip.role=$role-database" \
    --publish 127.0.0.1::5432 \
    --env POSTGRES_DB="$database_name" \
    --env POSTGRES_USER="$database_user" \
    --env POSTGRES_PASSWORD="$database_password" \
    --mount "type=volume,source=$volume_name,target=/var/lib/postgresql/data" \
    "$image" >/dev/null
  if ! container_has_run_label "$container_name"; then
    printf 'Created container did not carry this run label; refusing to use it: %s\n' "$container_name" >&2
    return 1
  fi
}

wait_for_database() {
  local container_name=$1
  local attempt
  for attempt in $(seq 1 60); do
    if docker exec "$container_name" pg_isready -U "$database_user" -d "$database_name" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  printf 'PostgreSQL did not become ready in test container: %s\n' "$container_name" >&2
  return 1
}

database_url_for_container() {
  local container_name=$1
  local published_port
  published_port=$(docker port "$container_name" 5432/tcp | awk -F: 'NR == 1 { print $NF }')
  [[ "$published_port" =~ ^[0-9]+$ ]] || {
    printf 'Could not determine the published PostgreSQL port for %s.\n' "$container_name" >&2
    return 1
  }
  printf 'postgresql://%s:%s@127.0.0.1:%s/%s?schema=public' \
    "$database_user" "$database_password" "$published_port" "$database_name"
}

create_database_container source "$source_container" "$source_volume"
wait_for_database "$source_container"

migration_count=0
while IFS= read -r migration_sql; do
  docker exec -i "$source_container" \
    psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database_name" < "$migration_sql"
  migration_count=$((migration_count + 1))
done < <(find "$repo_root/database/prisma/migrations" -mindepth 2 -maxdepth 2 -type f -name migration.sql -print | sort)
[[ $migration_count -gt 0 ]] || {
  printf 'No Prisma migration SQL files found under %s.\n' "$repo_root/database/prisma/migrations" >&2
  exit 66
}

docker exec -i "$source_container" \
  psql -v ON_ERROR_STOP=1 -U "$database_user" -d "$database_name" <<'SQL'
INSERT INTO "User" ("id", "email", "displayName", "status", "updatedAt") VALUES
  ('10000000-0000-4000-8000-000000000001', 'restore-audit@example.invalid', 'Restore Audit Fixture', 'ACTIVE', CURRENT_TIMESTAMP);

INSERT INTO "Project" ("id", "name", "slug", "description", "status", "updatedAt") VALUES
  ('20000000-0000-4000-8000-000000000001', 'Restore Audit Project', 'restore-audit-fixture', 'Disposable PostgreSQL restore fixture', 'ACTIVE', CURRENT_TIMESTAMP);

INSERT INTO "Release" ("id", "projectId", "version", "title", "type", "channel", "status", "releaseDate", "publicSummary", "updatedAt") VALUES
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '2.4.0', 'Restore Round Trip Release', 'MINOR', 'STABLE', 'PUBLISHED', CURRENT_TIMESTAMP, 'Release data survived a PostgreSQL restore.', CURRENT_TIMESTAMP);

INSERT INTO "ReleaseChange" ("id", "releaseId", "title", "category", "internalDescription", "publicDescription", "visibility", "sortOrder", "authorId", "updatedAt") VALUES
  ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 'Restore-safe changelog entry', 'FEATURE', 'Internal fixture details', 'A representative public changelog entry.', 'PUBLIC_CANDIDATE', 0, '10000000-0000-4000-8000-000000000001', CURRENT_TIMESTAMP);

INSERT INTO "ApprovalRevision" ("id", "releaseId", "revision", "status", "contentHash", "content", "submittedById") VALUES
  ('50000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', 1, 'APPROVED', repeat('a', 64), '{"title":"Restore Round Trip Release","version":"2.4.0"}'::jsonb, '10000000-0000-4000-8000-000000000001');

INSERT INTO "ReleasePublication" ("id", "releaseId", "revisionId", "sequence", "publishedAt") VALUES
  ('60000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '50000000-0000-4000-8000-000000000001', 1, CURRENT_TIMESTAMP);

INSERT INTO "PublicReleaseSnapshot" ("id", "publicationId", "projectSlug", "projectName", "version", "title", "summary", "contentHash", "publishedAt") VALUES
  ('70000000-0000-4000-8000-000000000001', '60000000-0000-4000-8000-000000000001', 'restore-audit-fixture', 'Restore Audit Project', '2.4.0', 'Restore Round Trip Release', 'Release data survived a PostgreSQL restore.', repeat('b', 64), CURRENT_TIMESTAMP);

INSERT INTO "PublicSnapshotChange" ("id", "snapshotId", "sourceChangeId", "title", "category", "description", "sortOrder") VALUES
  ('80000000-0000-4000-8000-000000000001', '70000000-0000-4000-8000-000000000001', '40000000-0000-4000-8000-000000000001', 'Restore-safe changelog entry', 'FEATURE', 'A representative public changelog entry.', 0);

INSERT INTO "AuditLog" ("id", "actorId", "projectId", "action", "entityType", "entityId", "metadata", "requestId") VALUES
  ('90000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'release.published', 'Release', '30000000-0000-4000-8000-000000000001', '{"source":"postgres-restore-roundtrip","sequence":1}'::jsonb, 'restore-roundtrip-fixture');
SQL

source_database_url=$(database_url_for_container "$source_container")
backup_directory="$root/backups"
DATABASE_URL="$source_database_url" \
  RDPS_PG_DUMP_DOCKER_CONTAINER="$source_container" \
  "$script_dir/backup-postgres.sh" "$backup_directory"

backup_archive=
for candidate in "$backup_directory"/rdps-postgres-*.dump; do
  [[ -f "$candidate" ]] || continue
  if [[ -n "$backup_archive" ]]; then
    printf 'Expected one backup archive, found multiple in %s.\n' "$backup_directory" >&2
    exit 1
  fi
  backup_archive=$candidate
done
[[ -n "$backup_archive" ]] || {
  printf 'PostgreSQL backup script did not create a custom-format dump.\n' >&2
  exit 1
}
[[ -s "$backup_archive.sha256" ]] || {
  printf 'PostgreSQL backup checksum file is missing or empty.\n' >&2
  exit 1
}

create_database_container restore "$restore_container" "$restore_volume"
wait_for_database "$restore_container"
restore_database_url=$(database_url_for_container "$restore_container")
RDPS_RESTORE_DATABASE_URL="$restore_database_url" \
  RDPS_RESTORE_CONFIRM=YES \
RDPS_RESTORE_DOCKER_CONTAINER="$restore_container" \
  "$script_dir/restore-postgres.sh" "$backup_archive"

restored_records=$(docker exec -i "$restore_container" \
  psql -X -A -t -v ON_ERROR_STOP=1 -U "$database_user" -d "$database_name" <<'SQL'
SELECT p."slug" || '|' || r."version" || '|' || pub."sequence" || '|' || s."title" || '|' || c."title" || '|' || a."action"
FROM "Project" p
JOIN "Release" r ON r."projectId" = p."id"
JOIN "ReleasePublication" pub ON pub."releaseId" = r."id"
JOIN "PublicReleaseSnapshot" s ON s."publicationId" = pub."id"
JOIN "PublicSnapshotChange" c ON c."snapshotId" = s."id"
JOIN "AuditLog" a ON a."entityId" = r."id"
WHERE p."id" = '20000000-0000-4000-8000-000000000001'
  AND r."id" = '30000000-0000-4000-8000-000000000001'
  AND pub."id" = '60000000-0000-4000-8000-000000000001'
  AND s."id" = '70000000-0000-4000-8000-000000000001'
  AND a."id" = '90000000-0000-4000-8000-000000000001';
SQL
)
expected_records='restore-audit-fixture|2.4.0|1|Restore Round Trip Release|Restore-safe changelog entry|release.published'
[[ "$restored_records" == "$expected_records" ]] || {
  printf 'Restored PostgreSQL records did not match the fixture.\nExpected: %s\nActual:   %s\n' \
    "$expected_records" "$restored_records" >&2
  exit 1
}

printf 'PostgreSQL backup/restore round trip passed; project, release, publication, public snapshot, changelog, and audit records were verified.\n'
