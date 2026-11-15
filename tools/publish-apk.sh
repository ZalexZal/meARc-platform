#!/bin/bash
# Put the latest app build on the website.
#
#   tools/publish-apk.sh [path/to/meARc.apk]
#
# Copies the APK to web/public/meARc.apk (served at /meARc.apk; the old
# /ARTrail.apk address redirects there, see netlify.toml) and writes
# web/src/data/app.json with its version, size and date, which the download
# sections read at build time. Checks first that it is the release-signed
# com.alex.mearc build, so a lab or debug APK never goes out by mistake.
# Commit and push afterwards; Netlify publishes it with the site.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/../../AR-Trails/AR-Trails/Build"
# The Unity build may still write the old file name; take whichever is newer.
DEFAULT="$(ls -t "$BUILD/meARc.apk" "$BUILD/ARTrail.apk" 2>/dev/null | head -1 || true)"
APK="${1:-${DEFAULT:-$BUILD/meARc.apk}}"
SDK="$HOME/Unity/Hub/Editor/6000.4.10f1/Editor/Data/PlaybackEngines/AndroidPlayer/SDK"
AAPT2="$(ls "$SDK"/build-tools/*/aapt2 | tail -1)"
APKSIGNER="$(ls "$SDK"/build-tools/*/apksigner | tail -1)"
# apksigner needs Java; Unity ships one with its Android tools.
export JAVA_HOME="${JAVA_HOME:-$HOME/Unity/Hub/Editor/6000.4.10f1/Editor/Data/PlaybackEngines/AndroidPlayer/OpenJDK}"
export PATH="$JAVA_HOME/bin:$PATH"
RELEASE_CERT="b63c1f97"   # start of the release certificate's SHA-256

[ -f "$APK" ] || { echo "No APK at $APK"; exit 1; }

BADGE="$("$AAPT2" dump badging "$APK" | sed -n 1p)"
PKG="$(grep -o "package: name='[^']*'" <<<"$BADGE" | cut -d"'" -f2)"
VERSION="$(grep -o " versionName='[^']*'" <<<"$BADGE" | cut -d"'" -f2)"
CODE="$(grep -o " versionCode='[^']*'" <<<"$BADGE" | cut -d"'" -f2)"
[ "$PKG" = "com.alex.mearc" ] || { echo "Wrong package: $PKG"; exit 1; }

CERTS="$("$APKSIGNER" verify --print-certs "$APK")"
grep -q "SHA-256 digest: $RELEASE_CERT" <<<"$CERTS" || { echo "Not signed with the release key"; exit 1; }

cp "$APK" "$ROOT/web/public/meARc.apk"
BYTES="$(stat -c %s "$APK")"
DATE="$(date -r "$APK" +%Y-%m-%d)"
mkdir -p "$ROOT/web/src/data"
cat > "$ROOT/web/src/data/app.json" <<EOF
{ "version": "$VERSION", "code": $CODE, "bytes": $BYTES, "date": "$DATE" }
EOF

echo "Published meARc $VERSION ($CODE), $((BYTES / 1048576)) MB, built $DATE."
echo "Now commit web/public/meARc.apk and web/src/data/app.json, and push."
