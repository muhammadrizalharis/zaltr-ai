import { describe, it, expect, vi } from "vitest";

// DNS dipalsukan: nama host "publik" -> IP publik, "tipu" -> IP privat (DNS rebinding), lainnya tak ada.
vi.mock("node:dns/promises", () => ({
  lookup: async (host: string) => {
    if (host === "contoh.com" || host === "www.contoh.com") return [{ address: "93.184.216.34", family: 4 }];
    if (host === "tipu.contoh.com") return [{ address: "10.0.0.5", family: 4 }];
    if (host === "campur.contoh.com") return [{ address: "93.184.216.34", family: 4 }, { address: "192.168.1.9", family: 4 }];
    throw new Error("ENOTFOUND");
  },
}));

import { assertPublicUrl } from "@/server/crawl";
import { wantsResearch } from "@/server/research";

describe("assertPublicUrl (filter SSRF untuk Crawl4AI)", () => {
  it.each([
    "https://contoh.com/halaman",
    "http://www.contoh.com/a?b=1#c",
    "https://contoh.com:443/x",
    "http://93.184.216.34/",
  ])("mengizinkan %s", async (u) => {
    await expect(assertPublicUrl(u)).resolves.toMatch(/^https?:\/\//);
  });

  it.each([
    ["http://localhost/", "localhost"],
    ["http://127.0.0.1/", "loopback"],
    ["http://127.1.2.3/", "loopback"],
    ["http://0.0.0.0/", "any"],
    ["http://10.33.33.11/md", "privat 10/8"],
    ["http://172.16.0.1/", "privat 172.16/12"],
    ["http://172.31.255.255/", "privat 172.16/12"],
    ["http://192.168.1.1/", "privat 192.168/16"],
    ["http://169.254.169.254/latest/meta-data", "metadata cloud"],
    ["http://100.64.0.1/", "CGNAT"],
    ["http://224.0.0.1/", "multicast"],
    ["http://2130706433/", "127.0.0.1 versi desimal"],
    ["http://0x7f000001/", "127.0.0.1 versi heksa"],
    ["http://[::1]/", "IPv6 loopback"],
    ["http://[::ffff:10.0.0.1]/", "IPv4-mapped (privat)"],
    ["http://[::ffff:7f00:1]/", "IPv4-mapped (loopback)"],
    ["http://[fd00::1]/", "IPv6 ULA"],
    ["http://[fe80::1]/", "IPv6 link-local"],
    ["http://[64:ff9b::a00:1]/", "NAT64"],
    ["http://zaltr-postgres/", "nama internal tanpa titik"],
    ["http://host.docker.internal/", ".internal"],
    ["http://printer.local/", ".local"],
    ["http://router.lan/", ".lan"],
    ["http://app.localhost/", ".localhost"],
    ["http://tipu.contoh.com/", "DNS -> IP privat"],
    ["http://campur.contoh.com/", "salah satu IP privat"],
    ["http://tidakada.contoh.com/", "host tak ditemukan"],
    ["ftp://contoh.com/", "protokol ftp"],
    ["file:///etc/passwd", "protokol file"],
    ["javascript:alert(1)", "protokol javascript"],
    ["http://user:pw@contoh.com/", "kredensial di URL"],
    ["https://contoh.com:8080/", "port non-standar"],
    ["http://contoh.com:5432/", "port database"],
    ["bukan url", "bukan URL"],
    ["", "kosong"],
  ])("menolak %s (%s)", async (u) => {
    await expect(assertPublicUrl(u)).rejects.toThrow();
  });

  it("membuang tanda baca di ujung URL hasil tempelan model", async () => {
    await expect(assertPublicUrl("https://contoh.com/halaman).")).resolves.toBe("https://contoh.com/halaman");
  });
});

describe("wantsResearch (deteksi niat riset tanpa toggle)", () => {
  it.each([
    "tolong research tentang dampak AI di pendidikan",
    "lakukan riset pasar kopi di Indonesia",
    "carikan referensi jurnal tentang machine learning",
    "cari jurnal terbaru soal stunting",
    "cariin paper tentang transformer",
    "bisa cari referensi untuk skripsi saya?",
    "Find papers about graph neural networks",
    "find me some references on LLM evaluation",
    "buat tinjauan pustaka tentang e-commerce",
    "systematic review metode pembelajaran daring",
    "cari di internet harga emas hari ini",
    "cari berita terbaru tentang banjir",
  ])("memicu: %s", (t) => {
    expect(wantsResearch(t)).toBe(true);
  });

  it.each([
    "halo, apa kabar?",
    "jelaskan apa itu rekursi",
    "buatkan fungsi python untuk sorting",
    "terjemahkan kalimat ini ke bahasa inggris",
    "apa sumber masalah di kode saya ini?",
    "ringkas dokumen yang saya upload",
    "kenapa langit biru?",
    "",
  ])("tidak memicu: %j", (t) => {
    expect(wantsResearch(t)).toBe(false);
  });

  it("naskah panjang yang hanya menyebut 'carikan referensi' di ujung tidak memicu (hanya 600 karakter pertama dicek)", () => {
    expect(wantsResearch("perbaiki paragraf berikut. " + "x ".repeat(400) + " carikan referensi")).toBe(false);
  });
});
