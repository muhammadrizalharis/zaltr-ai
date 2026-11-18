#!/usr/bin/env bash
# Pemantauan layanan pendukung calyzr + alert Telegram (melengkapi ~/bin/zaltr-healthcheck.sh
# yang memeriksa app & akses publik). Dijalankan systemd --user timer tiap 5 menit.
#
# Diperiksa: SearXNG, Crawl4AI, Docling, runtime Copilot (dari sudut pandang container web),
# VRAM GPU (Docling OOM bila penuh), kesegaran backup harian + upload Google Drive, ruang disk.
# Alert HANYA saat status BERUBAH dan sudah gagal >= 2 run berturut-turut (anti-spam/blip).
# Token Telegram dibaca dari ~/.config/zaltr/telebot.env dan tak pernah dicetak.
#
# Uji tanpa kirim:  ZALTR_CHECK_DRY=1 ZALTR_CHECK_STATE_DIR=/tmp/x bin/zaltr-services-check.sh
# Simulasi gagal:   ZALTR_CHECK_FORCE_FAIL=docling,backup (dipisah koma)
set +H
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$HOME/.config/zaltr/telebot.env"
STATE_DIR="${ZALTR_CHECK_STATE_DIR:-$HOME/.cache/zaltr-svc}"
DRY="${ZALTR_CHECK_DRY:-0}"
FORCE_FAIL=",${ZALTR_CHECK_FORCE_FAIL:-},"
FAIL_THRESHOLD=2
BACKUP_DIR="$HOME/zaltr-backups"
BACKUP_MAX_AGE_H=26
DISK_WARN_PCT=90
VRAM_MIN_FREE_MIB=1500
mkdir -p "$STATE_DIR"

TOKEN="$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' "$ENV_FILE" 2>/dev/null | head -1)"
CHAT="$(sed -n 's/^TELEGRAM_CHAT_ID=//p' "$ENV_FILE" 2>/dev/null | head -1)"

send() {
  if [ "$DRY" = 1 ]; then
    [ "${ZALTR_CHECK_SEND_FAIL:-0}" = 1 ] && { echo "[DRY alert GAGAL TERKIRIM] $1"; return 1; }
    echo "[DRY alert] $1"; return 0
  fi
  [ -n "$TOKEN" ] && [ -n "$CHAT" ] || return 0 # Telegram belum dikonfigurasi: tak ada yang bisa dikirim
  # Jaringan ke Telegram kadang tersendat sesaat: 3 percobaan; sukses hanya bila API menjawab ok:true.
  local i resp
  for i in 1 2 3; do
    resp="$(printf 'url = "https://api.telegram.org/bot%s/sendMessage"\ndata-urlencode = "chat_id=%s"\ndata-urlencode = "text=%s"\n' \
      "$TOKEN" "$CHAT" "$1" | curl -s -m 15 -K - 2>/dev/null)"
    case "$resp" in *'"ok":true'*) return 0;; esac
    [ "$i" -lt 3 ] && sleep 3
  done
  echo "WARN  gagal mengirim Telegram setelah 3 percobaan (akan dicoba lagi di putaran berikutnya)" >&2
  return 1
}

# report <kunci> <ok:1|0> <label> <detail> <petunjuk-perbaikan>
report() {
  local key="$1" ok="$2" label="$3" detail="$4" hint="$5"
  case "$FORCE_FAIL" in *",$key,"*) ok=0; detail="(simulasi gagal)";; esac
  local sf="$STATE_DIR/$key.state" ff="$STATE_DIR/$key.fails"
  local prev fails; prev="$(cat "$sf" 2>/dev/null)"; fails="$(cat "$ff" 2>/dev/null)"; [ -n "$fails" ] || fails=0
  if [ "$ok" = 1 ]; then
    echo 0 >"$ff"
    if [ "$prev" = "DOWN" ]; then
      # Status baru dianggap pulih hanya bila notifikasinya terkirim; kalau tidak, dicoba lagi nanti.
      send "🟢 $label PULIH ($(date '+%F %T'))." && echo "UP" >"$sf"
    else
      echo "UP" >"$sf"
    fi
    echo "ok    $label — $detail"
  else
    fails=$((fails + 1)); echo "$fails" >"$ff"
    echo "FAIL  $label — $detail (gagal berturut: $fails)"
    if [ "$fails" -ge "$FAIL_THRESHOLD" ] && [ "$prev" != "DOWN" ]; then
      # Tandai DOWN hanya bila alert terkirim, supaya alert yang gagal terkirim tidak hilang selamanya.
      send "🔴 $label BERMASALAH: $detail ($(date '+%F %T')). $hint" && echo "DOWN" >"$sf"
    fi
  fi
}

# --- 1) Layanan dari sudut pandang container web ---
declare -A LABEL=([searxng]="SearXNG (pencarian web/jurnal)" [crawl4ai]="Crawl4AI (baca halaman)" [docling]="Docling (OCR PDF)" [copilot]="Runtime Copilot (model berbayar)")
declare -A HINT=([searxng]="Cek: docker logs zaltr-searxng" [crawl4ai]="Cek: docker ps | grep crawl4ai (server GPU)" [docling]="Cek: docker logs local-ai-docling (sering CUDA OOM)" [copilot]="Cek: docker logs zaltr-copilot-runtime; uji: bin/zaltr-copilot-probe.mjs")
probe_out="$(docker exec -i -w /app zaltr-web node --input-type=module < "$ROOT/bin/zaltr-services-probe.mjs" 2>&1)"
probe_rc=$?
seen=""
while IFS=$'\t' read -r name st detail; do
  [ -n "${LABEL[$name]:-}" ] || continue
  seen="$seen $name"
  if [ "$st" = ok ]; then
    report "$name" 1 "${LABEL[$name]}" "$detail" "${HINT[$name]}"
  else
    report "$name" 0 "${LABEL[$name]}" "$detail" "${HINT[$name]}"
  fi
done <<<"$probe_out"
# Container web tak bisa dijalankan probe -> app mati; itu urusan zaltr-healthcheck, jangan banjir alert.
if [ "$probe_rc" -ne 0 ] && [ -z "$seen" ]; then
  echo "SKIP  probe layanan gagal dijalankan (container web mati?): $(echo "$probe_out" | head -1 | cut -c1-100)"
fi

# --- 2) VRAM GPU: Docling OOM bila SEMUA GPU hampir penuh ---
if command -v nvidia-smi >/dev/null 2>&1; then
  maxfree="$(nvidia-smi --query-gpu=memory.free --format=csv,noheader,nounits 2>/dev/null | sort -n | tail -1)"
  if [ -n "$maxfree" ]; then
    [ "$maxfree" -ge "$VRAM_MIN_FREE_MIB" ] && ok=1 || ok=0
    report vram "$ok" "VRAM GPU" "bebas terbesar ${maxfree} MiB (min ${VRAM_MIN_FREE_MIB})" "OCR Docling akan gagal (CUDA OOM) sampai ada VRAM kosong; aplikasi otomatis jatuh ke pdf-parse."
  fi
fi

# --- 3) Backup harian & upload Drive ---
newest="$(ls -t "$BACKUP_DIR"/zaltr-*.tar.enc 2>/dev/null | head -1)"
if [ -z "$newest" ]; then
  report backup 0 "Backup harian" "tidak ada arsip di $BACKUP_DIR" "Cek: docker logs zaltr-backup"
else
  age_h=$(( ( $(date +%s) - $(stat -c %Y "$newest") ) / 3600 ))
  [ "$age_h" -le "$BACKUP_MAX_AGE_H" ] && ok=1 || ok=0
  report backup "$ok" "Backup harian" "arsip terbaru $(basename "$newest") (${age_h} jam lalu)" "Cek: docker logs zaltr-backup; jalankan manual: bin/zaltrctl backup-now"
fi
last_sync="$(tail -1 "$BACKUP_DIR/drive-sync.log" 2>/dev/null)"
case "$last_sync" in *"upload OK"*) ok=1;; *) ok=0;; esac
report drivesync "$ok" "Upload backup ke Google Drive" "${last_sync:-belum ada log}" "Cek: ~/bin/rclone lsd gdrive: dan $BACKUP_DIR/drive-sync.log"

# --- 4) Ruang disk ---
pct="$(df -P / | awk 'NR==2{gsub("%","",$5); print $5}')"
[ "$pct" -lt "$DISK_WARN_PCT" ] && ok=1 || ok=0
report disk "$ok" "Ruang disk /" "terpakai ${pct}% (batas ${DISK_WARN_PCT}%)" "Bersihkan: docker system df; docker builder prune; backup lama di $BACKUP_DIR"
