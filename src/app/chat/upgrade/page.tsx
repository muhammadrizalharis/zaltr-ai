import Link from "next/link";

export const metadata = { title: "Beli Kredit — zaltr.ai" };

/**
 * Halaman upgrade/beli kredit. Pembayaran masih manual: pengguna memilih
 * paket lalu menghubungi admin (kontak diatur via env ZALTR_CONTACT_URL).
 * Kredit ditambahkan admin dari halaman Admin setelah pembayaran.
 */

const PAKET: Array<{ nama: string; kredit: number; harga: string; catatan: string; unggulan?: boolean }> = [
  { nama: "Starter", kredit: 100, harga: "Rp15.000", catatan: "±100 pesan model premium" },
  { nama: "Plus", kredit: 500, harga: "Rp60.000", catatan: "±500 pesan — hemat 20%", unggulan: true },
  { nama: "Power", kredit: 1500, harga: "Rp150.000", catatan: "±1.500 pesan — hemat 33%" },
];

export default function UpgradePage() {
  const kontak = process.env.ZALTR_CONTACT_URL ?? "";
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-bold">
        Buka <span className="wordmark">semua model</span>
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
        Paket Free memakai model ringan. Dengan kredit, kamu membuka model premium
        paling pintar plus studio gambar, video, dan musik. 1 kredit = 1 pesan model premium;
        model gratis tetap tanpa batas.
      </p>

      <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {PAKET.map((p) => (
          <div
            key={p.nama}
            className={`lift rounded-2xl border p-5 ${
              p.unggulan
                ? "border-accent-a/60 bg-accent-a/5"
                : "border-line bg-panel"
            }`}
          >
            {p.unggulan && (
              <span className="rounded-full bg-accent-a px-2 py-0.5 text-[10px] font-bold uppercase text-black">
                Paling laris
              </span>
            )}
            <h2 className="mt-2 text-lg font-semibold">{p.nama}</h2>
            <p className="mt-1 text-3xl font-bold text-accent-a">
              {p.kredit.toLocaleString("id-ID")}
              <span className="ml-1 text-sm font-normal text-muted">kredit</span>
            </p>
            <p className="mt-1 font-semibold">{p.harga}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted">{p.catatan}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-2xl border border-line bg-panel p-6">
        <h3 className="font-semibold">Cara membeli</h3>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
          <li>Pilih paket di atas.</li>
          <li>Hubungi admin dan sebutkan email akunmu + paket yang dipilih.</li>
          <li>Setelah pembayaran dikonfirmasi, kredit langsung masuk ke akunmu.</li>
        </ol>
        <div className="mt-5 flex flex-wrap gap-3">
          {kontak ? (
            <a
              href={kontak}
              target="_blank"
              rel="noreferrer"
              className="rounded-xl bg-gradient-to-r from-accent-a to-accent-b px-5 py-2.5 text-sm font-semibold text-black hover:opacity-90"
            >
              Hubungi Admin →
            </a>
          ) : (
            <p className="text-sm text-muted">
              Hubungi admin zaltr.ai yang mengundangmu untuk menyelesaikan pembayaran.
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
