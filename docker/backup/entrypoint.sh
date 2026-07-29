#!/bin/sh
# zaltr.ai backup entrypoint: pasang jadwal cron lalu jalankan crond.
set -eu

CRON_EXPR="${ZALTR_BACKUP_CRON:-5 3 * * *}"

echo "${CRON_EXPR} /usr/local/bin/zaltr-backup >> /backups/backup.log 2>&1" \
  > /etc/crontabs/root

echo "[zaltr-backup] jadwal cron: ${CRON_EXPR} (TZ=${TZ:-UTC})"
echo "[zaltr-backup] jalankan manual: docker exec zaltr-backup zaltr-backup"

exec crond -f -l 8
