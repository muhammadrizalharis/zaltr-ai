#!/bin/bash
# ============================================================
# zaltr.ai — sinkron backup terenkripsi ke Google Drive.
# Pola sama dengan askara-backup.sh: rclone copy + retensi remote.
# Dijalankan cron host setelah backup harian container (03:05).
# Hanya file .tar.enc (sudah AES-256) yang naik — aman di cloud.
# ============================================================
set -u

DIR="$HOME/zaltr-backups"
REMOTE="gdrive:Zaltr-Backups/"
LOG="$DIR/drive-sync.log"
KEEP_DAYS=30
RCLONE="$HOME/bin/rclone"

[ -d "$DIR" ] || exit 0

if "$RCLONE" copy "$DIR" "$REMOTE" --include 'zaltr-*.tar.enc' --quiet 2>> "$LOG"; then
  echo "$(date '+%F %T') upload OK" >> "$LOG"
  # retensi remote: hapus arsip lebih tua dari KEEP_DAYS
  "$RCLONE" delete "$REMOTE" --min-age "${KEEP_DAYS}d" --quiet 2>> "$LOG" || true
else
  echo "$(date '+%F %T') upload GAGAL" >> "$LOG"
fi
