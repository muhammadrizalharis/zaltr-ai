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
  let t = s.replace(/\r\n/g, "\n").trim();
  t = t.replace(/^\s*```[\w+-]*[ \t]*\n?/, "");
  const close = t.lastIndexOf("```");
  if (close >= 0 && t.slice(close + 3).trim().length < 200) t = t.slice(0, close);
  return t.trim();
}
