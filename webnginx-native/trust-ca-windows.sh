#!/bin/sh
# POSIX sh: trust WebNginx Local CA in the current-user Windows Root store.
set -eu

CA="${HOME}/.webnginx/ca.crt"

if [ ! -f "$CA" ]; then
  echo "CA not found at ${CA}" >&2
  echo "Start the extension (with host installed) once so the host can generate it," >&2
  echo "or run: node -e \"import('./ca.js').then(m=>m.ensureCa())\" in webnginx-native/" >&2
  exit 1
fi

if ! command -v certutil >/dev/null 2>&1; then
  echo "certutil.exe not found. Run this from Git Bash / MSYS on Windows (not WSL-only)." >&2
  exit 1
fi

CA_WIN=$(node -e "process.stdout.write(require('path').resolve(process.argv[1]))" "$CA")

echo "Adding ${CA_WIN} to Current User Trusted Root Certification Authorities..."
certutil -user -addstore Root "$CA_WIN"
echo "Done. Fully quit Chrome (including tray icon), then reopen so TLS trust is picked up."
