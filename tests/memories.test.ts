import { describe, it, expect } from "vitest";
import { looksLikeJunkMemory } from "@/server/memories";

describe("looksLikeJunkMemory", () => {
  it("menolak baris non-fakta (placeholder 'tidak ada info')", () => {
    for (const j of [
      "(Nama tidak diberikan)",
      "Pekerjaan/Studi: Tidak tersedia",
      "Tidak tersedia",
      "Lokasi: [Tidak disediakan]",
      "Nama pengguna: [Tidak disediakan]",
      "Tidak ada informasi yang diberikan tentang nama pengguna.",
      "Fakta Personal:",
      "Tidak ada informasi personal yang dapat diperoleh.",
      "N/A",
      "unknown",
    ]) {
      expect(looksLikeJunkMemory(j), j).toBe(true);
    }
  });

  it("menerima fakta/preferensi nyata", () => {
    for (const g of [
      "Nama pengguna: Faridah",
      "Sedang menulis jurnal tentang deep reinforcement learning",
      "Pengguna suka jawaban ringkas",
      "Studi: Teknik Informatika Unismuh",
      "Lebih suka contoh kode dengan komentar",
    ]) {
      expect(looksLikeJunkMemory(g), g).toBe(false);
    }
  });
});
