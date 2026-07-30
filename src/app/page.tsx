import Link from "next/link";
import { getSessionUser } from "@/server/auth";

export const dynamic = "force-dynamic";

const MODELS = [
  "GPT-5", "Claude Opus", "Gemini Pro", "Claude Sonnet", "GPT Codex",
  "Llama 3", "Qwen Coder", "Phi Reasoning", "FLUX", "Wan Video", "ACE Music",
];

const FITUR: Array<[string, string, string]> = [
  ["🧠", "Semua model unggulan", "GPT, Claude, Gemini, dan puluhan model lain dalam satu tempat — ganti model semudah satu klik, di tengah percakapan sekalipun."],
  ["🎨", "Studio media", "Buat gambar berkualitas tinggi, video pendek, dan musik hanya dari teks. Semua hasil tersimpan otomatis di galeri percakapanmu."],
  ["📎", "Membaca semua file", "Lampirkan PDF, Word, PowerPoint, Excel, gambar, atau kode — AI membaca isinya dan menjawab langsung dari dokumenmu."],
  ["🌐", "Terhubung ke internet", "Nyalakan mode cari web dan AI menjawab dengan informasi terkini lengkap dengan tautan sumbernya."],
  ["💾", "Mengingatmu", "Memori antar percakapan dan instruksi pribadi — AI tahu siapa kamu, proyekmu, dan gaya jawaban yang kamu suka."],
  ["⚡", "Menjalankan kode", "Blok Python di jawaban AI bisa langsung dieksekusi di lingkungan aman yang terisolasi — hasil tampil di chat."],
];

export default async function WelcomePage() {
  const user = await getSessionUser();

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      {/* Scene landing: foto kota neon + aurora + orb + partikel */}
      <div className="scene-city" aria-hidden />
      <div className="scene-city-veil" aria-hidden />
      <div className="fx-layer" aria-hidden>
        <div className="anim-aurora absolute inset-0" />
        <div className="orb left-[-80px] top-[8%] h-72 w-72 bg-accent-a/40" />
        <div className="orb right-[-60px] top-[38%] h-80 w-80 bg-accent-b/40 [animation-delay:-5s]" />
        <div className="orb bottom-[-110px] left-[28%] h-96 w-96 bg-pink-500/25 [animation-delay:-9s]" />
        <div className="fx-p fx-p1" />
        <div className="fx-p fx-p2" />
      </div>
      {/* Bola cahaya melayang di latar */}

      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-line/50 bg-bg/70 px-6 py-3.5 backdrop-blur md:px-10">
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

      <main className="relative z-10 flex flex-1 flex-col items-center px-6 pb-20 pt-14 text-center md:pt-20">
        <span className="fade-up d1 rounded-full border border-line bg-panel/70 px-4 py-1.5 text-xs tracking-wide text-muted backdrop-blur">
          ✦ Self-hosted · Invitation only · Selalu aktif
        </span>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo-512.png"
          alt="Logo zaltr.ai"
          className="anim-float glow-pulse fade-up d2 mt-8 h-28 w-28 rounded-3xl md:h-36 md:w-36"
        />
        <h1 className="wordmark-flow fade-up d3 mt-6 text-5xl font-bold tracking-tight md:text-7xl">
          ZALTR.AI
        </h1>
        <p className="fade-up d4 mt-5 max-w-xl text-lg leading-relaxed text-muted">
          Semua AI terbaik dunia dalam <span className="text-ink">satu ruang kerja pribadi</span>.
          Chat, gambar, video, musik — cepat, privat, dan tanpa batas platform.
        </p>

        <div className="fade-up d5 mt-9 flex flex-wrap items-center justify-center gap-3">
          {user ? (
            <Link
              href="/chat"
              className="rounded-2xl bg-accent-a px-7 py-3 font-semibold text-bg transition-transform hover:scale-105"
            >
              Lanjut ke Chat
            </Link>
          ) : (
            <>
              <Link
                href="/register"
                className="rounded-2xl bg-accent-a px-7 py-3 font-semibold text-bg transition-transform hover:scale-105"
              >
                Daftar Sekarang
              </Link>
              <Link
                href="/login"
                className="rounded-2xl border border-line bg-panel/60 px-7 py-3 font-semibold backdrop-blur transition-colors hover:border-accent-b/60"
              >
                Masuk
              </Link>
            </>
          )}
        </div>

        {/* Statistik singkat */}
        <div className="fade-up d6 mt-12 grid w-full max-w-2xl grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["40+", "model AI"],
            ["4-in-1", "chat · gambar · video · musik"],
            ["24/7", "selalu aktif"],
            ["100%", "datamu milikmu"],
          ].map(([angka, label]) => (
            <div key={label} className="rounded-2xl border border-line bg-panel/60 px-3 py-4 backdrop-blur">
              <p className="text-2xl font-bold text-accent-a">{angka}</p>
              <p className="mt-1 text-[11px] leading-tight text-muted">{label}</p>
            </div>
          ))}
        </div>

        {/* Marquee model bergulir */}
        <div className="relative mt-14 w-full max-w-4xl overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_15%,black_85%,transparent)]">
          <div className="marquee-track">
            {[...MODELS, ...MODELS].map((m, i) => (
              <span
                key={`${m}-${i}`}
                className="whitespace-nowrap rounded-full border border-line bg-panel/70 px-4 py-1.5 text-sm text-muted backdrop-blur"
              >
                {m}
              </span>
            ))}
          </div>
        </div>

        {/* Fitur */}
        <div className="mt-16 grid w-full max-w-4xl grid-cols-1 gap-4 text-left sm:grid-cols-2 lg:grid-cols-3">
          {FITUR.map(([ikon, judul, isi], i) => (
            <div
              key={judul}
              className={`lift fade-up d${(i % 6) + 1} rounded-2xl border border-line bg-panel/70 p-5 backdrop-blur`}
            >
              <span className="text-2xl">{ikon}</span>
              <h3 className="mb-1.5 mt-2 font-semibold text-accent-a">{judul}</h3>
              <p className="text-sm leading-relaxed text-muted">{isi}</p>
            </div>
          ))}
        </div>

        {/* Janji privasi */}
        <div className="lift mt-14 w-full max-w-4xl rounded-3xl border border-line bg-panel/70 p-8 text-left backdrop-blur md:p-10">
          <h2 className="text-xl font-bold md:text-2xl">
            Milikmu <span className="wordmark">sepenuhnya</span>.
          </h2>
          <p className="mt-3 max-w-2xl leading-relaxed text-muted">
            Tidak ada pihak ketiga yang membaca datamu. Setiap pesan tersimpan permanen
            sebelum AI menjawab — riwayatmu tidak pernah hilang. Akun baru hanya aktif
            setelah disetujui, jadi ruang kerja ini tetap milik kalangan terbatas.
          </p>
          {!user && (
            <Link
              href="/register"
              className="mt-6 inline-block rounded-2xl bg-accent-a px-6 py-2.5 font-semibold text-bg transition-transform hover:scale-105"
            >
              Minta Akses →
            </Link>
          )}
        </div>
      </main>

      <footer className="relative z-10 border-t border-line/50 px-6 py-6 text-center text-xs text-muted">
        © {new Date().getFullYear()} zaltr.ai — ruang kerja AI pribadi.
      </footer>
    </div>
  );
}
