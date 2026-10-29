#!/usr/bin/env bash
# Opens a backup made by tools/backup.sh or tools/backup.ps1 and says how to put
# it back.
#
#   tools/restore.sh ~/keys/backups/artrail-2026-10-30.backup
#
# It only decrypts, into a folder next to the backup; it changes no database.
# Restoring into a project is deliberate, and done by hand, in the order
# tools/restore.ps1 describes (migrations, then auth.dump, public.dump,
# storage.dump with pg_restore --data-only --disable-triggers, then media/ into
# a public bucket called marker-media).
#
# Delete the opened folder when finished: it is personal data in the clear.
set -euo pipefail

BACKUP="${1:?Usage: tools/restore.sh <file.backup>}"
PASS="$HOME/keys/backup.pass"
[ -f "$PASS" ] || { echo "Missing $PASS - without it the backup cannot be opened." >&2; exit 1; }
[ "$(dd if="$BACKUP" bs=1 count=5 status=none)" = "ARTB1" ] || { echo 'Not an AR Trail backup.' >&2; exit 1; }

SALT="$(dd if="$BACKUP" bs=1 skip=5 count=16 status=none | xxd -p)"
IV="$(dd if="$BACKUP" bs=1 skip=21 count=16 status=none | xxd -p)"
KEY="$(python3 -c '
import hashlib, sys
pw = open(sys.argv[1], encoding="utf-8").read().strip().encode()
print(hashlib.pbkdf2_hmac("sha256", pw, bytes.fromhex(sys.argv[2]), 200000, 32).hex())' "$PASS" "$SALT")"

umask 077
DIR="${BACKUP%.backup}-opened"
ZIP="${BACKUP%.backup}.zip"
trap 'rm -f "$ZIP"' EXIT
tail -c +38 "$BACKUP" | openssl enc -d -aes-256-cbc -K "$KEY" -iv "$IV" > "$ZIP"
mkdir -p "$DIR"
unzip -qo "$ZIP" -d "$DIR"

echo "Opened into $DIR"
ls -la "$DIR"
