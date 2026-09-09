#!/bin/sh
# POSIX sh installer for Windows (Git Bash / MSYS). Registers Chrome Native Messaging.
# Requires: Node.js on PATH, and Windows reg.exe (not WSL-only).
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
HOST_NAME="com.webnginx.proxy"
EXT_ID="${EXT_ID:-}"

if [ -z "$EXT_ID" ]; then
  echo "Usage: EXT_ID=<chrome-extension-id> $0" >&2
  echo "Find the id on chrome://extensions (Developer mode)." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required on PATH." >&2
  exit 1
fi

if ! command -v reg >/dev/null 2>&1; then
  echo "reg.exe not found. Run this from Git Bash / MSYS on Windows (not WSL-only)." >&2
  exit 1
fi

if [ ! -d "$ROOT/node_modules/node-forge" ]; then
  echo "Installing npm dependencies..."
  (cd "$ROOT" && npm install --omit=dev --no-audit --no-fund)
else
  echo "Dependencies already present, skipping npm install."
fi

# Native Windows paths (works under Git Bash).
NODE_WIN=$(node -e "process.stdout.write(process.execPath)")
HOST_JS_WIN=$(node -e "process.stdout.write(require('path').resolve(process.argv[1]))" "$ROOT/host.js")
WRAPPER_WIN=$(node -e "process.stdout.write(require('path').resolve(process.argv[1]))" "$ROOT/host-wrapper.cmd")
MANIFEST_WIN=$(node -e "process.stdout.write(require('path').resolve(process.argv[1]))" "$ROOT/${HOST_NAME}.json")

WRAPPER="$ROOT/host-wrapper.cmd"
# cmd.exe needs quoted paths when they contain spaces.
cat > "$WRAPPER" <<EOF
@echo off
"$NODE_WIN" "$HOST_JS_WIN" %*
EOF

json_escape() {
  # Escape backslashes for JSON string values.
  printf '%s' "$1" | sed 's/\\/\\\\/g'
}

WRAPPER_JSON=$(json_escape "$WRAPPER_WIN")

MANIFEST_PATH="$ROOT/${HOST_NAME}.json"
cat > "$MANIFEST_PATH" <<EOF
{
  "name": "${HOST_NAME}",
  "description": "WebNginx local MITM reverse proxy",
  "path": "${WRAPPER_JSON}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://${EXT_ID}/"
  ]
}
EOF

REG_KEY="HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}"
reg add "$REG_KEY" /ve /t REG_SZ /d "$MANIFEST_WIN" /f >/dev/null

echo "Wrote ${MANIFEST_PATH}"
echo "Registry: ${REG_KEY} -> ${MANIFEST_WIN}"
echo "Allowed origin: chrome-extension://${EXT_ID}/"
echo "Host wrapper: ${WRAPPER_WIN} -> ${NODE_WIN} ${HOST_JS_WIN}"
echo
echo "Next (in order):"
echo "  1. Reload the extension on chrome://extensions"
echo "  2. Options: Active proxy_pass + popup ON + Save and Sync"
echo "     (first Save creates %USERPROFILE%\\.webnginx\\ca.crt — install-host does NOT)"
echo "  3. make trust-ca   (or ./trust-ca-windows.sh)"
echo "  4. Fully quit Chrome (tray icon too), then reopen"
echo
echo "Reload the WebNginx extension, enable rules, and check Options → Proxy status."
