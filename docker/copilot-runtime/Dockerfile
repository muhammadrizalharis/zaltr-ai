# zaltr.ai — GitHub Copilot CLI headless runtime
# Token Enterprise TIDAK pernah ada di image; dibaca dari Docker secret
# saat start oleh entrypoint. Belum diaktifkan sampai fase web
# (profile "ai" di docker-compose.yml).
FROM debian:bookworm-slim

ARG COPILOT_CLI_VERSION=1.0.85

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates wget \
    && ARCH=$(dpkg --print-architecture) \
    && case "${ARCH}" in \
         amd64) COPILOT_ARCH="x64" ;; \
         arm64) COPILOT_ARCH="arm64" ;; \
         *) echo "arch tidak didukung: ${ARCH}" && exit 1 ;; \
       esac \
    && wget -q "https://github.com/github/copilot-cli/releases/download/v${COPILOT_CLI_VERSION}/copilot-linux-${COPILOT_ARCH}.tar.gz" \
    && tar -xzf "copilot-linux-${COPILOT_ARCH}.tar.gz" \
    && mv copilot /usr/local/bin/copilot \
    && rm -f "copilot-linux-${COPILOT_ARCH}.tar.gz" \
    && apt-get purge -y wget \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /usr/sbin/nologin copilot

COPY entrypoint.sh /usr/local/bin/entrypoint
RUN chmod +x /usr/local/bin/entrypoint

USER copilot
WORKDIR /home/copilot

# Hanya terjangkau dari zaltr-net (tidak ada port host).
EXPOSE 4321

ENTRYPOINT ["/usr/local/bin/entrypoint"]
