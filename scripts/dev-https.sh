#!/usr/bin/env bash
# Run `bun dev` over HTTPS on localhost.
#
# Web Push, Notification.requestPermission, and a few other browser
# features only work in a secure context. Browsers treat plain
# http://localhost as secure for most APIs, but iOS Safari's PWA
# install + Web Push path expects a real https:// origin and the
# manifest spec assumes one. This script provisions a local cert
# via mkcert and starts the server with the TLS env vars the relay
# now honours.
#
# One-time setup:
#
#   brew install mkcert nss          # nss = Firefox CA trust on macOS
#   mkcert -install                  # adds mkcert's root CA to the trust store
#
# Then any time you want HTTPS dev:
#
#   bun scripts/dev-https.sh
#
# The cert lives under `.dev-certs/` (gitignored). The first run
# generates one; later runs reuse it.

set -e

CERT_DIR=".dev-certs"
KEY_FILE="$CERT_DIR/localhost-key.pem"
CERT_FILE="$CERT_DIR/localhost-cert.pem"

if ! command -v mkcert >/dev/null 2>&1; then
  echo "mkcert is not installed."
  echo "  brew install mkcert nss"
  echo "  mkcert -install"
  exit 1
fi

if [ ! -f "$KEY_FILE" ] || [ ! -f "$CERT_FILE" ]; then
  mkdir -p "$CERT_DIR"
  mkcert -key-file "$KEY_FILE" -cert-file "$CERT_FILE" localhost 127.0.0.1 ::1
fi

export FAIRFOX_TLS_KEY_FILE="$PWD/$KEY_FILE"
export FAIRFOX_TLS_CERT_FILE="$PWD/$CERT_FILE"

echo "fairfox dev (https): https://localhost:${PORT:-3000}"
exec bun --filter '@fairfox/web' dev
