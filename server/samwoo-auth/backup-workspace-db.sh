#!/bin/sh
set -eu

DB=${SAMWOO_WORKSPACE_DB:-/opt/samwoo-auth/workspace-shares.db}
DEST=${1:-${SAMWOO_WORKSPACE_BACKUP_DIR:-}}

if [ -z "$DEST" ]; then
  echo "backup destination required" >&2
  exit 2
fi
case "$DEST" in
  *"'"*)
    echo "backup destination cannot contain an apostrophe" >&2
    exit 2
    ;;
esac

mkdir -p "$DEST"
BACKUP="$DEST/workspace-shares-$(date +%F).db"
sqlite3 "$DB" ".backup '$BACKUP'"
chmod 600 "$BACKUP"
find "$DEST" -type f -name 'workspace-shares-*.db' -mtime +14 -delete
