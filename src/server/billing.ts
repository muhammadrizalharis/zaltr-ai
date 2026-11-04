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
 * Hitung potongan kredit (AI Credits) untuk satu jawaban — usage-based billing
 * ala GitHub (sejak Juni 2026): token × tarif AI Credits per batch model.
 *
 *   biaya = Σ (token_jenis / batchSize) × harga_AIcredit_per_batch_jenis
 *
 * tarif diambil dari katalog Copilot (ModelBillingTokenPrices, satuannya memang
 * AI Credits per batch). Tier long-context memakai tarif pricingLongContext bila
 * ada. Bila model tak punya tarif token, fallback ke multiplier (flat per jawaban).
 * nanoAiu TIDAK dipakai langsung sebagai kredit (satuannya nano-AIU, bukan kredit).
 */
export function creditsForUsage(
  info: ModelBillingInfo | undefined,
  tier: ContextTier | undefined,
  totals: UsageTotals,
): number {
  const price =
    tier === "long_context" && info?.pricingLongContext ? info.pricingLongContext : info?.pricing;

  if (price) {
    const batch = price.batchSize && price.batchSize > 0 ? price.batchSize : 1_000_000;
    const cost =
      (totals.inputTokens / batch) * (price.input ?? 0) +
      (totals.outputTokens / batch) * (price.output ?? 0) +
      (totals.cacheReadTokens / batch) * (price.cacheRead ?? 0) +
      (totals.cacheWriteTokens / batch) * (price.cacheWrite ?? 0);
    if (cost > 0) return cost;
  }

  // Fallback: tak ada tarif token (atau biaya 0 padahal ada pemakaian) ->
  // tagih flat per jawaban sebesar multiplier model (default 1), ala premium request.
  const used =
    totals.inputTokens + totals.outputTokens + totals.cacheReadTokens + totals.cacheWriteTokens;
  if (used <= 0 && totals.nanoAiu <= 0) return 0;
  return Math.max(0, info?.multiplier ?? 1);
}
