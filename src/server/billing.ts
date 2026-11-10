import type { ModelBillingInfo } from "./providers/copilot";
import type { ContextTier } from "./providers/contract";

/** Total token terpakai dalam satu jawaban (diakumulasi lintas langkah/agen). */
export interface UsageTotals {
  nanoAiu: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function emptyUsage(): UsageTotals {
  return { nanoAiu: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
}

export function addUsage(
  acc: UsageTotals,
  u: {
    nanoAiu?: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  },
): void {
  acc.nanoAiu += u.nanoAiu ?? 0;
  acc.inputTokens += u.inputTokens ?? 0;
  acc.outputTokens += u.outputTokens ?? 0;
  acc.cacheReadTokens += u.cacheReadTokens ?? 0;
  acc.cacheWriteTokens += u.cacheWriteTokens ?? 0;
}

/**
 * Berapa nano-AIU setara 1 kredit. GitHub menagih dalam nano-AIU (1 AIU = 1e9
 * nano-AIU); default kita 1 kredit = 1 AIU. Bisa di-tune lewat env tanpa rebuild
 * logika (mis. ZALTR_NANOAIU_PER_CREDIT=2000000000 => 1 kredit = 2 AIU, lebih murah).
 */
function nanoAiuPerCredit(): number {
  const raw = Number(process.env.ZALTR_NANOAIU_PER_CREDIT);
  return Number.isFinite(raw) && raw > 0 ? raw : 1_000_000_000;
}

/**
 * Hitung potongan kredit (AI Credits) untuk satu jawaban — usage-based billing
 * ala GitHub (sejak Juni 2026).
 *
 * SUMBER UTAMA: totalNanoAiu dari event usage Copilot (field copilotUsage).
 * Ini angka biaya RESMI GitHub yang sudah memecah token dengan benar (input
 * "fresh" vs cache_read vs cache_write vs output, masing-masing tarifnya sendiri,
 * plus reasoning tokens). Kredit = totalNanoAiu / nanoAiuPerCredit.
 *
 * Kenapa bukan hitung sendiri dari token: field `inputTokens` yang dilaporkan
 * adalah TOTAL prompt (= fresh input + cacheRead + cacheWrite). Menagih inputTokens
 * di tarif input PENUH lalu menambah lagi cacheRead/cacheWrite = hitung GANDA token
 * cache. Di mode agen (tiap langkah membaca ulang konteks besar sebagai cache) ini
 * menggelembung berlipat dan bisa menguras saldo dalam satu permintaan.
 *
 * FALLBACK (bila totalNanoAiu tak tersedia): hitung dari tarif katalog, tapi input
 * "fresh" = inputTokens - cacheRead - cacheWrite agar tak dobel. Terakhir: multiplier.
 */
export function creditsForUsage(
  info: ModelBillingInfo | undefined,
  tier: ContextTier | undefined,
  totals: UsageTotals,
): number {
  // Sumber otoritatif: biaya resmi GitHub (nano-AIU) -> kredit.
  if (totals.nanoAiu > 0) {
    return totals.nanoAiu / nanoAiuPerCredit();
  }

  const price =
    tier === "long_context" && info?.pricingLongContext ? info.pricingLongContext : info?.pricing;

  if (price) {
    const batch = price.batchSize && price.batchSize > 0 ? price.batchSize : 1_000_000;
    // Input "fresh" saja di tarif penuh; sisanya ditagih sebagai cache (hindari dobel).
    const freshInput = Math.max(
      0,
      totals.inputTokens - totals.cacheReadTokens - totals.cacheWriteTokens,
    );
    const cost =
      (freshInput / batch) * (price.input ?? 0) +
      (totals.outputTokens / batch) * (price.output ?? 0) +
      (totals.cacheReadTokens / batch) * (price.cacheRead ?? 0) +
      (totals.cacheWriteTokens / batch) * (price.cacheWrite ?? 0);
    if (cost > 0) return cost;
  }

  // Fallback terakhir: tak ada tarif token -> tagih flat multiplier (ala premium request).
  const used =
    totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  if (used <= 0) return 0;
  return Math.max(0, info?.multiplier ?? 1);
}
