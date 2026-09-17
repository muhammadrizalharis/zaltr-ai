#!/usr/bin/env bash
# Auto-update CLI Copilot runtime ke rilis STABIL terbaru, supaya model baru
# yang dirilis GitHub Copilot (mis. Claude Opus 5) otomatis muncul di calyzr.ai.
# App membaca katalog model LIVE (listModels), jadi begitu runtime tahu model
# baru, langsung tampil — tanpa ubah kode. Script ini dijadwalkan via systemd
# --user timer. Aman: hanya rilis stabil, health-check, rollback bila gagal.
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOGDIR="$HOME/.local/state/zaltr"
mkdir -p "$LOGDIR"
LOG="$LOGDIR/copilot-update.log"
log() { printf '%s %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG"; }

DC=(sudo -n docker compose --project-name zaltr -f docker-compose.yml --profile ai)

cur=$(grep -E '^ZALTR_COPILOT_CLI_VERSION=' .env | cut -d= -f2 | tr -d '[:space:]' || true)
[ -n "${cur:-}" ] || { log "ERROR: ZALTR_COPILOT_CLI_VERSION tak ada di .env"; exit 1; }

# Rilis STABIL terbaru (/releases/latest sudah mengabaikan pre-release & draft).
latest=$(curl -s --http1.1 -m 25 https://api.github.com/repos/github/copilot-cli/releases/latest \
  | sed -nE 's/.*"tag_name":[[:space:]]*"v?([^"]+)".*/\1/p' | head -1)
[ -n "${latest:-}" ] || { log "ERROR: gagal ambil rilis terbaru dari GitHub"; exit 1; }
[[ "$latest" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { log "SKIP: rilis terbaru bukan stabil ($latest)"; exit 0; }

if [ "$cur" = "$latest" ]; then
  log "OK: sudah terbaru (CLI $cur)"
  exit 0
fi

log "UPDATE CLI Copilot: $cur -> $latest"
bak=$(mktemp)
cp -p .env "$bak"

restore() {
  cp -p "$bak" .env
  chmod 600 .env
  "${DC[@]}" up -d copilot-runtime >>"$LOG" 2>&1 || true
  rm -f "$bak"
}

sed -i -E "s/^ZALTR_COPILOT_CLI_VERSION=.*/ZALTR_COPILOT_CLI_VERSION=$latest/" .env
chmod 600 .env

if ! "${DC[@]}" build copilot-runtime >>"$LOG" 2>&1; then
  log "ERROR: build gagal -> rollback ke $cur"
  restore
  exit 1
fi
"${DC[@]}" up -d copilot-runtime >>"$LOG" 2>&1

# Tunggu health (maks ~120 detik).
ok=0
for _ in $(seq 1 24); do
  st=$(sudo -n docker inspect -f '{{.State.Health.Status}}' zaltr-copilot-runtime 2>/dev/null || echo none)
  [ "$st" = healthy ] && { ok=1; break; }
  sleep 5
done

if [ "$ok" = 1 ]; then
  rm -f "$bak"
  log "SUCCESS: runtime sehat di CLI $latest (model baru otomatis tampil di picker)"
else
  log "FAIL: runtime tak sehat di $latest -> rollback ke $cur"
  restore
  exit 1
fi
