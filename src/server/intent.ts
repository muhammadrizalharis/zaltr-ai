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
