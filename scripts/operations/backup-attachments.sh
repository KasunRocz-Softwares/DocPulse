#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <attachments-directory> <backup-directory>" >&2
  exit 64
fi
source_dir=$1
backup_dir=$2
[[ -d "$source_dir" ]] || { echo "Attachments directory not found." >&2; exit 66; }
command -v tar >/dev/null || { echo "tar is required." >&2; exit 69; }
command -v sha256sum >/dev/null || { echo "sha256sum is required." >&2; exit 69; }
command -v realpath >/dev/null || { echo "realpath is required." >&2; exit 69; }

source_dir=$(realpath -e -- "$source_dir")
mkdir -p -- "$backup_dir"
backup_dir=$(realpath -e -- "$backup_dir")
if [[ "$backup_dir" == "$source_dir" || "$backup_dir" == "$source_dir"/* ]]; then
  echo "Backup directory must be outside the attachments directory." >&2
  exit 64
fi

umask 077
stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="$backup_dir/rdps-attachments-$stamp.tar.gz"
tmp="$archive.partial"
trap 'rm -f -- "$tmp"' EXIT

tar --create --gzip --file="$tmp" --directory="$source_dir" --owner=0 --group=0 --numeric-owner .
while IFS= read -r member; do
  path=${member#./}
  path=${path%/}
  [[ "$path" == "." || "$path" == "" || "$path" =~ ^[0-9a-fA-F-]{36}/?$ ]] || {
    echo "Unexpected path in generated attachment archive." >&2
    exit 65
  }
done < <(tar --list --gzip --file="$tmp")
mv -- "$tmp" "$archive"
filename=$(basename -- "$archive")
(cd -- "$backup_dir" && sha256sum -- "$filename" > "$filename.sha256")
chmod 600 -- "$archive" "$archive.sha256"
printf 'Attachment backup created and archive-checked: %s\n' "$archive"
printf 'Checksum file: %s.sha256\n' "$archive"
