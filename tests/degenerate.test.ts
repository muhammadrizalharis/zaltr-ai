import { describe, it, expect } from "vitest";
import { isDegenerate, trimDegenerate } from "@/server/degenerate";

describe("isDegenerate", () => {
  it("daftar 'kata 0.0' berulang (kasus nyata GPT-6 Astra) -> true", () => {
    const words = ["jet_mass", "pricing", "matcher", "context", "correctness", "constraints", "safety", "style", "overall", "metric", "rubric", "scorer", "reward", "value", "score", "grade", "result", "outcome", "confidence", "certainty"];
    const text = "Saya coba ekstraksi dokumen.\n\n" + words.map((w) => `${w} 0.0`).join(" ").repeat(6);
    expect(isDegenerate(text)).toBe(true);
  });

  it("pola pendek berulang -> true", () => {
    expect(isDegenerate("halo ".repeat(400))).toBe(true);
    expect(isDegenerate("a".repeat(200) + "abc".repeat(500))).toBe(true);
  });

  it("teks normal panjang -> false", () => {
    const paras: string[] = [];
    for (let i = 0; i < 40; i++) {
      paras.push(`Paragraf ${i}: Machine learning adalah cabang kecerdasan buatan yang mempelajari pola dari data nomor ${i} dengan berbagai algoritma seperti regresi, pohon keputusan, dan jaringan saraf tiruan versi ${i * 7}.`);
    }
    expect(isDegenerate(paras.join("\n"))).toBe(false);
  });

  it("kode Python normal -> false", () => {
    const code = Array.from({ length: 60 }, (_, i) => `def fungsi_${i}(x, y=${i}):\n    hasil = x * ${i} + y\n    return hasil  # komentar ${i}`).join("\n");
    expect(isDegenerate(code)).toBe(false);
  });

  it("teks pendek -> false", () => {
    expect(isDegenerate("0.0 0.0 0.0")).toBe(false);
  });
});

describe("trimDegenerate", () => {
  it("menyisakan kepala + catatan", () => {
    const head = "Jawaban bermakna di awal. ".repeat(20);
    const t = trimDegenerate(head + "x 0.0 ".repeat(400));
    expect(t).toContain("Jawaban bermakna");
    expect(t).toContain("dihentikan");
  });
});
