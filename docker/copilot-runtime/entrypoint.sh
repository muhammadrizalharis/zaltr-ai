#!/bin/sh
# zaltr.ai copilot-runtime entrypoint:
# baca token Enterprise dari Docker secret -> env proses saja.
set -eu

SECRET_FILE="/run/secrets/zaltr_copilot_token"

if [ ! -s "${SECRET_FILE}" ]; then
  echo "[copilot-runtime] GAGAL: secret ${SECRET_FILE} kosong."
  echo "[copilot-runtime] Isi secrets/copilot_github_token dengan token"
  echo "[copilot-runtime] service account (gho_/ghu_/github_pat_) lalu:"
  echo "[copilot-runtime]   zaltrctl up ai"
  exit 1
fi

COPILOT_GITHUB_TOKEN="$(cat "${SECRET_FILE}")"
export COPILOT_GITHUB_TOKEN

# Bind 0.0.0.0 aman: port 4321 hanya ada di network internal zaltr-net,
# tidak pernah dipublikasikan ke host/internet.
exec copilot --headless --host 0.0.0.0 --port 4321
