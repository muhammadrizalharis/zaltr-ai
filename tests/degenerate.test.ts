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

  it("aliran biner acak tanpa spasi (kasus nyata GPT-6 Astra baca .docx) -> true", () => {
    let s = 7;
    let bits = "";
    for (let i = 0; i < 800; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      bits += (s % 2) + ":";
    }
    const out = "flt is not supported: boost::too_many_args, actual sample = " + bits;
    expect(isDegenerate(out)).toBe(true);
  });

  it("desimal berulang tanpa spasi '0.00.0...' -> true", () => {
    expect(isDegenerate("Hasil: " + "0.0".repeat(600))).toBe(true);
  });

  it("string padat entropi tinggi (base64) tanpa spasi -> false", () => {
    const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const dense = Array.from({ length: 1600 }, (_, i) => B64[(i * 37 + ((i * i) % 61)) % 64]).join("");
    expect(isDegenerate(dense)).toBe(false);
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
