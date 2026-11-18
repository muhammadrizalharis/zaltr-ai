import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { addUsage, creditsForUsage, emptyUsage } from "@/server/billing";

const NANO = 1_000_000_000;

/** Tarif katalog contoh: kredit per 1 juta token. */
const PRICING = { input: 10, output: 50, cacheRead: 1, cacheWrite: 12, batchSize: 1_000_000 };

function totals(p: Partial<ReturnType<typeof emptyUsage>>) {
  return { ...emptyUsage(), ...p };
}

describe("billing: creditsForUsage", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.ZALTR_NANOAIU_PER_CREDIT;
    delete process.env.ZALTR_NANOAIU_PER_CREDIT;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.ZALTR_NANOAIU_PER_CREDIT;
    else process.env.ZALTR_NANOAIU_PER_CREDIT = saved;
  });

  it("nano-AIU resmi GitHub dibagi 1e9 (kasus nyata: 4,22 kredit untuk satu jawaban pendek)", () => {
    expect(creditsForUsage(undefined, undefined, totals({ nanoAiu: 4_220_000_000 }))).toBeCloseTo(4.22, 6);
  });

  it("nano-AIU mengalahkan tarif katalog & multiplier (sumber otoritatif)", () => {
    const c = creditsForUsage(
      { multiplier: 99, pricing: PRICING },
      undefined,
      totals({ nanoAiu: 2 * NANO, inputTokens: 5_000_000, outputTokens: 5_000_000 }),
    );
    expect(c).toBe(2);
  });

  it("ZALTR_NANOAIU_PER_CREDIT mengubah kurs (2e9 => separuh)", () => {
    process.env.ZALTR_NANOAIU_PER_CREDIT = String(2 * NANO);
    expect(creditsForUsage(undefined, undefined, totals({ nanoAiu: 4 * NANO }))).toBe(2);
  });

  it.each(["0", "-5", "abc", ""])("kurs env tak valid (%j) jatuh ke default 1e9", (v) => {
    process.env.ZALTR_NANOAIU_PER_CREDIT = v;
    expect(creditsForUsage(undefined, undefined, totals({ nanoAiu: 3 * NANO }))).toBe(3);
  });

  it("fallback tarif: input 'fresh' = total - cacheRead - cacheWrite (token cache TIDAK dihitung ganda)", () => {
    // inputTokens 1.000.000 sudah termasuk 600.000 cacheRead dan 100.000 cacheWrite.
    const c = creditsForUsage(
      { pricing: PRICING },
      undefined,
      totals({ inputTokens: 1_000_000, cacheReadTokens: 600_000, cacheWriteTokens: 100_000 }),
    );
    // fresh 300.000*10/1e6 + cacheRead 0,6*1 + cacheWrite 0,1*12 = 3 + 0,6 + 1,2
    expect(c).toBeCloseTo(4.8, 6);
    // Bila salah (input penuh + cache lagi) hasilnya 10 + 0,6 + 1,2 = 11,8.
    expect(c).toBeLessThan(11.8);
  });

  it("fallback tarif: komponen output ikut dihitung", () => {
    const c = creditsForUsage(
      { pricing: PRICING },
      undefined,
      totals({ inputTokens: 100_000, outputTokens: 20_000 }),
    );
    expect(c).toBeCloseTo(1 + 1, 6); // 0,1*10 + 0,02*50
  });

  it("fresh input tak pernah negatif bila cache > total yang dilaporkan", () => {
    const c = creditsForUsage(
      { pricing: PRICING },
      undefined,
      totals({ inputTokens: 100, cacheReadTokens: 1_000_000 }),
    );
    expect(c).toBeCloseTo(1, 6); // hanya cacheRead 1.000.000 * 1/1e6
  });

  it("batchSize kustom & batchSize tak valid (0) jatuh ke 1 juta", () => {
    const base = totals({ outputTokens: 1_000 });
    expect(creditsForUsage({ pricing: { ...PRICING, batchSize: 1_000 } }, undefined, base)).toBeCloseTo(50, 6);
    expect(creditsForUsage({ pricing: { ...PRICING, batchSize: 0 } }, undefined, base)).toBeCloseTo(0.05, 6);
  });

  it("long_context memakai pricingLongContext bila ada, selain itu tarif biasa", () => {
    const longP = { ...PRICING, output: 100 };
    const t = totals({ outputTokens: 1_000_000 });
    const info = { pricing: PRICING, pricingLongContext: longP };
    expect(creditsForUsage(info, "long_context", t)).toBeCloseTo(100, 6);
    expect(creditsForUsage(info, "default", t)).toBeCloseTo(50, 6);
    expect(creditsForUsage({ pricing: PRICING }, "long_context", t)).toBeCloseTo(50, 6);
  });

  it("tanpa tarif token: tagih flat multiplier (default 1) selama ada token terpakai", () => {
    const t = totals({ inputTokens: 10, outputTokens: 5 });
    expect(creditsForUsage({ multiplier: 3 }, undefined, t)).toBe(3);
    expect(creditsForUsage(undefined, undefined, t)).toBe(1);
    expect(creditsForUsage({}, undefined, t)).toBe(1);
  });

  it("multiplier negatif tak bisa menghasilkan kredit negatif (menambah saldo)", () => {
    expect(creditsForUsage({ multiplier: -5 }, undefined, totals({ inputTokens: 10 }))).toBe(0);
  });

  it("tanpa token sama sekali = gratis, apa pun multiplier-nya", () => {
    expect(creditsForUsage({ multiplier: 7 }, undefined, totals({}))).toBe(0);
    expect(creditsForUsage(undefined, undefined, totals({}))).toBe(0);
  });

  it("tarif bernilai 0 (model gratis) jatuh ke multiplier, bukan NaN", () => {
    const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    const c = creditsForUsage({ pricing: zero, multiplier: 2 }, undefined, totals({ inputTokens: 10 }));
    expect(c).toBe(2);
    expect(Number.isNaN(c)).toBe(false);
  });
});

describe("billing: addUsage / emptyUsage", () => {
  it("emptyUsage mengembalikan objek baru bernilai 0 tiap panggilan", () => {
    const a = emptyUsage();
    const b = emptyUsage();
    expect(a).toEqual({ nanoAiu: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(a).not.toBe(b);
  });

  it("mengakumulasi lintas langkah agen dan mengabaikan field yang kosong", () => {
    const acc = emptyUsage();
    addUsage(acc, { nanoAiu: 1_000, inputTokens: 10, outputTokens: 2, cacheReadTokens: 5 });
    addUsage(acc, { nanoAiu: 500, outputTokens: 3, cacheWriteTokens: 7 });
    addUsage(acc, {});
    expect(acc).toEqual({
      nanoAiu: 1_500,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 5,
      cacheWriteTokens: 7,
    });
  });
});
