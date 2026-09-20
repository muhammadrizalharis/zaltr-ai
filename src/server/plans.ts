/**
 * Definisi paket calyzr.ai — satu sumber kebenaran untuk limit harian
 * dan model bawaan tiap paket (dipakai route chat, admin, dan halaman upgrade).
 */

export type PlanId = "free" | "starter" | "plus" | "power";

export const PLAN_LABELS: Record<PlanId, string> = {
  free: "Free",
  starter: "Starter",
  plus: "Plus",
  power: "Power",
};

/** Harga paket (Rupiah) — dipakai halaman upgrade & struk email pembayaran. */
export const PLAN_PRICES: Record<PlanId, number> = {
  free: 0,
  starter: 15_000,
  plus: 60_000,
  power: 150_000,
};

/** Model yang SELALU terbuka: paket free + fallback saat kredit habis/hangus. */
export const FREE_MODELS: string[] = [
  "zaltr-core",
  "ollama:qwen2.5:7b-instruct",
  "ollama:gemma4:latest",
];

/** Masa aktif paket (hari) sejak pembayaran; lewat ini kredit hangus jadi 0. */
export const PLAN_PERIOD_DAYS = 30;

/** Kirim pengingat bila masa aktif tinggal <= sekian hari. */
export const EXPIRY_REMIND_DAYS = 3;

/** Model efektif: bila kredit <= 0 (habis/hangus) hanya FREE_MODELS; selain itu ikut paket. */
export function gatedModels(allowedModels: string[], effectiveCredit: number): string[] {
  return effectiveCredit > 0 ? allowedModels : [...FREE_MODELS];
}

/** True bila masa aktif paket sudah lewat. */
export function isExpired(creditsExpireAt: Date | null | undefined): boolean {
  return !!creditsExpireAt && creditsExpireAt.getTime() <= Date.now();
}

/** Batas pesan per hari; null = tanpa batas. */
export const PLAN_DAILY_LIMITS: Record<PlanId, number | null> = {
  free: 100,
  starter: 1_000,
  plus: 3_000,
  power: null,
};

/** Pola allowedModels bawaan saat admin menetapkan paket. */
export const PLAN_MODELS: Record<PlanId, string[]> = {
  free: FREE_MODELS,
  // Starter: model premium kelas CEPAT + semua model Turbo lokal.
  starter: [
    "zaltr-core",
    "ollama:*",
    "copilot:claude-haiku-4.5",
    "copilot:gpt-5-mini",
    "copilot:gemini-3.5-flash",
  ],
  // Plus: Starter + model kelas UTAMA + studio gambar.
  plus: [
    "zaltr-core",
    "ollama:*",
    "copilot:claude-haiku-4.5",
    "copilot:gpt-5-mini",
    "copilot:gemini-3.5-flash",
    "copilot:claude-sonnet-4.6",
    "copilot:gpt-5.4",
    "copilot:gemini-3.1-pro-preview",
    "comfyui:flux2-image",
  ],
  // Power: SEMUA model (flagship + studio video & musik).
  power: ["*"],
};

export function isPlan(v: string): v is PlanId {
  return v === "free" || v === "starter" || v === "plus" || v === "power";
}

/** Limit harian efektif: override admin (dailyMsgLimit) menang atas paket. */
export function effectiveDailyLimit(
  plan: string,
  dailyMsgLimit: number | null,
): number | null {
  if (dailyMsgLimit != null) return dailyMsgLimit;
  return PLAN_DAILY_LIMITS[isPlan(plan) ? plan : "free"];
}
