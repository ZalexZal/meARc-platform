#!/usr/bin/env bash
# Weekly backup of AR Trail's database and media, on Kubuntu: the same backup
# as tools/backup.ps1 on Windows, in the same encrypted format, so either
# restore script opens either one.
#
#   tools/backup.sh            (run weekly by a systemd user timer, see below)
#
# What it makes, in ~/keys/backups/:
#   artrail-<date>.backup   one encrypted file holding
#     public.dump   the app's own schema and data   (pg_dump custom format)
#     auth.dump     accounts, sessions, identities  (data only)
#     storage.dump  the file records                (data only)
#     media/        every uploaded photo, recording and video
#
# Format "ARTB1": 5 bytes "ARTB1", 16 bytes salt, 16 bytes IV, then the zip in
# AES-256-CBC (PKCS#7), keyed by PBKDF2-SHA256 (200,000 rounds) of
# keys/backup.pass. Backups older than 8 weeks are deleted, which is what the
# privacy policy promises.
#
# Needs: postgresql-client (18 reads Supabase's 17), openssl, zip, curl,
# python3, and the database URL (session pooler, port 5432) in
# keys/supabase-db-url.txt. Restore with tools/restore.sh. Nothing secret is in
# this file.
#
# The timer (installed once):
#   ~/.config/systemd/user/artrail-backup.{service,timer}, Sundays 20:00,
#   Persistent=true so a week the laptop was off is caught up at the next start.
set -euo pipefail

KEYS="$HOME/keys"
URL_FILE="$KEYS/supabase-db-url.txt"
PASS="$KEYS/backup.pass"
OUT="$KEYS/backups"
STAMP="$(date +%F)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/artrail-backup-$STAMP-XXXX")"
ZIP="$WORK.zip"

# The readable copies never outlive the run.
trap 'rm -rf "$WORK" "$ZIP"' EXIT
umask 077

for need in pg_dump psql openssl zip curl python3; do
  command -v "$need" >/dev/null || { echo "Missing: $need" >&2; exit 1; }
done
[ -f "$URL_FILE" ] || { echo "Missing: $URL_FILE" >&2; exit 1; }
[ -f "$PASS" ] || { echo "Missing: $PASS - the Windows backups were made with it; copy it from there." >&2; exit 1; }
mkdir -p "$OUT" "$WORK/media"

URL="$(tr -d '\r\n' < "$URL_FILE")"
# The user is "postgres.<project ref>" on the pooler.
REF="$(python3 -c 'import sys,urllib.parse as u; print(u.urlparse(sys.argv[1]).username.split(".",1)[1])' "$URL")"
SITE="https://$REF.supabase.co"

echo '1/4 database'
pg_dump --dbname="$URL" --format=custom --no-owner --no-privileges --schema=public --file "$WORK/public.dump"
for schema in auth storage; do
  pg_dump --dbname="$URL" --format=custom --no-owner --no-privileges --data-only --schema="$schema" --file "$WORK/$schema.dump"
done

echo '2/4 media'
count=0
while IFS= read -r name; do
  [ -n "$name" ] || continue
  mkdir -p "$WORK/media/$(dirname "$name")"
  path="$(python3 -c 'import sys,urllib.parse as u; print("/".join(u.quote(p, safe="") for p in sys.argv[1].split("/")))' "$name")"
  curl -fsS -o "$WORK/media/$name" "$SITE/storage/v1/object/public/marker-media/$path"
  count=$((count + 1))
done < <(psql "$URL" -At -c "select name from storage.objects where bucket_id = 'marker-media' order by name")
echo "    $count files"

echo '3/4 encrypt'
(cd "$WORK" && zip -qr "$ZIP" .)
SALT="$(openssl rand -hex 16)"
IV="$(openssl rand -hex 16)"
KEY="$(python3 -c '
import hashlib, sys
pw = open(sys.argv[1], encoding="utf-8").read().strip().encode()
print(hashlib.pbkdf2_hmac("sha256", pw, bytes.fromhex(sys.argv[2]), 200000, 32).hex())' "$PASS" "$SALT")"
FILE="$OUT/artrail-$STAMP.backup"
{
  printf 'ARTB1'
  printf '%s%s' "$SALT" "$IV" | xxd -r -p
  openssl enc -aes-256-cbc -K "$KEY" -iv "$IV" -in "$ZIP"
} > "$FILE"

echo '4/4 keep 8 weeks'
find "$OUT" -maxdepth 1 -name 'artrail-*.backup' -mtime +56 -print -delete | sed 's/^/    deleted /'

echo "Done: $FILE ($(du -h "$FILE" | cut -f1)). Copy it off this laptop now and then, with keys/backup.pass."
