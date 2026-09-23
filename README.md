# CALYZR.AI

> Semua AI terbaik dalam satu ruang kerja pribadi — chat, coding, gambar, video, dan musik.

CALYZR.AI adalah aplikasi web **self-hosted** yang menyatukan banyak model AI dalam satu
antarmuka chat: model cloud (GitHub Copilot Enterprise), model lokal (Ollama), dan workflow
generatif (ComfyUI). Dilengkapi *agent* yang dapat menjalankan kode sungguhan serta gateway
yang kompatibel dengan OpenAI sehingga bisa dipakai langsung dari editor kode.

Akses bersifat **khusus undangan** dan seluruh data disimpan sendiri (*local-first*).

## Fitur

- **Chat multi-model** dengan streaming, tombol stop, render markdown + blok kode, dan pemilih model di samping composer.
- **Model lokal & cloud**: GitHub Copilot Enterprise (SDK resmi), Ollama, dan demo internal — berpindah tanpa keluar dari chat.
- **Agent workspace**: menjalankan kode Python/shell di sandbox, menulis & membaca berkas, mencari web, membaca Google Drive publik, dan mencatat memori.
- **Dokumen & lampiran**: ekstraksi teks (PDF dsb.), kuota upload, dan pembacaan sumber bernama sepanjang percakapan.
- **Basis pengetahuan (RAG)** dengan embedding `bge-m3` + `pgvector`.
- **Vision** (analisis gambar) dan **generasi gambar** via ComfyUI (hasil tersimpan di object storage).
- **Gateway kompatibel OpenAI** di `/v1` (`chat/completions`, `responses`, `embeddings`, `models`) dengan emulasi *tool-calling* — bisa dipakai dari editor seperti Continue.
- **Web Push**, **email struk** (SMTP), dan **notifikasi admin** (Telegram).
- **Billing**: paket kredit, masa aktif 30 hari, *gating* model, dan pengingat kedaluwarsa.
- **Operasional**: isolasi Docker penuh, backup harian terenkripsi (AES-256), dan *rate limiting* berbasis Redis.

## Teknologi

- **Next.js 16** (App Router, output standalone) · **React 19** · **TypeScript**
- **Prisma 7** · **PostgreSQL 16 + pgvector**
- **Redis** · **MinIO** (S3) · **Tailwind CSS 4**
- **Docker** / docker-compose · **Vitest**

## Prasyarat

- **Node.js 22** (disarankan via `nvm`)
- **Docker** + **docker compose**
- (Opsional) **Ollama** untuk model lokal dan server **ComfyUI** untuk gambar

## Mulai Cepat

```bash
# 1) Klon & masuk folder
git clone <url-repo> zaltr-ai && cd zaltr-ai

# 2) Siapkan konfigurasi
cp .env.example .env          # lalu isi nilai rahasia (lihat "Konfigurasi")

# 3) Install dependency (otomatis menjalankan `prisma generate`)
npm install
```

### Opsi A — Docker (disarankan)

Semua layanan (Postgres, Redis, MinIO, backup, web) dikelola lewat helper `bin/zaltrctl`:

```bash
bin/zaltrctl init          # generate .env + secrets acak (sekali saja)
bin/zaltrctl up            # start layanan inti (tanpa membuka port host)
bin/zaltrctl deploy-web    # migrasi DB + build + jalankan container web
bin/zaltrctl status        # cek kondisi container
```

Aplikasi berjalan di `http://localhost:46300` (ubah via `ZALTR_WEB_PORT`).

### Opsi B — Pengembangan (hot-reload)

```bash
npm run dev                # http://localhost:46300
```

> Butuh Postgres/Redis/MinIO aktif. Cara termudah: `bin/zaltrctl up-dev` untuk
> menyalakan layanan inti dengan port loopback, lalu `npm run dev` di host.

## Perintah

| Perintah | Fungsi |
| --- | --- |
| `npm run dev` | Server pengembangan (hot-reload) |
| `npm run build` | Build produksi |
| `npm start` | Jalankan hasil build |
| `npm run lint` | ESLint |
| `npm test` | Unit test (Vitest) |
| `bin/zaltrctl <cmd>` | Orkestrasi Docker (init/up/deploy-web/status/logs) |

## Konfigurasi

Seluruh konfigurasi dibaca dari variabel lingkungan berawalan `ZALTR_`. Salin
`.env.example` menjadi `.env` lalu isi nilainya. Variabel yang dibiarkan kosong akan
menonaktifkan fitur terkait secara aman.

| Kelompok | Variabel | Keterangan |
| --- | --- | --- |
| Data | `ZALTR_POSTGRES_*`, `ZALTR_REDIS_*`, `ZALTR_MINIO_*` | Kredensial Postgres, Redis, MinIO |
| Akses | `ZALTR_PUBLIC_URL`, `ZALTR_GOOGLE_CLIENT_ID/SECRET` | URL publik & login Google (OAuth) |
| Provider | `ZALTR_OLLAMA_URL`, `ZALTR_COPILOT_URL`, `ZALTR_COMFYUI_URL`, `ZALTR_RUNNER_URL` | Endpoint model & sandbox |
| Model | `ZALTR_FREE_MODEL`, `ZALTR_EMBED_MODEL`, `ZALTR_VISION_MODEL` | Model default per-fungsi |
| Integrasi | `ZALTR_VAPID_*`, `ZALTR_SMTP_*`, `ZALTR_TELEGRAM_*` | Web Push, email, notifikasi |
| Batas | `ZALTR_MAX_UPLOAD_MB`, `ZALTR_UPLOAD_QUOTA_GB` | Batas upload & konteks |

> Rahasia sungguhan (`.env`, isi `secrets/`) **tidak pernah** di-commit — lihat `.gitignore`.

## Provider AI

- **Ollama** — jalankan Ollama, isi `ZALTR_OLLAMA_URL`, lalu `ollama pull <model>`. Model muncul otomatis di pemilih.
- **GitHub Copilot** — isi token *service account* di `secrets/copilot_github_token`, aktifkan profile `ai`.
- **ComfyUI** — isi `ZALTR_COMFYUI_URL`; setiap checkpoint tampil sebagai model gambar.

## Struktur Proyek

```
zaltr-ai/
├─ bin/               # zaltrctl & skrip operasi
├─ docker/            # Dockerfile runner/backup, dsb.
├─ prisma/            # schema + migrasi
├─ public/
├─ src/
│  ├─ app/            # App Router: halaman, api/, v1/ (gateway), admin/
│  ├─ components/     # komponen UI React
│  ├─ lib/            # db, redis, storage
│  ├─ server/         # provider AI, agent, auth, billing, dll.
│  └─ generated/      # Prisma client (di-generate saat install)
├─ tests/             # unit test (Vitest)
├─ docker-compose.yml
└─ .env.example
```

## Keamanan & Privasi

- **Local-first**: data pengguna disimpan di Postgres/MinIO milik sendiri.
- Rahasia berada di `.env` dan folder `secrets/` yang **tidak** di-commit.
- Backup harian dienkripsi AES-256.
- *Rate limiting* dan sanitasi input pada boundary API.

## Lisensi

**Proprietary — Hak Cipta Dilindungi (All Rights Reserved).** © 2026 Developer CALYZR.AI RZL.

Kode ini ditampilkan publik **hanya** untuk referensi/transparansi — **bukan** open-source.
Dilarang menggunakan, menyalin, memodifikasi, atau mendistribusikan tanpa izin tertulis.
Selengkapnya di berkas [LICENSE](LICENSE).
