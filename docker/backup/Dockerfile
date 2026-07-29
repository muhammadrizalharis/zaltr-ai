# zaltr.ai — container backup: cron + pg_dump + mc mirror + AES-256
FROM alpine:3.20

RUN apk add --no-cache postgresql16-client openssl tzdata bash curl \
    && curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc \
         -o /usr/local/bin/mc \
    && chmod +x /usr/local/bin/mc

COPY backup.sh /usr/local/bin/zaltr-backup
COPY entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/zaltr-backup /usr/local/bin/entrypoint

ENTRYPOINT ["/usr/local/bin/entrypoint"]
