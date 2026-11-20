#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <directory-containing-one-postgres-and-one-attachments-backup>" >&2
  exit 64
fi

for utility in restic jq sha256sum pg_restore tar; do
  command -v "$utility" >/dev/null || {
    echo "$utility is required for encrypted off-site backup." >&2
    exit 69
  }
done

repository=${RESTIC_REPOSITORY:-}
[[ "$repository" == s3:* ]] || {
  echo "RESTIC_REPOSITORY must name an S3-compatible Restic repository (s3:...)." >&2
  exit 64
}
restic_password=${RESTIC_PASSWORD:-}
[[ -n "$restic_password" && ${#restic_password} -ge 20 ]] || {
  echo "RESTIC_PASSWORD must be provided from the secret store and contain at least 20 characters." >&2
  exit 64
}

keep_daily=${RDPS_RESTIC_KEEP_DAILY:-7}
keep_weekly=${RDPS_RESTIC_KEEP_WEEKLY:-4}
keep_monthly=${RDPS_RESTIC_KEEP_MONTHLY:-12}
for retention in "$keep_daily" "$keep_weekly" "$keep_monthly"; do
  [[ "$retention" =~ ^[1-9][0-9]{0,3}$ ]] || {
    echo "Restic retention counts must be integers from 1 to 9999." >&2
    exit 64
  }
done

backup_dir=$1
[[ -d "$backup_dir" ]] || { echo "Backup directory does not exist: $backup_dir" >&2; exit 66; }
backup_dir=$(cd -- "$backup_dir" && pwd)
shopt -s nullglob
postgres_archives=("$backup_dir"/rdps-postgres-*.dump)
attachment_archives=("$backup_dir"/rdps-attachments-*.tar.gz)
[[ ${#postgres_archives[@]} -eq 1 && ${#attachment_archives[@]} -eq 1 ]] || {
  echo "The backup directory must contain exactly one PostgreSQL archive and one attachment archive." >&2
  exit 65
}
postgres_archive=${postgres_archives[0]}
attachment_archive=${attachment_archives[0]}
for archive in "$postgres_archive" "$attachment_archive"; do
  [[ -f "$archive" && ! -L "$archive" && -f "$archive.sha256" && ! -L "$archive.sha256" ]] || {
    echo "Backup archive and regular checksum sidecar are required: $(basename -- "$archive")" >&2
    exit 66
  }
done

verify_archive_checksum() {
  local archive=$1
  local sidecar="$archive.sha256"
  local filename
  local sidecar_line
  local expected
  local sidecar_filename
  local actual_output
  local actual
  local -a sidecar_lines=()

  filename=$(basename -- "$archive")
  mapfile -t sidecar_lines < "$sidecar"
  [[ ${#sidecar_lines[@]} -eq 1 ]] || {
    echo "Checksum sidecar must contain exactly one entry: $(basename -- "$sidecar")" >&2
    return 65
  }
  sidecar_line=${sidecar_lines[0]}
  [[ "$sidecar_line" =~ ^([a-f0-9]{64})[[:space:]]+([^[:space:]]+)$ ]] || {
    echo "Checksum sidecar has an invalid entry: $(basename -- "$sidecar")" >&2
    return 65
  }
  expected=${BASH_REMATCH[1]}
  sidecar_filename=${BASH_REMATCH[2]#\*}
  [[ "$sidecar_filename" == "$filename" ]] || {
    echo "Checksum sidecar names '$sidecar_filename', expected '$filename'." >&2
    return 65
  }
  actual_output=$(sha256sum -- "$archive")
  actual=${actual_output%% *}
  [[ "$actual" == "$expected" ]] || {
    echo "Checksum does not match archive: $filename" >&2
    return 65
  }
}

verify_archive_checksum "$postgres_archive"
verify_archive_checksum "$attachment_archive"
pg_restore --list "$postgres_archive" >/dev/null
tar --list --gzip --file="$attachment_archive" >/dev/null

host=${RDPS_RESTIC_HOST:-rdps-production}
[[ "$host" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]] || {
  echo "RDPS_RESTIC_HOST contains unsupported characters." >&2
  exit 64
}

# Restic encrypts and authenticates repository data client-side. Retention runs
# only after both verified archives have been accepted as a single snapshot.
umask 077
backup_json="$backup_dir/restic-backup.jsonl"
manifest="$backup_dir/manifest.txt"
manifest_tmp="$manifest.partial"
restic backup --json --group-by host --host "$host" --tag rdps -- \
  "$postgres_archive" "$postgres_archive.sha256" \
  "$attachment_archive" "$attachment_archive.sha256" > "$backup_json"
snapshot_id=$(jq -r 'select(.message_type == "summary") | .snapshot_id // empty' "$backup_json" | tail -n 1)
[[ "$snapshot_id" =~ ^[a-f0-9]{64}$ ]] || {
  echo "Restic backup completed without a valid snapshot ID; retention was not applied." >&2
  exit 65
}

postgres_sha=$(cd -- "$backup_dir" && sha256sum -- "$(basename -- "$postgres_archive")")
postgres_sha=${postgres_sha%% *}
attachment_sha=$(cd -- "$backup_dir" && sha256sum -- "$(basename -- "$attachment_archive")")
attachment_sha=${attachment_sha%% *}
created_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)
write_manifest() {
  {
    printf 'created_at=%s\n' "$created_at"
    printf 'host=%s\n' "$host"
    printf 'snapshot_id=%s\n' "$snapshot_id"
    printf 'upload_status=succeeded\n'
    printf 'postgres_archive=%s\n' "$(basename -- "$postgres_archive")"
    printf 'postgres_sha256=%s\n' "$postgres_sha"
    printf 'attachments_archive=%s\n' "$(basename -- "$attachment_archive")"
    printf 'attachments_sha256=%s\n' "$attachment_sha"
    printf 'retention_status=%s\n' "$retention_status"
    printf 'keep_daily=%s\n' "$keep_daily"
    printf 'keep_weekly=%s\n' "$keep_weekly"
    printf 'keep_monthly=%s\n' "$keep_monthly"
  } > "$manifest_tmp"
  chmod 600 -- "$manifest_tmp"
  mv -- "$manifest_tmp" "$manifest"
}

retention_status=pending
write_manifest
if restic forget --group-by host --host "$host" --tag rdps \
  --keep-daily "$keep_daily" \
  --keep-weekly "$keep_weekly" \
  --keep-monthly "$keep_monthly" \
  --prune; then
  retention_status=applied
else
  retention_status=failed
  write_manifest
  echo "Snapshot $snapshot_id uploaded, but retention failed. See $manifest." >&2
  exit 1
fi
write_manifest

printf 'Encrypted off-site snapshot %s uploaded and retention applied for %s.\n' "$snapshot_id" "$host"
