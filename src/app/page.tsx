import Link from "next/link";
import { getSessionUser } from "@/server/auth";

export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const user = await getSessionUser();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-4 md:px-10">
        <span className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-192.png" alt="zaltr.ai" className="h-8 w-8 rounded-lg" />
          <span className="wordmark text-xl font-bold">ZALTR.AI</span>
        </span>
        <nav className="flex items-center gap-3 text-sm">
          {user ? (
            <Link
              href="/chat"
              className="rounded-xl border border-accent-a/60 px-4 py-2 font-medium text-accent-a hover:bg-accent-a/10"
            >
              Buka Chat →
            </Link>
          ) : (
            <>
              <Link href="/login" className="px-3 py-2 text-muted hover:text-ink">
                Masuk
              </Link>
              <Link
                href="/register"
                className="rounded-xl border border-accent-a/60 px-4 py-2 font-medium text-accent-a hover:bg-accent-a/10"
              >
                Daftar
              </Link>
            </>
          )}
        </nav>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-512.png"
          alt="Logo zaltr.ai"
          className="mb-6 h-28 w-28 rounded-3xl shadow-[0_0_60px_rgba(80,220,200,0.35)] md:h-36 md:w-36"
        />
        <h1 className="wordmark text-5xl font-bold tracking-tight md:text-7xl">ZALTR.AI</h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
          Satu ruang kerja AI pribadi — GPT, Claude, dan Gemini via{" "}
          <span className="text-ink">Copilot Enterprise</span>, model lokal{" "}
          <span className="text-ink">Ollama</span>, dan generasi gambar{" "}
          <span className="text-ink">ComfyUI</span>, dalam satu chat.
        </p>

        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          {user ? (
            <Link
              href="/chat"
              className="rounded-2xl bg-accent-a px-7 py-3 font-semibold text-bg hover:opacity-90"
            >
              Lanjut ke Chat
            </Link>
          ) : (
            <>
              <Link
                href="/register"
                className="rounded-2xl bg-accent-a px-7 py-3 font-semibold text-bg hover:opacity-90"
              >
                Daftar Sekarang
              </Link>
              <Link
                href="/login"
                className="rounded-2xl border border-line px-7 py-3 font-semibold hover:border-accent-b/60"
              >
                Masuk
              </Link>
            </>
          )}
        </div>

        <div className="mt-16 grid max-w-3xl grid-cols-1 gap-4 text-left sm:grid-cols-3">
          {[
            ["Semua model, satu tombol", "Ganti GPT, Claude, Gemini, atau model lokal dari picker di samping kolom chat."],
            ["Tidak ada yang hilang", "Setiap pesan tersimpan permanen sebelum model dijalankan. Hapus = trash, bukan musnah."],
            ["Akses terkontrol", "Akun disetujui admin; model dan kredit tiap pengguna diatur per akun."],
          ].map(([judul, isi]) => (
            <div key={judul} className="rounded-2xl border border-line bg-panel p-5">
              <h3 className="mb-1.5 font-semibold text-accent-a">{judul}</h3>
              <p className="text-sm leading-relaxed text-muted">{isi}</p>
            </div>
          ))}
        </div>
      </main>

      <footer className="px-6 py-6 text-center text-xs text-muted">
        zaltr.ai — self-hosted, invitation-only. Pendaftaran menunggu persetujuan admin.
      </footer>
    </div>
  );
}
