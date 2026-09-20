/**
 * Notifikasi ke Telegram (best-effort). Dipakai untuk alert error klien/server.
 * No-op bila token tak diset. Ada throttle per-"key" agar tak membanjiri chat
 * saat error yang sama berulang.
 */

const TOKEN = process.env.ZALTR_TELEGRAM_BOT_TOKEN || "";
const CHAT = process.env.ZALTR_TELEGRAM_CHAT_ID || "";

const lastSent = new Map<string, number>();

export function telegramEnabled(): boolean {
  return Boolean(TOKEN && CHAT);
}

/**
 * Kirim `text` ke Telegram. `key` menandai jenis pesan untuk throttle; pesan
 * dengan key sama diabaikan bila masih dalam `cooldownMs` (default 5 menit).
 */
export async function notifyTelegram(
  text: string,
  opts?: { key?: string; cooldownMs?: number },
): Promise<void> {
  if (!telegramEnabled()) return;
  const key = opts?.key ?? text.slice(0, 80);
  const cooldown = opts?.cooldownMs ?? 300_000;
  const now = Date.now();
  const prev = lastSent.get(key);
  if (prev && now - prev < cooldown) return;
  lastSent.set(key, now);
  // Jaga map tetap kecil.
  if (lastSent.size > 500) {
    for (const [k, t] of lastSent) if (now - t > 3_600_000) lastSent.delete(k);
  }
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT,
        text: text.slice(0, 3500),
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // best-effort; jangan pernah melempar ke pemanggil
  }
}
