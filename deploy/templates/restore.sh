#!/usr/bin/env bash
# Restores a dump into a NEW database so it can be checked before anything is switched over.
# Usage: restore.sh /var/backups/ilmak/ilmak-db-XXXX.dump [target_db_name]
# It refuses to touch a database that already exists. To go live on the restored copy, stop the API, then rename databases.
set -euo pipefail
dump="${1:?usage: restore.sh <dump file> [new database name]}"
target="${2:-ilmak_restore_$(date -u +%Y%m%d%H%M)}"
[ -f "$dump" ] || { echo "no such file: $dump" >&2; exit 1; }
if psql -Atc "SELECT 1 FROM pg_database WHERE datname = '$target'" postgres | grep -q 1; then
  echo "database $target already exists; pick another name" >&2
  exit 1
fi
createdb "$target"
pg_restore --no-owner --dbname="$target" "$dump"
echo "restored into $target. Check it, for example:"
echo "  psql $target -c 'SELECT count(*) FROM users'"
