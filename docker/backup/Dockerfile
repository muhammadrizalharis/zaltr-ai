# zaltr.ai — container backup: cron + pg_dump + mc mirror + AES-256
FROM alpine:3.20

RUN apk add --no-cache postgresql16-client openssl tzdata bash curl

# mc (MinIO client) di-vendor sebagai binary lokal: MinIO menghapus URL unduh
# "latest" (dl.min.io -> 410 Gone), jadi tak bisa diunduh saat build. Binary di
# docker/backup/mc (gitignore) disalin dari container yang teruji.
COPY mc /usr/local/bin/mc
RUN chmod +x /usr/local/bin/mc

COPY backup.sh /usr/local/bin/zaltr-backup
COPY entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/zaltr-backup /usr/local/bin/entrypoint

ENTRYPOINT ["/usr/local/bin/entrypoint"]
