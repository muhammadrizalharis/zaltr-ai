import { describe, it, expect, vi } from "vitest";

// Paksa jalur fallback in-memory (tanpa Redis) agar deterministik.
vi.mock("@/lib/redis", () => ({ getRedis: async () => null, redisEnabled: () => false }));

import { rateLimit } from "@/server/ratelimit";

describe("rateLimit (fallback in-memory)", () => {
  it("mengizinkan sampai batas lalu memblokir", async () => {
    const key = "t:" + Math.random();
    const r1 = await rateLimit(key, 3, 60_000);
    expect(r1.ok).toBe(true);
    expect(r1.remaining).toBe(2);
    await rateLimit(key, 3, 60_000);
    const r3 = await rateLimit(key, 3, 60_000);
    expect(r3.ok).toBe(true);
    expect(r3.remaining).toBe(0);
    const r4 = await rateLimit(key, 3, 60_000);
    expect(r4.ok).toBe(false);
    expect(r4.retryAfter).toBeGreaterThan(0);
  });

  it("kunci berbeda saling independen", async () => {
    const a = "a:" + Math.random();
    const b = "b:" + Math.random();
    await rateLimit(a, 1, 60_000);
    const blockedA = await rateLimit(a, 1, 60_000);
    const okB = await rateLimit(b, 1, 60_000);
    expect(blockedA.ok).toBe(false);
    expect(okB.ok).toBe(true);
  });

  it("me-reset setelah jendela berlalu", async () => {
    const key = "w:" + Math.random();
    await rateLimit(key, 1, 20);
    const blocked = await rateLimit(key, 1, 20);
    expect(blocked.ok).toBe(false);
    await new Promise((r) => setTimeout(r, 35));
    const after = await rateLimit(key, 1, 20);
    expect(after.ok).toBe(true);
  });
});
