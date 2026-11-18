import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ update: vi.fn(async () => ({})) }));
vi.mock("@/lib/db", () => ({ db: { user: { update: h.update } } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => ({ get: () => null }) }));

import { applyAccessPolicy, modelAllowed } from "@/server/auth";
import { FREE_MODELS } from "@/server/plans";

const DAY = 86_400_000;

function u(over: Partial<{ role: string; creditBalance: number; creditsExpireAt: Date | null; allowedModels: string[] }> = {}) {
  return {
    id: "u1",
    role: "user",
    creditBalance: 100,
    creditsExpireAt: new Date(Date.now() + DAY) as Date | null,
    allowedModels: ["*"],
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("applyAccessPolicy (kredit hangus & model gratis)", () => {
  it("kredit ada & belum kedaluwarsa -> tak diubah", () => {
    const r = applyAccessPolicy(u());
    expect(r.creditBalance).toBe(100);
    expect(r.allowedModels).toEqual(["*"]);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("masa aktif habis -> kredit hangus jadi 0, disimpan ke DB, hanya model gratis", () => {
    const r = applyAccessPolicy(u({ creditsExpireAt: new Date(Date.now() - 1000) }));
    expect(r.creditBalance).toBe(0);
    expect(r.allowedModels).toEqual(FREE_MODELS);
    expect(h.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { creditBalance: 0 } });
  });

  it("saldo 0 -> hanya model gratis (tanpa tulis DB)", () => {
    const r = applyAccessPolicy(u({ creditBalance: 0 }));
    expect(r.allowedModels).toEqual(FREE_MODELS);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("saldo negatif -> hanya model gratis", () => {
    expect(applyAccessPolicy(u({ creditBalance: -5 })).allowedModels).toEqual(FREE_MODELS);
  });

  it("kedaluwarsa tapi saldo sudah 0 -> tak menulis ulang DB", () => {
    applyAccessPolicy(u({ creditBalance: 0, creditsExpireAt: new Date(Date.now() - 1000) }));
    expect(h.update).not.toHaveBeenCalled();
  });

  it("tanpa tanggal kedaluwarsa -> kredit tak pernah hangus", () => {
    expect(applyAccessPolicy(u({ creditsExpireAt: null })).creditBalance).toBe(100);
  });

  it("superadmin kebal: tak dihanguskan, tak dikunci ke model gratis walau saldo 0/kedaluwarsa", () => {
    const r = applyAccessPolicy(u({ role: "superadmin", creditBalance: 0, creditsExpireAt: new Date(Date.now() - DAY) }));
    expect(r.allowedModels).toEqual(["*"]);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("daftar model gratis disalin (mengubah hasil tak merusak konstanta FREE_MODELS)", () => {
    const r = applyAccessPolicy(u({ creditBalance: 0 }));
    r.allowedModels.push("copilot:*");
    expect(FREE_MODELS).not.toContain("copilot:*");
  });
});

describe("modelAllowed (pola izin model)", () => {
  it("'*' mengizinkan semua", () => {
    expect(modelAllowed(["*"], "copilot:gpt-6-sol")).toBe(true);
  });

  it("'provider:*' hanya untuk provider itu", () => {
    expect(modelAllowed(["copilot:*"], "copilot:claude-haiku-4.5")).toBe(true);
    expect(modelAllowed(["copilot:*"], "ollama:gemma3:27b")).toBe(false);
    expect(modelAllowed(["ollama:*"], "copilot:x")).toBe(false);
  });

  it("id persis cocok; id lain dan awalan parsial tidak", () => {
    expect(modelAllowed(["zaltr-core"], "zaltr-core")).toBe(true);
    expect(modelAllowed(["zaltr-core"], "zaltr-core-2")).toBe(false);
    expect(modelAllowed(["copilot:gpt-6"], "copilot:gpt-6-sol")).toBe(false);
  });

  it("daftar kosong = tidak ada akses", () => {
    expect(modelAllowed([], "zaltr-core")).toBe(false);
  });

  it("paket free: hanya model gratis yang lolos, model berbayar ditolak", () => {
    expect(modelAllowed(FREE_MODELS, "zaltr-core")).toBe(true);
    expect(modelAllowed(FREE_MODELS, "copilot:claude-opus-5.5")).toBe(false);
  });
});
