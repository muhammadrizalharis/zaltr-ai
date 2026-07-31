import Link from "next/link";
import { getSessionUser } from "@/server/auth";

export const metadata = { title: "Beli Kredit — calyzr.ai" };
export const dynamic = "force-dynamic";

/**
 * Halaman upgrade/beli kredit. Pembayaran manual via WhatsApp:
 * tombol paket membuka wa.me admin (env ZALTR_WA_ADMIN, format 628xxxx)
 * dengan pesan berisi email user + paket terpilih yang sudah terketik.
 * Kredit ditambahkan admin dari halaman Admin setelah pembayaran.
 */

const PAKET: Array<{
  nama: string;
  kredit: number | null;
  harga: string;
  limit: string;
  fitur: string[];
  unggulan?: boolean;
}> = [
  {
    nama: "Free",
    kredit: null,
    harga: "Gratis",
    limit: "100 pesan / hari",
    fitur: [
      "Model Calyzr Free (ringan & cepat)",
      "Riwayat chat tersimpan permanen",
      "Projects & folder chat",
    ],
  },
  {
    nama: "Starter",
    kredit: 100,
    harga: "Rp15.000",
    limit: "1.000 pesan / hari",
    fitur: [
      "Model Calyzr Free (ringan & cepat)",
      "Riwayat chat tersimpan permanen",
      "Projects & folder chat",
      "Semua model Calyzr Turbo",
      "Model premium kelas cepat (Haiku, GPT Mini, Flash)",
      "Lampiran file + web search + memori",
    ],
  },
  {
    nama: "Plus",
    kredit: 500,
    harga: "Rp60.000",
    limit: "3.000 pesan / hari",
    fitur: [
      "Model Calyzr Free (ringan & cepat)",
      "Riwayat chat tersimpan permanen",
      "Projects & folder chat",
      "Semua model Calyzr Turbo",
      "Model premium kelas cepat (Haiku, GPT Mini, Flash)",
      "Lampiran file + web search + memori",
      "Model kelas utama (Sonnet, GPT-5, Gemini Pro)",
      "Studio gambar (teks → gambar HD)",
      "Eksekusi kode Python di chat",
    ],
    unggulan: true,
  },
  {
    nama: "Power",
    kredit: 1500,
    harga: "Rp150.000",
    limit: "TANPA batas pesan harian",
    fitur: [
      "Model Calyzr Free (ringan & cepat)",
      "Riwayat chat tersimpan permanen",
      "Projects & folder chat",
      "Semua model Calyzr Turbo",
      "Model premium kelas cepat (Haiku, GPT Mini, Flash)",
      "Lampiran file + web search + memori",
      "Model kelas utama (Sonnet, GPT-5, Gemini Pro)",
      "Studio gambar (teks → gambar HD)",
      "Eksekusi kode Python di chat",
      "SEMUA model termasuk kelas flagship (Opus dkk)",
      "Studio penuh: gambar + video + musik",
      "Prioritas dukungan admin",
    ],
  },
];

export default async function UpgradePage() {
  const user = await getSessionUser();
  const waAdmin = (process.env.ZALTR_WA_ADMIN ?? "").replace(/[^0-9]/g, "");

  const waLink = (p: (typeof PAKET)[number]) => {
    const pesan = [
      "Halo Admin calyzr.ai, saya ingin upgrade paket.",
      "",
      `Email akun: ${user?.email ?? "-"}`,
      `Paket: ${p.nama}${p.kredit ? ` (${p.kredit.toLocaleString("id-ID")} kredit — ${p.harga})` : ""}`,
      "",
      "Mohon info cara pembayarannya. Terima kasih.",
    ].join("\n");
    return `https://wa.me/${waAdmin}?text=${encodeURIComponent(pesan)}`;
  };

  const waUmum = `https://wa.me/${waAdmin}?text=${encodeURIComponent(
    `Halo Admin calyzr.ai, saya ${user?.email ?? ""} ingin bertanya soal upgrade paket / pembayaran.`
  )}`;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-bold">
        Buka <span className="wordmark">semua model</span>
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
        Paket Free: model ringan gratis, 100 pesan/hari. Dengan paket berbayar kamu
        membuka model premium yang jauh lebih pintar, limit lebih longgar, dan studio
        media. 1 kredit = 1 pesan model premium; model gratis & Turbo tidak memakai kredit.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PAKET.map((p) => (
          <div
            key={p.nama}
            className={`lift flex flex-col rounded-2xl border p-5 ${
              p.unggulan
                ? "border-accent-a/60 bg-accent-a/5"
                : "border-line bg-panel"
            }`}
          >
            {p.unggulan && (
              <span className="self-start rounded-full bg-accent-a px-2 py-0.5 text-[10px] font-bold uppercase text-black">
                Paling laris
              </span>
            )}
            <h2 className="mt-2 text-lg font-semibold">{p.nama}</h2>
            {p.kredit === null ? (
              <p className="mt-1 text-3xl font-bold text-accent-a">0
                <span className="ml-1 text-sm font-normal text-muted">kredit</span>
              </p>
            ) : (
              <p className="mt-1 text-3xl font-bold text-accent-a">
                {p.kredit.toLocaleString("id-ID")}
                <span className="ml-1 text-sm font-normal text-muted">kredit</span>
              </p>
            )}
            <p className="mt-1 font-semibold">{p.harga}</p>
            <p className="mt-1 text-xs font-semibold text-accent-b">{p.limit}</p>
            <ul className="mt-3 space-y-1.5 text-xs leading-relaxed text-muted">
              {p.fitur.map((f) => (
                <li key={f} className="flex gap-1.5">
                  <span className="text-accent-a">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            {p.kredit !== null && waAdmin && (
              <a
                href={waLink(p)}
                target="_blank"
                rel="noreferrer"
                className={`mt-4 rounded-xl py-2 text-center text-sm font-semibold transition-opacity hover:opacity-90 ${
                  p.unggulan
                    ? "bg-gradient-to-r from-accent-a to-accent-b text-black"
                    : "border border-accent-a/50 text-accent-a hover:bg-accent-a/10"
                }`}
              >
                Pilih {p.nama} →
              </a>
            )}
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-line bg-panel p-6">
        <h3 className="font-semibold">Cara membeli</h3>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
          <li>Klik tombol paket di atas — WhatsApp terbuka dengan pesan yang sudah terisi email akunmu dan paket pilihanmu.</li>
          <li>Kirim pesannya; admin membalas dengan nomor rekening/cara bayar.</li>
          <li>Setelah pembayaran dikonfirmasi, kredit & paket langsung aktif di akunmu.</li>
        </ol>
        <div className="mt-5 flex flex-wrap gap-3">
          {waAdmin ? (
            <a
              href={waUmum}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl bg-gradient-to-r from-accent-a to-accent-b px-5 py-2.5 text-sm font-semibold text-black hover:opacity-90"
            >
              Chat Admin via WhatsApp →
            </a>
          ) : (
            <p className="text-sm text-muted">
              Hubungi admin calyzr.ai yang mengundangmu untuk menyelesaikan pembayaran.
            </p>
          )}
          <Link
            href="/chat"
            className="rounded-xl border border-line px-5 py-2.5 text-sm hover:border-accent-b/60"
          >
            ← Kembali ke chat
          </Link>
        </div>
      </div>
    </div>
  );
}
