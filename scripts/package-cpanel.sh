#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT="${1:-$ROOT/bank-roll-cpanel.zip}"
if [[ "$OUTPUT" != /* ]]; then OUTPUT="$ROOT/$OUTPUT"; fi
OUTPUT_DIR="$(dirname "$OUTPUT")"
mkdir -p "$OUTPUT_DIR"

for required in .htaccess index.html research.html test-mode.html player.html faq.html docs.html assets src; do
  if [[ ! -e "$ROOT/$required" ]]; then
    printf 'Required public file or directory is missing: %s\n' "$required" >&2
    exit 1
  fi
done

for tool in zip unzip node; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'Required packaging tool is unavailable: %s\n' "$tool" >&2
    exit 1
  fi
done

node --test \
  "$ROOT/tests/integration/page.test.js" \
  "$ROOT/tests/integration/app-startup.test.js" \
  "$ROOT/tests/integration/test-mode-runtime.test.js"
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
PUBLIC="$STAGING/public_html"
mkdir -p "$PUBLIC"
cp -a "$ROOT/.htaccess" "$ROOT/index.html" "$ROOT/research.html" "$ROOT/test-mode.html" "$ROOT/faq.html" "$ROOT/docs.html" "$PUBLIC/"
cp -a "$ROOT/player.html" "$PUBLIC/"
cp -a "$ROOT/assets" "$ROOT/src" "$PUBLIC/"
node "$ROOT/scripts/version-cpanel-assets.mjs" "$PUBLIC"
find "$PUBLIC" -type d -exec chmod 755 {} +
find "$PUBLIC" -type f -exec chmod 644 {} +

(cd "$STAGING" && zip -X -qr "$STAGING/package.zip" public_html)
node "$ROOT/scripts/verify-cpanel-archive.mjs" "$STAGING/package.zip"
mv "$STAGING/package.zip" "$OUTPUT"
sha256sum "$OUTPUT"
printf 'Created cPanel package: %s\n' "$OUTPUT"
