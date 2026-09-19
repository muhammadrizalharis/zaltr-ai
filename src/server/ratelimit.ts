/**
 * Rate limiter sederhana (fixed-window, in-memory). Web calyzr berjalan sebagai
 * SATU instance, jadi cukup tanpa Redis. Mencegah penyalahgunaan gateway /v1 &
 * endpoint upload (habisnya kredit/kuota / spam). Kunci per user/API key.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

/**
 * Kembalikan { ok, retryAfter(detik), remaining }. Menaikkan hitungan bila ok.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfter: number; remaining: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || now >= b.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0, remaining: limit - 1 };
  }
  if (b.count >= limit) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((b.resetAt - now) / 1000)), remaining: 0 };
  }
  b.count += 1;
  return { ok: true, retryAfter: 0, remaining: limit - b.count };
}

// Bersihkan bucket kedaluwarsa berkala agar tak tumbuh tak terbatas.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
}, 60_000);
// Jangan menahan proses tetap hidup hanya karena timer ini.
(sweep as unknown as { unref?: () => void }).unref?.();
