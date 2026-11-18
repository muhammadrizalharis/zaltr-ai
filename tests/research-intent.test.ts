import { describe, it, expect } from "vitest";
import { wantsResearch } from "@/server/research";

/** Kalimat yang HARUS memicu riset otomatis (cari sumber/referensi/info terkini di web). */
const POSITIF = [
  "tolong research tentang dampak AI di pendidikan",
  "lakukan riset pasar kopi di Indonesia",
  "bisa tolong riset kompetitor untuk startup logistik?",
  "deep research soal energi surya di NTT",
  "carikan referensi jurnal tentang machine learning",
  "cari jurnal terbaru soal stunting",
  "cariin paper tentang transformer",
  "cari paper tentang graph neural network 2024",
  "bisa cari referensi untuk skripsi saya tentang UMKM?",
  "tolong carikan literatur tentang motivasi belajar",
  "Find papers about graph neural networks",
  "find me some references on LLM evaluation",
  "search for journal articles about microplastics",
  "I need credible sources about intermittent fasting",
  "buat tinjauan pustaka tentang e-commerce",
  "systematic review metode pembelajaran daring",
  "cari penelitian terdahulu tentang kepuasan pelanggan",
  "state of the art deteksi hoaks bahasa Indonesia",
  "cari di internet harga emas hari ini",
  "cari di web tentang regulasi PDP terbaru",
  "googling dulu tentang vaksin HPV",
  "cari berita terbaru tentang banjir jakarta",
  "carikan informasi terbaru tentang tarif PPN",
  "cari sumber terpercaya tentang manfaat kunyit",
  "harga emas hari ini berapa?",
  "berita terkini soal pemilu",
  "kurs dolar sekarang berapa?",
  "cuaca besok di Makassar",
  "browse tentang kebijakan kampus merdeka",
  "tolong telusuri artikel ilmiah tentang kecerdasan emosional",
  "carikan data statistik penduduk Sulawesi Selatan terbaru",
  "cari tahu perkembangan terbaru GPT di tahun ini",
];

/** Kalimat yang TIDAK boleh memicu (obrolan, kode, dokumen yang diunggah, istilah ambigu). */
const NEGATIF = [
  "halo, apa kabar?",
  "jelaskan apa itu rekursi",
  "buatkan fungsi python untuk sorting",
  "terjemahkan kalimat ini ke bahasa inggris",
  "apa sumber masalah di kode saya ini?",
  "temukan sumber bug di fungsi ini",
  "find the source of this memory leak",
  "cari data yang duplikat di tabel excel ini",
  "carikan baris yang kosong di file csv",
  "cari informasi tentang tanggal di dokumen yang saya upload",
  "cari kata 'anggaran' di pdf yang saya lampirkan",
  "ringkas dokumen yang saya upload",
  "kenapa langit biru?",
  "apa saja sumber protein untuk vegetarian?",
  "sumber energi terbarukan itu apa saja?",
  "buatkan jurnal penyesuaian untuk PT Maju Jaya",
  "contoh jurnal umum transaksi penjualan kredit",
  "buatkan jurnal harian untuk bayi umur 3 bulan",
  "tulis jurnal refleksi tentang hari ini",
  "perbaiki daftar referensi di bawah ini agar format APA",
  "ubah format referensi saya ke gaya IEEE",
  "tolong cek tata bahasa paragraf ini",
  "buatkan puisi tentang hujan",
  "hitung 15% dari 2.400.000",
  "jelaskan perbedaan TCP dan UDP",
  "buatkan email permohonan izin cuti",
  "apa itu data science?",
  "studi kasus apa yang cocok untuk tugas akhir manajemen?",
  "bagaimana cara membuat studi kelayakan usaha?",
  "tolong rangkum artikel berikut: " + "isi artikel ".repeat(30),
  "bikinkan makalah tentang demokrasi, jangan lupa sertakan daftar pustaka",
  "sumber: wikipedia. tolong parafrase kalimat ini",
  "research design apa yang cocok untuk survei kuantitatif?",
  "jelaskan metode riset kualitatif dan kuantitatif",
];

describe("wantsResearch: held-out (ditulis TANPA melihat pola, untuk menguji generalisasi)", () => {
  it.each([
    "bantu aku cari referensi buat makalah sosiologi",
    "tolong cari jurnal internasional tentang blockchain di supply chain",
    "carikan artikel ilmiah soal pengaruh media sosial pada remaja",
    "what are the latest papers on diffusion models? search for them",
    "riset singkat tentang tren fintech 2026 dong",
    "kabar terbaru soal harga BBM",
    "tolong cari informasi tentang beasiswa LPDP terbaru",
    "boleh tolong carikan data statistik kemiskinan terbaru?",
    "cari di google scholar tentang self-efficacy",
    "I'm looking for references on climate adaptation",
  ])("memicu: %s", (t) => {
    expect(wantsResearch(t)).toBe(true);
  });

  it.each([
    "bagaimana cara menulis referensi dengan Mendeley?",
    "apa itu jurnal ilmiah dan bedanya dengan prosiding?",
    "buat kode python untuk mencari data di dictionary",
    "tolong periksa sitasi di paragraf ini apakah sudah benar",
    "buatkan tabel perbandingan harga laptop",
    "apa kabar hari ini?",
    "jelaskan cara kerja mesin pencari google",
    "tulis cerita pendek tentang detektif yang mencari petunjuk",
    "kerjakan soal statistika berikut: hitung rata-rata 4, 6, 8",
    "berapa kurs 1 dolar ke rupiah di soal ini jika kursnya 15.000?",
  ])("TIDAK memicu: %s", (t) => {
    expect(wantsResearch(t)).toBe(false);
  });
});

describe("wantsResearch: korpus berlabel", () => {
  it.each(POSITIF)("memicu: %s", (t) => {
    expect(wantsResearch(t)).toBe(true);
  });

  it.each(NEGATIF)("TIDAK memicu: %s", (t) => {
    expect(wantsResearch(t)).toBe(false);
  });

  it("naskah panjang yang hanya menyebut 'carikan referensi' di ujung tidak memicu", () => {
    expect(wantsResearch("perbaiki paragraf berikut. " + "x ".repeat(400) + " carikan referensi")).toBe(false);
  });

  it("kosong/spasi tidak memicu", () => {
    expect(wantsResearch("")).toBe(false);
    expect(wantsResearch("   \n  ")).toBe(false);
  });
});
