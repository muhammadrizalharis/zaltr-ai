import { describe, it, expect } from "vitest";
import { escapeCurrencyDollars as esc } from "@/components/markdown-math";

describe("escapeCurrencyDollars: nominal uang bukan rumus", () => {
  it("kasus nyata yang rusak: dua nominal dolar dalam satu kalimat", () => {
    const s = "harga spot emas dunia tercatat di US$3.776,60 per troy ounce, turun US$84,56, menurut sumber.";
    expect(esc(s)).toBe("harga spot emas dunia tercatat di US\\$3.776,60 per troy ounce, turun US\\$84,56, menurut sumber.");
  });

  it.each([
    ["harga $5 dan $10", "harga \\$5 dan \\$10"],
    ["biaya $100 atau $200 per bulan", "biaya \\$100 atau \\$200 per bulan"],
    ["kisaran $10 - $20", "kisaran \\$10 - \\$20"],
    ["hanya ($350)", "hanya (\\$350)"],
    ["total $1,250.00.", "total \\$1,250.00."],
    ["Rp5 juta (≈$320) per orang", "Rp5 juta (≈\\$320) per orang"],
    ["$5", "\\$5"],
    ["bayar $ lalu pergi", "bayar \\$ lalu pergi"],
  ])("escape: %s", (input, expected) => {
    expect(esc(input)).toBe(expected);
  });

  it.each([
    "rumus $x^2$ dan $y$",
    "ekspresi $2x+1$ selesai",
    "energi $E=mc^2$.",
    "di mana $a_i$, $b_i$ dan $c_i$",
    "pecahan $\\frac{1}{2}$ saja",
    "angka $10^3$ itu seribu",
  ])("rumus asli tak diubah: %s", (input) => {
    expect(esc(input)).toBe(input);
  });

  it("campuran uang dan rumus dalam satu kalimat: uang di-escape, rumus utuh", () => {
    expect(esc("bayar $5 lalu hitung $x$ kembali")).toBe("bayar \\$5 lalu hitung $x$ kembali");
    expect(esc("untung $x$ dari modal $100")).toBe("untung $x$ dari modal \\$100");
  });

  it("display math $$..$$ tak disentuh (satu baris maupun blok banyak baris)", () => {
    expect(esc("$$E=mc^2$$")).toBe("$$E=mc^2$$");
    const block = "teks $5\n$$\na = $b$\n$$\nsetelah";
    // baris berisi $$ dilewati; baris "teks $5" di luar blok tetap diproses
    expect(esc(block)).toBe("teks \\$5\n$$\na = $b$\n$$\nsetelah");
  });

  it("kode inline dan blok kode tak diubah", () => {
    expect(esc("pakai `echo $HOME` untuk $5")).toBe("pakai `echo $HOME` untuk \\$5");
    expect(esc("```bash\necho $5 dan $10\n```\nharga $7")).toBe("```bash\necho $5 dan $10\n```\nharga \\$7");
    expect(esc("~~~\n$100\n~~~")).toBe("~~~\n$100\n~~~");
  });

  it("\\$ yang sudah di-escape tidak di-escape ganda", () => {
    expect(esc("harga \\$5 dan \\$10")).toBe("harga \\$5 dan \\$10");
  });

  it("notasi \\( x \\) berspasi tidak terpengaruh (guard dijalankan SEBELUM konversi)", () => {
    expect(esc("rumus \\( x + 1 \\) ya")).toBe("rumus \\( x + 1 \\) ya");
  });

  it("tanpa $ -> dikembalikan persis sama (jalur cepat)", () => {
    const s = "teks biasa\ntanpa dolar";
    expect(esc(s)).toBe(s);
  });

  it("idempoten: dijalankan dua kali hasilnya sama", () => {
    const s = "US$3.776,60 turun US$84,56 dan $x$";
    expect(esc(esc(s))).toBe(esc(s));
  });
});
