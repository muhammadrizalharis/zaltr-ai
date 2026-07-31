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

/** Batas pesan per hari; null = tanpa batas. */
export const PLAN_DAILY_LIMITS: Record<PlanId, number | null> = {
  free: 100,
  starter: 1_000,
  plus: 3_000,
  power: null,
};

/** Pola allowedModels bawaan saat admin menetapkan paket. */
export const PLAN_MODELS: Record<PlanId, string[]> = {
  free: ["zaltr-core"],
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
