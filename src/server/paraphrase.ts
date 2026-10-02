/**
 * Parafrase substantif: merombak alur & struktur kalimat dari pemahaman isi,
 * bukan menukar sinonim (word spinning). Istilah teknis sengaja DIPERTAHANKAN.
 */

export const MODE_PARAFRASE = {
  akademik: "Akademik",
  sederhana: "Sederhanakan",
  ringkas: "Ringkas",
  formal: "Formal",
  perbaiki: "Perbaiki EYD",
} as const;

export type ModeParafrase = keyof typeof MODE_PARAFRASE;

export function isModeParafrase(v: string): v is ModeParafrase {
  return v in MODE_PARAFRASE;
}

const DASAR = `Kamu penyunting akademik. Tulis ULANG teks pengguna di bawah ini.

PRINSIP WAJIB
1. Pahami dulu maksud dan argumennya, lalu tuliskan kembali dari pemahaman itu.
   DILARANG sekadar mengganti kata dengan sinonim (word spinning).
2. Rombak ALUR PENJELASANNYA, bukan hanya kosakata: urutan sebab-akibat boleh
   dibalik, kalimat boleh digabung atau dipecah, sudut pandang kalimat boleh
   diubah (aktif/pasif), penekanan boleh dipindah — selama maknanya utuh.
   Contoh: "Faktor A menyebabkan B karena C" dapat menjadi
   "C menjelaskan mekanisme yang menghubungkan A dengan B; ketika A meningkat, B
   ikut menguat karena ..."
3. PERTAHANKAN apa adanya: istilah teknis (machine learning, explainable AI,
   antimicrobial resistance, dsb), nama algoritma/metode, nama variabel,
   terminologi metodologi, satuan, angka, dan data. Istilah teknis memang wajar
   sama dengan literatur lain — jangan diganti hanya demi terlihat berbeda.
4. JANGAN mengubah klaim, temuan, arah hubungan, maupun kekuatan pernyataan.
   Jangan menambah fakta, angka, atau rujukan baru.
5. BAHASA: tulis hasil dalam bahasa yang SAMA dengan teks asli — JANGAN
   menerjemahkan (teks Inggris -> hasil Inggris; teks Indonesia -> hasil Indonesia).
   Bila pengguna secara eksplisit meminta bahasa tertentu, ikuti permintaan itu.
6. Jangan menyebut proses ini. Keluarkan hasil tulisannya saja.`;

const GAYA: Record<ModeParafrase, string> = {
  akademik:
    "GAYA: ragam ilmiah yang efektif dan lugas (dalam bahasa teks asli). Hindari " +
    "kalimat berbelit dan kata mubazir. Susun sebagai paragraf yang mengalir, bukan poin-poin.",
  sederhana:
    "GAYA: bahasa sehari-hari yang mudah dipahami pembaca awam. Uraikan istilah " +
    "sulit secara singkat dalam kurung, tetapi istilah teknisnya tetap ditulis.",
  ringkas:
    "GAYA: padatkan hingga sekitar setengah panjang aslinya tanpa membuang " +
    "informasi penting, angka, maupun kesimpulan.",
  formal:
    "GAYA: formal dan profesional untuk keperluan resmi/korespondensi akademik. " +
    "Hindari bentuk percakapan.",
  perbaiki:
    "GAYA: pertahankan struktur asli semaksimal mungkin. Perbaiki hanya ejaan, " +
    "tanda baca, tata bahasa, dan kalimat yang tidak efektif sesuai kaidah baku " +
    "bahasa teks (mis. EYD untuk Bahasa Indonesia).",
};

/** Instruksi yang disisipkan ke pesan pengguna sebelum dikirim ke model. */
export function promptParafrase(mode: ModeParafrase, teks: string): string {
  return `${DASAR}\n\n${GAYA[mode]}\n\n=== TEKS YANG DIPARAFRASE ===\n${teks}\n=== AKHIR TEKS ===`;
}
