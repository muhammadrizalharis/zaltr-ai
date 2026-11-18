import { describe, it, expect } from "vitest";
import { buildSearchQuery, keywordQuery } from "@/server/research";

describe("buildSearchQuery: kalimat perintah -> kata kunci pencarian", () => {
  it.each([
    // [masukan, keluaran yang diharapkan]
    ["cari berita terbaru tentang harga emas hari ini, ringkas 2 kalimat dengan link", "berita terbaru tentang harga emas hari ini"],
    ["carikan referensi jurnal tentang stunting di Sulawesi, sebutkan 3 saja dengan link, singkat", "referensi jurnal tentang stunting di Sulawesi"],
    ["tolong research tentang dampak AI di pendidikan", "dampak AI di pendidikan"],
    ["tolong carikan literatur tentang motivasi belajar", "literatur tentang motivasi belajar"],
    ["bisa tolong riset kompetitor untuk startup logistik?", "kompetitor untuk startup logistik"],
    ["lakukan riset pasar kopi di Indonesia", "pasar kopi di Indonesia"],
    ["I need credible sources about intermittent fasting", "credible sources about intermittent fasting"],
    ["find me some references on LLM evaluation", "references on LLM evaluation"],
    ["Find papers about graph neural networks, summarize each in one line", "papers about graph neural networks"],
    ["cari tahu perkembangan terbaru GPT tahun ini dong", "perkembangan terbaru GPT tahun ini"],
    ["carikan data statistik kemiskinan terbaru, tampilkan dalam bentuk tabel", "data statistik kemiskinan terbaru"],
    ["harga emas hari ini berapa?", "harga emas hari ini berapa"],
    ["kurs dolar sekarang berapa?", "kurs dolar sekarang berapa"],
  ])("%s", (input, expected) => {
    expect(buildSearchQuery(input)).toBe(expected);
  });

  it("kata akademik dipertahankan (memandu mesin & deteksi pencarian ilmiah)", () => {
    const q = buildSearchQuery("carikan jurnal tentang machine learning, singkat saja");
    expect(q).toContain("jurnal");
    expect(q).not.toMatch(/singkat|carikan/);
  });

  it("topik yang kebetulan memuat kata perintah di tengah tidak dirusak", () => {
    expect(buildSearchQuery("cari tahu cara membuat jurnal umum akuntansi")).toBe("cara membuat jurnal umum akuntansi");
    expect(buildSearchQuery("berita tentang buat kerajinan dari bambu")).toContain("kerajinan dari bambu");
  });

  it("hanya baris pertama yang dipakai, panjang dibatasi 300", () => {
    expect(buildSearchQuery("carikan referensi tentang X\nbaris kedua yang tak relevan")).toBe("referensi tentang X");
    expect(buildSearchQuery("carikan " + "a".repeat(500)).length).toBeLessThanOrEqual(300);
  });

  it("hasil terlalu pendek -> kembali ke kalimat asli (tak pernah kosong)", () => {
    expect(buildSearchQuery("cari")).toBe("cari");
    expect(buildSearchQuery("tolong cari dong")).not.toBe("");
  });

  it("tidak membuang kata topik yang mirip kata instruksi sebagai kata utuh", () => {
    // "listrik" dimulai dengan "list" tetapi bukan kata instruksi "list"
    expect(buildSearchQuery("cari berita tentang listrik padam di Makassar")).toBe("berita tentang listrik padam di Makassar");
    // "singkatan" mengandung "singkat" tetapi bukan perintah
    expect(buildSearchQuery("cari arti singkatan UMKM")).toBe("arti singkatan UMKM");
  });
});

describe("keywordQuery: cadangan kata inti", () => {
  it("membuang kata sambung & membatasi 8 kata", () => {
    expect(keywordQuery("berita terbaru tentang harga emas hari ini")).toBe("berita terbaru harga emas hari ini");
    expect(keywordQuery("a b c d e f g h i j".replace(/\b[a-j]\b/g, (m) => "kata" + m)).split(" ")).toHaveLength(8);
  });

  it("kalimat hanya stopword -> kosong (pemanggil tak mengulang pencarian)", () => {
    expect(keywordQuery("yang dan di ke")).toBe("");
  });
});
