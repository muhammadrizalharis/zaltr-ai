#!/bin/sh
# zaltr.ai copilot-runtime entrypoint. Urutan auth:
# 1) Docker secret zaltr_copilot_token (bila diisi) -> env COPILOT_GITHUB_TOKEN.
# 2) Auth tersimpan di volume /home/copilot/.copilot (hasil `copilot` device
#    login sekali via: zaltrctl copilot-login) -> tanpa token di file mana pun.
set -eu

SECRET_FILE="/run/secrets/zaltr_copilot_token"

if [ -s "${SECRET_FILE}" ]; then
  COPILOT_GITHUB_TOKEN="$(cat "${SECRET_FILE}")"
  export COPILOT_GITHUB_TOKEN
  echo "[copilot-runtime] pakai token dari Docker secret."
elif [ -d "/home/copilot/.copilot" ] && [ -n "$(ls -A /home/copilot/.copilot 2>/dev/null)" ]; then
  echo "[copilot-runtime] pakai auth tersimpan di volume (~/.copilot)."
else
  echo "[copilot-runtime] GAGAL: belum ada auth."
  echo "[copilot-runtime] Jalankan sekali: bin/zaltrctl copilot-login"
  echo "[copilot-runtime] (device login akun Copilot Enterprise), atau isi"
  echo "[copilot-runtime] secrets/copilot_github_token lalu: zaltrctl up ai"
  exit 1
fi

# Bind 0.0.0.0 aman: port 4321 hanya ada di network internal zaltr-net,
# tidak pernah dipublikasikan ke host/internet.
exec copilot --headless --host 0.0.0.0 --port 4321
