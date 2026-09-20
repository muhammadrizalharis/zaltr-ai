import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ServiceWorkerRegister } from "@/components/pwa";
import { ClientErrorReporter } from "@/components/client-error-reporter";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.ZALTR_PUBLIC_URL || "https://calyzr-ai.my.id"),
  title: { default: "calyzr.ai", template: "%s · calyzr.ai" },
  applicationName: "CALYZR.AI",
  description:
    "Semua AI terbaik dunia dalam satu ruang kerja pribadi — chat, gambar, video, dan musik.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Calyzr" },
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "CALYZR.AI",
    title: "calyzr.ai — semua AI dalam satu ruang kerja",
    description: "Chat, gambar, video, musik, dan analisa dokumen — satu akun pribadi.",
    images: [{ url: "/logo-512.png", width: 512, height: 512, alt: "CALYZR.AI" }],
  },
  twitter: {
    card: "summary",
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
        {/* use-credentials: tanpa ini Chrome mengambil manifest TANPA cookie, dan
            proxy publik (mis. halaman peringatan ngrok) membalas HTML — PWA gagal dipasang. */}
        <link rel="manifest" href="/manifest.webmanifest" crossOrigin="use-credentials" />
        {children}
        <ServiceWorkerRegister />
        <ClientErrorReporter />
      </body>
    </html>
  );
}
