import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Jalankan sebagai server mandiri di container (docker/web).
  output: "standalone",
  // SDK Copilot memuat addon native (koffi) — jangan dibundle Turbopack,
  // biarkan di-require langsung dari node_modules saat runtime Node.
  // pdf-parse: CJS dengan kode debug path-relatif — juga jangan dibundle.
  serverExternalPackages: ["@github/copilot-sdk", "koffi", "minio", "pdf-parse"],
  // Security headers dasar (aman, tanpa risiko merusak app). CSP penuh dipisah
  // agar bisa diuji tersendiri.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(self), geolocation=(), browsing-topics=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "frame-ancestors 'self'",
              "form-action 'self'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "style-src 'self' 'unsafe-inline'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com",
              "connect-src 'self' https://cloudflareinsights.com",
              "media-src 'self' blob: data:",
              "worker-src 'self' blob:",
              "manifest-src 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
