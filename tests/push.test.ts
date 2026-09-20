import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("web-push", () => ({
  default: { setVapidDetails: () => {}, sendNotification: async () => ({}) },
}));

describe("push (VAPID)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("nonaktif tanpa kunci VAPID", async () => {
    delete process.env.ZALTR_VAPID_PUBLIC_KEY;
    delete process.env.ZALTR_VAPID_PRIVATE_KEY;
    const m = await import("@/server/push");
    expect(m.pushEnabled()).toBe(false);
    expect(m.vapidPublicKey()).toBe("");
  });

  it("aktif bila kunci VAPID diset", async () => {
    process.env.ZALTR_VAPID_PUBLIC_KEY = "PUBKEY123";
    process.env.ZALTR_VAPID_PRIVATE_KEY = "PRIVKEY123";
    const m = await import("@/server/push");
    expect(m.pushEnabled()).toBe(true);
    expect(m.vapidPublicKey()).toBe("PUBKEY123");
  });
});
