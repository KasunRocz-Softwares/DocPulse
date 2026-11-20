#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: RDPS_RESTORE_ATTACHMENTS_CONFIRM=YES $0 <backup.tar.gz> <new-empty-destination>" >&2
  exit 64
fi
archive=$1
destination=$2
[[ "${RDPS_RESTORE_ATTACHMENTS_CONFIRM:-}" == "YES" ]] || {
  echo "Set RDPS_RESTORE_ATTACHMENTS_CONFIRM=YES only for a new isolated destination." >&2
  exit 64
}
[[ -f "$archive" && -f "$archive.sha256" ]] || { echo "Archive and checksum sidecar are required." >&2; exit 66; }
command -v sha256sum >/dev/null || { echo "sha256sum is required." >&2; exit 69; }
command -v tar >/dev/null || { echo "tar is required." >&2; exit 69; }
command -v realpath >/dev/null || { echo "realpath is required." >&2; exit 69; }

archive=$(realpath -e -- "$archive")
(cd -- "$(dirname -- "$archive")" && sha256sum --check "$(basename -- "$archive").sha256")
while IFS= read -r member; do
  path=${member#./}
  path=${path%/}
  [[ "$path" == "." || "$path" == "" || "$path" =~ ^[0-9a-fA-F-]{36}/?$ ]] || {
    echo "Attachment archive contains an unexpected path." >&2
    exit 65
  }
done < <(tar --list --gzip --file="$archive")

destination_parent=$(dirname -- "$destination")
destination_name=$(basename -- "$destination")
[[ "$destination_name" != "." && "$destination_name" != ".." && -n "$destination_name" ]] || {
  echo "Destination must name a new directory." >&2
  exit 64
}
mkdir -p -- "$destination_parent"
destination_parent=$(realpath -e -- "$destination_parent")
destination="$destination_parent/$destination_name"
[[ ! -e "$destination" ]] || { echo "Destination already exists; restore never overwrites files." >&2; exit 64; }
staging=$(mktemp -d "$destination_parent/.rdps-attachments-restore.XXXXXX")
trap 'rm -rf -- "$staging"' EXIT

umask 077
tar --extract --gzip --file="$archive" --directory="$staging" --no-same-owner --no-same-permissions
if find "$staging" -mindepth 1 -maxdepth 1 ! -type f -print -quit | grep -q .; then
  echo "Restored attachment archive contains a non-file entry." >&2
  exit 65
fi
while IFS= read -r -d '' file; do
  [[ "$(basename -- "$file")" =~ ^[0-9a-fA-F-]{36}$ ]] || {
    echo "Restored attachment archive contains an invalid storage key." >&2
    exit 65
  }
done < <(find "$staging" -mindepth 1 -maxdepth 1 -type f -print0)

mv -- "$staging" "$destination"
printf 'Attachment restore extracted to new directory: %s\n' "$destination"
