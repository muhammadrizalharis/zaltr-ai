# zaltr.ai — image web produksi (Next.js standalone).
# Build context = root repo. Env runtime disuntik compose (bukan di image).
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# postinstall menjalankan `prisma generate` (butuh schema; tidak butuh DB).
RUN npm ci

FROM deps AS build
COPY . .
# Nilai dummy hanya agar prisma.config.ts/build tidak komplain; tak pernah dipakai.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 1001 zaltr
COPY --from=build --chown=zaltr:zaltr /app/.next/standalone ./
COPY --from=build --chown=zaltr:zaltr /app/.next/static ./.next/static
COPY --from=build --chown=zaltr:zaltr /app/public ./public
USER zaltr
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=5 --start-period=20s \
    CMD curl -sf http://127.0.0.1:3000/login >/dev/null || exit 1
CMD ["node", "server.js"]
