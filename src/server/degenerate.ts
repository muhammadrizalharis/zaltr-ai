/**
 * Deteksi keluaran model yang DEGENERASI (repetition loop): pola pendek berulang
 * tanpa henti, mis. "jet_mass 0.0 pricing 0.0 matcher 0.0 …". Dipakai gateway/agen
 * untuk MEMUTUS stream lebih awal — hemat kredit & waktu pengguna, UI tak banjir.
 */

const WINDOW = 1200; // karakter terakhir yang diperiksa

export function isDegenerate(text: string): boolean {
  if (text.length < WINDOW) return false;
  const tail = text.slice(-WINDOW);

  // (1) Substring pendek (<=60 char) berulang >= 10x berturut-turut di ekor
  // (mis. "halo halo halo", "abcabcabc").
  for (let len = 1; len <= 60; len++) {
    const unit = tail.slice(-len);
    if (!unit.trim()) continue;
    let reps = 0;
    for (let i = tail.length - len; i >= 0 && tail.slice(i, i + len) === unit; i -= len) reps++;
    if (reps >= 10) return true;
  }

  const tokens = tail.split(/\s+/).filter(Boolean);
  if (tokens.length < 80) return false;

  // (2) Satu token mendominasi >= 35% posisi (mis. "0.0" di tiap posisi genap)
  // DAN token unik rendah -> daftar "kata 0.0 kata 0.0 ...". Prosa/kode normal
  // tak punya satu token yang mendominasi sebesar itu.
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  const top = Math.max(...freq.values());
  const uniqRatio = freq.size / tokens.length;
  if (top / tokens.length >= 0.35 && uniqRatio < 0.6) return true;

  // (3) Bigram: pasangan token yang sama berulang >= 25% dari semua bigram.
  const bi = new Map<string, number>();
  for (let i = 1; i < tokens.length; i++) {
    const k = tokens[i - 1] + " " + tokens[i];
    bi.set(k, (bi.get(k) ?? 0) + 1);
  }
  const topBi = Math.max(...bi.values());
  if (topBi / (tokens.length - 1) >= 0.25) return true;

  return false;
}

/** Potong ekor degenerasi: buang bagian berulang, sisakan teks bermakna di depan. */
export function trimDegenerate(text: string): string {
  const cut = Math.max(0, text.length - WINDOW);
  const head = text.slice(0, cut).trimEnd();
  return head + (head ? "\n\n" : "") + "_(keluaran dihentikan: model mulai mengulang tanpa henti — coba ulangi permintaan atau ganti model)_";
}
