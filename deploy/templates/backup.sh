#!/usr/bin/env bash
# Nightly backup: a compressed PostgreSQL dump, plus the uploads folder when files are on local disk.
# Keeps 14 days locally. Set OFFSITE_CMD to copy each file somewhere else (a different region or tenancy), because a backup
# on the same machine does not survive losing the machine. Example:
#   OFFSITE_CMD='aws s3 cp --endpoint-url https://NS.compat.objectstorage.me-riyadh-1.oraclecloud.com {file} s3://ilmak-backups/'
set -euo pipefail
DIR="${BACKUP_DIR:-/var/backups/ilmak}"
DB="${BACKUP_DB:-ilmak}"
UPLOADS="${UPLOAD_DIR:-/var/lib/ilmak/uploads}"
KEEP_DAYS="${KEEP_DAYS:-14}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
mkdir -p "$DIR"

dump="$DIR/ilmak-db-$stamp.dump"
pg_dump --format=custom --no-owner --dbname="$DB" --file="$dump"
# A dump that cannot be listed is not a backup.
pg_restore --list "$dump" >/dev/null
files=("$dump")

if [ -d "$UPLOADS" ] && [ -n "$(ls -A "$UPLOADS" 2>/dev/null)" ]; then
  tarball="$DIR/ilmak-uploads-$stamp.tar.gz"
  tar -C "$UPLOADS" -czf "$tarball" .
  files+=("$tarball")
fi

if [ -n "${OFFSITE_CMD:-}" ]; then
  for f in "${files[@]}"; do eval "${OFFSITE_CMD//\{file\}/$f}"; done
fi

find "$DIR" -name 'ilmak-*' -type f -mtime +"$KEEP_DAYS" -delete
echo "backup ok: ${files[*]}"
