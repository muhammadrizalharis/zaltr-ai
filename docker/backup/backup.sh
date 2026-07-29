#!/bin/bash
# ============================================================
# zaltr.ai — backup harian TERENKRIPSI (mandiri, tak menyentuh
# proyek lain). Output: /backups/zaltr-<timestamp>.tar.enc
#
# Isi arsip:
#   db.dump        pg_dump format custom (pg_restore-able)
#   minio/         mirror bucket zaltr-* (mc mirror)
#   env.snapshot   salinan .env (tanpa ini restore sulit)
#   MANIFEST.txt   ukuran + sha256 tiap komponen
#
# Enkripsi : AES-256-CBC pbkdf2, passphrase dari secret
#            /run/secrets/zaltr_backup_pass (WAJIB ada).
# Retensi  : ZALTR_BACKUP_KEEP_DAYS (default 14) hari.
# Restore  : lihat bin/zaltr-restore.sh di repo.
# ============================================================
set -euo pipefail

TS="$(date +%Y%m%d-%H%M%S)"
WORK="$(mktemp -d /tmp/zaltr-backup.XXXXXX)"
OUT_DIR="/backups"
OUT="${OUT_DIR}/zaltr-${TS}.tar.enc"
PASS_FILE="/run/secrets/zaltr_backup_pass"
KEEP_DAYS="${ZALTR_BACKUP_KEEP_DAYS:-14}"

cleanup() { rm -rf "${WORK}"; }
trap cleanup EXIT

fail() { echo "[zaltr-backup] GAGAL: $*" >&2; exit 1; }

[ -s "${PASS_FILE}" ] || fail "secret ${PASS_FILE} kosong. Isi secrets/backup.pass lalu recreate container."
mkdir -p "${OUT_DIR}"

echo "[zaltr-backup] ${TS} mulai"

# 1. PostgreSQL (format custom agar bisa pg_restore selektif)
pg_dump --format=custom --no-password --file="${WORK}/db.dump" \
  || fail "pg_dump gagal"

# 2. MinIO: mirror seluruh bucket zaltr
mc alias set zaltr "${MINIO_URL}" "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" >/dev/null
mkdir -p "${WORK}/minio"
mc mirror --quiet zaltr/ "${WORK}/minio/" || fail "mc mirror gagal"

# 3. Snapshot konfigurasi (tanpa secret file terpisah)
if [ -f /cfg/.env ]; then
  cp /cfg/.env "${WORK}/env.snapshot"
fi

# 4. Manifest + checksum
(
  cd "${WORK}"
  {
    echo "zaltr backup ${TS}"
    echo "host: $(hostname)"
    find . -type f -exec sh -c 'printf "%s\t%s\n" "$(sha256sum "$1" | cut -d" " -f1)" "$1"' _ {} \;
  } > MANIFEST.txt
)

# 5. Arsipkan + enkripsi
tar -C "${WORK}" -cf - . \
  | openssl enc -aes-256-cbc -pbkdf2 -salt -pass "file:${PASS_FILE}" \
  > "${OUT}.tmp"
mv "${OUT}.tmp" "${OUT}"

SIZE="$(du -h "${OUT}" | cut -f1)"
echo "[zaltr-backup] tersimpan: ${OUT} (${SIZE})"

# 6. Verifikasi arsip bisa didekripsi (integritas passphrase + stream)
openssl enc -d -aes-256-cbc -pbkdf2 -pass "file:${PASS_FILE}" -in "${OUT}" \
  | tar -tf - > /dev/null \
  || fail "verifikasi dekripsi gagal — arsip korup?"
echo "[zaltr-backup] verifikasi dekripsi OK"

# 7. Retensi lokal
find "${OUT_DIR}" -maxdepth 1 -name 'zaltr-*.tar.enc' -mtime "+${KEEP_DAYS}" -print -delete \
  | sed 's/^/[zaltr-backup] hapus lama: /' || true

echo "[zaltr-backup] selesai"
