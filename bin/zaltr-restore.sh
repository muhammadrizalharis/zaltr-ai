#!/bin/bash
# ============================================================
# zaltr-restore.sh — pulihkan arsip backup zaltr.ai
#
# Pemakaian:
#   bin/zaltr-restore.sh <arsip.tar.enc> [--apply]
#
# Tanpa --apply : DRILL. Dekripsi ke folder sementara, tampilkan isi,
#                 verifikasi manifest. Tidak menyentuh database/MinIO.
# Dengan --apply: restore SUNGGUHAN ke stack zaltr yang sedang jalan
#                 (pg_restore --clean ke zaltr-postgres + mc mirror
#                 balik ke zaltr-minio). Minta konfirmasi dulu.
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCHIVE="${1:?pemakaian: zaltr-restore.sh <arsip.tar.enc> [--apply]}"
MODE="${2:-drill}"
PASS_FILE="${ROOT}/secrets/backup.pass"

[ -s "${PASS_FILE}" ] || { echo "secrets/backup.pass tidak ada"; exit 1; }
[ -f "${ARCHIVE}" ]   || { echo "arsip tidak ditemukan: ${ARCHIVE}"; exit 1; }

WORK="$(mktemp -d /tmp/zaltr-restore.XXXXXX)"
trap 'rm -rf "${WORK}"' EXIT

echo "[restore] dekripsi ${ARCHIVE} ..."
openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:${PASS_FILE}" -in "${ARCHIVE}" \
  | tar -xf - -C "${WORK}"

echo "[restore] isi arsip:"
find "${WORK}" -maxdepth 2 -type f | sed "s|${WORK}/|  |"

echo "[restore] verifikasi checksum manifest ..."
(
  cd "${WORK}"
  # MANIFEST berisi hash untuk semua file kecuali dirinya sendiri
  grep -v $'\t./MANIFEST.txt$' MANIFEST.txt | tail -n +3 | while IFS=$'\t' read -r hash path; do
    actual="$(sha256sum "${path}" | cut -d' ' -f1)"
    [ "${hash}" = "${actual}" ] || { echo "  CHECKSUM BEDA: ${path}"; exit 1; }
  done
)
echo "[restore] checksum OK"

if [ "${MODE}" != "--apply" ]; then
  echo "[restore] DRILL selesai (tidak ada yang diubah)."
  echo "[restore] Untuk restore sungguhan: $0 ${ARCHIVE} --apply"
  exit 0
fi

echo
echo "!!! RESTORE SUNGGUHAN ke stack zaltr (database akan DIGANTI ISINYA)."
read -r -p "Ketik 'restore-zaltr' untuk lanjut: " ans
[ "${ans}" = "restore-zaltr" ] || { echo "dibatalkan"; exit 1; }

ENVF="${ROOT}/.env"
PGUSER="$(grep '^ZALTR_POSTGRES_USER=' "${ENVF}" | cut -d= -f2)"
PGDB="$(grep '^ZALTR_POSTGRES_DB=' "${ENVF}" | cut -d= -f2)"
MINIO_USER="$(grep '^ZALTR_MINIO_ROOT_USER=' "${ENVF}" | cut -d= -f2)"
MINIO_PASS="$(grep '^ZALTR_MINIO_ROOT_PASSWORD=' "${ENVF}" | cut -d= -f2)"

echo "[restore] pg_restore ke ${PGDB} ..."
sudo docker cp "${WORK}/db.dump" zaltr-postgres:/tmp/db.dump
sudo docker exec zaltr-postgres \
  pg_restore --clean --if-exists --no-owner -U "${PGUSER}" -d "${PGDB}" /tmp/db.dump
sudo docker exec zaltr-postgres rm -f /tmp/db.dump

echo "[restore] mirror MinIO balik ..."
sudo docker run --rm --network zaltr-net \
  -v "${WORK}/minio:/restore:ro" \
  --entrypoint /bin/sh minio/mc:latest -ec "
    mc alias set zaltr http://minio:9000 '${MINIO_USER}' '${MINIO_PASS}'
    mc mirror --overwrite /restore/ zaltr/
  "

echo "[restore] SELESAI. Verifikasi aplikasi/DB secara manual."
