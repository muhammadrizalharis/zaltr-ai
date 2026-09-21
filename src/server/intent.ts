/**
 * Deteksi permintaan yang memerlukan TINDAKAN di workspace (bukan sekadar
 * jawaban teks): kata kerja aksi + objek artefak. Memicu mode agen otomatis
 * di /api/chat walau toggle "Agent" tidak dinyalakan pengguna.
 */
const VERB =
  /\b(buat|buatkan|bikin|bikinkan|generate|hasilkan|ekspor|export|konversi|convert|ubah|edit|sunting|revisi|perbaiki|gabung|merge|pisah|split|jalankan|eksekusi|run|render|susun|tulis(?:kan)? ke|simpan (?:ke|sebagai)|unduh|download)\b/;
const ARTEFAK =
  /\b(pdf|docx?|word|excel|xlsx|csv|pptx?|powerpoint|slide|zip|file|berkas|dokumen|folder|direktori|skrip|script|program|notebook|laporan(?: dalam| ke| format)?|tabel ke|grafik ke|chart ke)\b/;

export function wantsAction(text: string): boolean {
  const t = text.toLowerCase();
  return VERB.test(t) && ARTEFAK.test(t);
}

/**
 * Bersihkan fence ```lang ... ``` bila model membungkus kode/perintah.
 * Toleran: fence pembuka boleh di baris mana pun di awal; penutup di akhir
 * boleh diikuti teks penjelasan singkat (ikut dibuang).
 */
export function unfenceCode(s: string): string {
  const t = s.replace(/\r\n/g, "\n").trim();
  // Ada fence pembuka di awal -> ambil isi sampai fence PENUTUP pertama (teks
  // penjelasan setelahnya dibuang, berapa pun panjangnya).
  const open = t.match(/^\s*```[\w+-]*[ \t]*\n?/);
  if (open) {
    const rest = t.slice(open[0].length);
    const close = rest.indexOf("\n```");
    return (close >= 0 ? rest.slice(0, close) : rest.replace(/\n?```\s*$/, "")).trim();
  }
  // Tanpa fence pembuka di awal tapi ada blok fence di tengah -> ambil blok pertama.
  const mid = t.match(/```[\w+-]*[ \t]*\n([\s\S]*?)\n```/);
  if (mid) return mid[1].trim();
  return t;
}
