#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
HOST_NAME="com.webnginx.proxy"
EXT_ID="${EXT_ID:-}"

if [[ -z "$EXT_ID" ]]; then
  echo "Usage: EXT_ID=<chrome-extension-id> $0" >&2
  echo "Find the id on chrome://extensions (Developer mode)." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required on PATH." >&2
  exit 1
fi

if [[ ! -d "$ROOT/node_modules/node-forge" ]]; then
  echo "Installing npm dependencies..."
  (cd "$ROOT" && npm install --omit=dev --no-audit --no-fund)
else
  echo "Dependencies already present, skipping npm install."
fi

HOST_JS="$ROOT/host.js"
chmod +x "$HOST_JS"

# Ensure node can be found when Chrome launches the host via shebang.
NODE_BIN="$(command -v node)"
WRAPPER="$ROOT/host-wrapper.sh"
cat > "$WRAPPER" <<EOF
#!/bin/bash
exec "${NODE_BIN}" "${HOST_JS}" "\$@"
EOF
chmod +x "$WRAPPER"

MANIFEST_DIR="${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
mkdir -p "$MANIFEST_DIR"
MANIFEST_PATH="${MANIFEST_DIR}/${HOST_NAME}.json"

cat > "$MANIFEST_PATH" <<EOF
{
  "name": "${HOST_NAME}",
  "description": "WebNginx local MITM reverse proxy",
  "path": "${WRAPPER}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://${EXT_ID}/"
  ]
}
EOF

echo "Wrote ${MANIFEST_PATH}"
echo "Allowed origin: chrome-extension://${EXT_ID}/"
echo "Host wrapper: ${WRAPPER} -> ${NODE_BIN} ${HOST_JS}"
echo
echo "Next (in order):"
echo "  1. Reload the extension on chrome://extensions"
echo "  2. Options: Active proxy_pass + popup ON + Save and Sync"
echo "     (first Save creates ~/.webnginx/ca.crt — install-host does NOT)"
echo "  3. make trust-ca"
echo "  4. Cmd+Q quit Chrome fully, then reopen"
echo
echo "Reload the WebNginx extension, enable rules, and check Options → Proxy status."
