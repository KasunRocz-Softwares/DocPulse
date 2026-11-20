#!/usr/bin/env bash
set -Eeuo pipefail

root=$(mktemp -d "${TMPDIR:-/tmp}/rdps-attachment-test.XXXXXX")
trap 'rm -rf -- "$root"' EXIT
mkdir -p "$root/source" "$root/backups"
storage_key=01234567-89ab-cdef-0123-456789abcdef
printf 'synthetic attachment data' > "$root/source/$storage_key"

scripts/operations/backup-attachments.sh "$root/source" "$root/backups"
archive=$(find "$root/backups" -maxdepth 1 -type f -name '*.tar.gz' -print -quit)
[[ -n "$archive" ]] || { echo "Attachment archive was not created." >&2; exit 1; }
RDPS_RESTORE_ATTACHMENTS_CONFIRM=YES \
  scripts/operations/restore-attachments-safe.sh "$archive" "$root/restored"
cmp "$root/source/$storage_key" "$root/restored/$storage_key"

if RDPS_RESTORE_ATTACHMENTS_CONFIRM=YES \
  scripts/operations/restore-attachments-safe.sh "$archive" "$root/restored"; then
  echo "Attachment restore unexpectedly overwrote an existing directory." >&2
  exit 1
fi

if scripts/operations/backup-attachments.sh "$root/source" "$root/source/backups"; then
  echo "Attachment backup unexpectedly allowed an output directory inside its source." >&2
  exit 1
fi

echo "Attachment backup and restore checks passed."
