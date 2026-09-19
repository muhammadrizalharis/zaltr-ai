import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/pwa";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "calyzr.ai",
  description:
    "Semua AI terbaik dunia dalam satu ruang kerja pribadi — chat, gambar, video, dan musik.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Calyzr" },
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "calyzr.ai",
    description: "Semua AI terbaik dunia dalam satu ruang kerja pribadi.",
    images: ["/logo-512.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0e14",
  viewportFit: "cover", // aman di HP berponi saat mode layar penuh
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="h-full">
      <body
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        {/* DIAGNOSTIK SEMENTARA (iOS/Safari): tampilkan error JS fatal di layar. Hapus setelah beres. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){function s(m){try{var d=document.getElementById('__cerr');if(!d){d=document.createElement('div');d.id='__cerr';d.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:2147483647;max-height:60vh;overflow:auto;background:#7f1d1d;color:#fff;font:12px/1.45 ui-monospace,monospace;padding:10px;white-space:pre-wrap';(document.body||document.documentElement).appendChild(d)}d.textContent+=m+'\\n\\n'}window.addEventListener('error',function(e){s('[error] '+(e.message||e.type)+' @ '+(e.filename||'')+':'+(e.lineno||0)+':'+(e.colno||0))});window.addEventListener('unhandledrejection',function(e){var r=e&&e.reason;s('[promise] '+((r&&(r.stack||r.message))||String(r)))});s('diagnostik aktif — UA: '+navigator.userAgent)})();",
          }}
        />
        {/* use-credentials: tanpa ini Chrome mengambil manifest TANPA cookie, dan
            proxy publik (mis. halaman peringatan ngrok) membalas HTML — PWA gagal dipasang. */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
