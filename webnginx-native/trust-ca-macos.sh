#!/usr/bin/env bash
set -euo pipefail

CA="${HOME}/.webnginx/ca.crt"

if [[ ! -f "$CA" ]]; then
  echo "CA not found at ${CA}" >&2
  echo "Start the extension (with host installed) once so the host can generate it," >&2
  echo "or run: node -e \"import('./ca.js').then(m=>m.ensureCa())\" in webnginx-native/" >&2
  exit 1
fi

echo "Adding ${CA} to login keychain as a trusted root..."
echo "macOS may prompt for your password / Keychain access."
security add-trusted-cert -d -r trustRoot -k "${HOME}/Library/Keychains/login.keychain-db" "$CA"
echo "Done. Restart Chrome fully (Cmd+Q) so TLS trust is picked up."
