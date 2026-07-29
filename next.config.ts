import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Jalankan sebagai server mandiri di container (docker/web).
  output: "standalone",
  // SDK Copilot memuat addon native (koffi) — jangan dibundle Turbopack,
  // biarkan di-require langsung dari node_modules saat runtime Node.
  serverExternalPackages: ["@github/copilot-sdk", "koffi", "minio"],
};

export default nextConfig;
