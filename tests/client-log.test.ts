import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ ok: true }));

vi.mock("next/headers", () => ({
  headers: async () => ({
    get: (k: string) =>
      k === "x-forwarded-for" ? "1.2.3.4" : k === "user-agent" ? "vitest-UA" : null,
  }),
}));
vi.mock("@/server/ratelimit", () => ({
  rateLimit: async () => ({ ok: state.ok, retryAfter: 7, remaining: 0 }),
}));
vi.mock("@/server/notify", () => ({ notifyTelegram: async () => {} }));

import { POST } from "@/app/api/client-log/route";

function makeReq(body: unknown) {
  return new Request("http://localhost/api/client-log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/client-log", () => {
  beforeEach(() => {
    state.ok = true;
  });

  it("mencatat error klien dan membalas 204", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(makeReq({ kind: "error", message: "boom terjadi", url: "/halaman" }));
    expect(res.status).toBe(204);
    expect(spy).toHaveBeenCalledOnce();
    const logged = String(spy.mock.calls[0][0]);
    expect(logged).toContain("boom terjadi");
    expect(logged).toContain("/halaman");
    spy.mockRestore();
  });

  it("pesan kosong -> 204 tanpa mencatat", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(makeReq({ message: "" }));
    expect(res.status).toBe(204);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("saat kena rate limit -> 204 tanpa mencatat", async () => {
    state.ok = false;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(makeReq({ message: "spam" }));
    expect(res.status).toBe(204);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("memangkas pesan sangat panjang", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await POST(makeReq({ message: "a".repeat(900) }));
    const logged = String(spy.mock.calls[0][0]);
    expect(logged).toContain("\u2026"); // ellipsis dari clip()
    spy.mockRestore();
  });
});
