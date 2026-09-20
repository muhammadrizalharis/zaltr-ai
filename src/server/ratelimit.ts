/**
 * Rate limiter (fixed-window). Sumber kebenaran: Redis (tahan-restart & konsisten
 * lintas instance) via skrip Lua atomik. Bila Redis tak tersedia, otomatis jatuh
 * ke penghitung in-memory agar app tetap terlindungi. Kunci per user/API key/IP.
 */

import { getRedis } from "@/lib/redis";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// INCR + set PEXPIRE saat pertama, kembalikan [count, ttlMs] dalam satu round-trip.
const LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {n, redis.call('PTTL', KEYS[1])}
`;

function memoryLimit(
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

/**
 * Kembalikan { ok, retryAfter(detik), remaining }. Menaikkan hitungan bila ok.
 * Async karena bisa menghubungi Redis; call-site memanggil dengan `await`.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ ok: boolean; retryAfter: number; remaining: number }> {
  try {
    const redis = await getRedis();
    if (redis) {
      const rk = `rl:${key}`;
      const res = (await redis.eval(LUA, {
        keys: [rk],
        arguments: [String(windowMs)],
      })) as [number, number];
      const count = Number(res[0]);
      const ttlMs = Number(res[1]);
      if (count > limit) {
        return { ok: false, retryAfter: Math.max(1, Math.ceil(ttlMs / 1000)), remaining: 0 };
      }
      return { ok: true, retryAfter: 0, remaining: Math.max(0, limit - count) };
    }
  } catch {
    // Redis error -> pakai fallback in-memory di bawah.
  }
  return memoryLimit(key, limit, windowMs);
}

// Bersihkan bucket in-memory kedaluwarsa berkala agar tak tumbuh tak terbatas.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (now >= b.resetAt) buckets.delete(k);
}, 60_000);
// Jangan menahan proses tetap hidup hanya karena timer ini.
(sweep as unknown as { unref?: () => void }).unref?.();
