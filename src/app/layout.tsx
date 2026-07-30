import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "zaltr.ai",
  description:
    "Semua AI terbaik dunia dalam satu ruang kerja pribadi — chat, gambar, video, dan musik.",
  icons: {
    icon: "/favicon.png",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "zaltr.ai",
    description: "Semua AI terbaik dunia dalam satu ruang kerja pribadi.",
    images: ["/logo-512.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className="h-full">
      <body
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        {/* Efek hidup di SEMUA halaman: aurora, bola cahaya, partikel naik */}
        <div className="fx-layer" aria-hidden>
          <div className="anim-aurora absolute inset-0" />
          <div className="orb left-[-80px] top-[8%] h-72 w-72 bg-accent-a/40" />
          <div className="orb right-[-60px] top-[38%] h-80 w-80 bg-accent-b/40 [animation-delay:-5s]" />
          <div className="orb bottom-[-110px] left-[28%] h-96 w-96 bg-pink-500/25 [animation-delay:-9s]" />
          <div className="fx-p fx-p1" />
          <div className="fx-p fx-p2" />
        </div>
        {children}
      </body>
    </html>
  );
}
