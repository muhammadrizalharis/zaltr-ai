import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

type U = {
  id: string;
  email: string;
  name: string;
  role: "superadmin" | "admin" | "user";
  status: "pending" | "active" | "suspended";
  creditBalance: number;
  creditUsed: number;
  allowedModels: string[];
  plan: string;
  dailyMsgLimit: number | null;
  customInstructions: string | null;
  creditsExpireAt: Date | null;
};

const h = vi.hoisted(() => ({
  users: new Map<string, unknown>(),
  token: "" as string,
  update: vi.fn(),
  del: vi.fn(),
  sessionDeleteMany: vi.fn(),
  superCount: 2,
  sendEmail: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: async ({ where: { id } }: { where: { id: string } }) => h.users.get(id) ?? null,
      update: async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        h.update(args);
        return { ...(h.users.get(args.where.id) as object), ...args.data };
      },
      delete: async (args: unknown) => h.del(args),
      count: async () => h.superCount,
    },
    session: {
      // Sesi dicari lewat hash token; kembalikan user yang terikat pada token aktif.
      findUnique: async ({ where: { tokenHash } }: { where: { tokenHash: string } }) => {
        const entry = [...h.users.values()].find(
          (u) => createHash("sha256").update(`tok-${(u as U).id}`).digest("hex") === tokenHash,
        );
        if (!entry) return null;
        return { expiresAt: new Date(Date.now() + 3_600_000), user: entry };
      },
      deleteMany: async (args: unknown) => h.sessionDeleteMany(args),
    },
  },
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (h.token ? { value: h.token } : undefined) }),
  headers: async () => ({ get: () => null }),
}));
vi.mock("@/server/email", () => ({
  sendEmail: h.sendEmail,
  paymentReceiptEmail: () => ({ subject: "s", html: "h", text: "t" }),
}));
vi.mock("@/server/notify", () => ({ notifyTelegram: h.notify }));

import { PATCH, DELETE } from "@/app/api/admin/users/[id]/route";
import { PLAN_MODELS } from "@/server/plans";

function user(id: string, role: U["role"], over: Partial<U> = {}): U {
  return {
    id,
    email: `${id}@x.test`,
    name: id,
    role,
    status: "active",
    creditBalance: 100,
    creditUsed: 0,
    allowedModels: ["*"],
    plan: "plus",
    dailyMsgLimit: null,
    customInstructions: null,
    creditsExpireAt: new Date(Date.now() + 86_400_000 * 10),
    ...over,
  };
}

/** Login sebagai user tertentu (cookie sesi palsu yang di-hash seperti aslinya). */
function loginAs(id: string | null) {
  h.token = id ? `tok-${id}` : "";
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, body: unknown) =>
  PATCH(new Request("http://t/api/admin/users/" + id, { method: "PATCH", body: JSON.stringify(body) }), ctx(id));
const del = (id: string) => DELETE(new Request("http://t/api/admin/users/" + id, { method: "DELETE" }), ctx(id));

const S1 = "super1";
const S2 = "super2";
const A1 = "admin1";
const A2 = "admin2";
const U1 = "user1";
const P1 = "pending1";

beforeEach(() => {
  vi.clearAllMocks();
  h.superCount = 2;
  h.users = new Map<string, unknown>([
    [S1, user(S1, "superadmin")],
    [S2, user(S2, "superadmin")],
    [A1, user(A1, "admin")],
    [A2, user(A2, "admin")],
    [U1, user(U1, "user")],
    [P1, user(P1, "user", { status: "pending" })],
  ]);
  loginAs(null);
});

describe("RBAC admin: gerbang login & peran", () => {
  it("tanpa login -> 401, tak ada perubahan", async () => {
    const r = await patch(U1, { creditBalance: 5 });
    expect(r.status).toBe(401);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("user biasa -> 403 untuk PATCH dan DELETE", async () => {
    loginAs(U1);
    expect((await patch(A1, { creditBalance: 5 })).status).toBe(403);
    expect((await del(A1)).status).toBe(403);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.del).not.toHaveBeenCalled();
  });

  it("akun suspended/pending tak bisa dipakai login admin (sesi ditolak -> 401)", async () => {
    h.users.set("susp", user("susp", "admin", { status: "suspended" }));
    loginAs("susp");
    expect((await patch(U1, { creditBalance: 5 })).status).toBe(401);
  });
});

describe("RBAC admin: tak seorang pun boleh mengatur akun sendiri", () => {
  it.each([
    ["superadmin", S1],
    ["admin", A1],
  ])("%s -> PATCH diri sendiri = 403", async (_label, id) => {
    loginAs(id);
    for (const body of [{ role: "user" }, { creditBalance: 999 }, { status: "suspended" }, { plan: "power" }]) {
      const r = await patch(id, body);
      expect(r.status).toBe(403);
    }
    expect(h.update).not.toHaveBeenCalled();
  });

  it.each([S1, A1])("%s -> DELETE diri sendiri ditolak", async (id) => {
    loginAs(id);
    const r = await del(id);
    expect([400, 403]).toContain(r.status);
    expect(h.del).not.toHaveBeenCalled();
  });
});

describe("RBAC admin: admin biasa", () => {
  beforeEach(() => loginAs(A1));

  it("boleh mengatur user biasa (kredit, status, paket)", async () => {
    const r = await patch(U1, { creditBalance: 500, plan: "plus" });
    expect(r.status).toBe(200);
    expect(h.update).toHaveBeenCalledTimes(1);
  });

  it("TIDAK boleh mengatur admin lain maupun superadmin", async () => {
    expect((await patch(A2, { creditBalance: 1 })).status).toBe(403);
    expect((await patch(S1, { creditBalance: 1 })).status).toBe(403);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("TIDAK boleh mengubah role siapa pun (termasuk menaikkan user jadi admin)", async () => {
    for (const role of ["admin", "superadmin", "user"] as const) {
      expect((await patch(U1, { role })).status).toBe(403);
    }
    expect(h.update).not.toHaveBeenCalled();
  });

  it("TIDAK boleh mengaktifkan akun pending (khusus superadmin)", async () => {
    expect((await patch(P1, { status: "active" })).status).toBe(403);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("TIDAK boleh menghapus akun (khusus superadmin)", async () => {
    expect((await del(U1)).status).toBe(403);
    expect(h.del).not.toHaveBeenCalled();
  });
});

describe("RBAC admin: superadmin", () => {
  beforeEach(() => loginAs(S1));

  it("boleh mengatur user biasa dan admin biasa", async () => {
    expect((await patch(U1, { creditBalance: 10 })).status).toBe(200);
    expect((await patch(A1, { creditBalance: 10 })).status).toBe(200);
  });

  it("boleh mengubah role admin <-> user", async () => {
    expect((await patch(A1, { role: "user" })).status).toBe(200);
    expect((await patch(U1, { role: "admin" })).status).toBe(200);
    expect(h.update).toHaveBeenCalledTimes(2);
  });

  it("TIDAK boleh mengatur sesama superadmin (saling untouchable)", async () => {
    for (const body of [{ role: "user" }, { status: "suspended" }, { creditBalance: 0 }, { newPassword: "passwordbaru1" }]) {
      expect((await patch(S2, body)).status).toBe(403);
    }
    expect(h.update).not.toHaveBeenCalled();
  });

  it("boleh mengaktifkan akun pending", async () => {
    expect((await patch(P1, { status: "active" })).status).toBe(200);
  });

  it("DELETE: boleh hapus user & admin, tidak boleh superadmin", async () => {
    expect((await del(U1)).status).toBe(200);
    expect((await del(A1)).status).toBe(200);
    expect((await del(S2)).status).toBe(403);
    expect(h.del).toHaveBeenCalledTimes(2);
  });

  it("DELETE target tak ada -> 404, PATCH target tak ada -> 404", async () => {
    expect((await del("ghost")).status).toBe(404);
    expect((await patch("ghost", { creditBalance: 1 })).status).toBe(404);
  });
});

describe("RBAC admin: validasi payload & efek samping", () => {
  beforeEach(() => loginAs(S1));

  it.each([
    [{ role: "root" }],
    [{ creditBalance: -1 }],
    [{ creditBalance: 1.5 }],
    [{ plan: "gratisan" }],
    [{ newPassword: "pendek" }],
    [{ dailyMsgLimit: 0 }],
  ])("payload tidak valid %j -> 400 tanpa perubahan", async (body) => {
    expect((await patch(U1, body)).status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });

  it("suspend -> semua sesi target dihapus (paksa logout)", async () => {
    await patch(U1, { status: "suspended" });
    expect(h.sessionDeleteMany).toHaveBeenCalledWith({ where: { userId: U1 } });
  });

  it("non-suspend tidak menghapus sesi", async () => {
    await patch(U1, { creditBalance: 5 });
    expect(h.sessionDeleteMany).not.toHaveBeenCalled();
  });

  it("kata sandi di-hash, tidak pernah disimpan polos; amountPaid bukan kolom DB", async () => {
    await patch(U1, { newPassword: "rahasia-banget-1", amountPaid: 60_000 });
    const data = h.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.newPassword).toBeUndefined();
    expect(data.amountPaid).toBeUndefined();
    expect(typeof data.passwordHash).toBe("string");
    expect(data.passwordHash).not.toContain("rahasia-banget-1");
  });

  it("saldo NAIK -> masa aktif diperpanjang, reset pengingat, kirim struk + notif admin", async () => {
    await patch(U1, { creditBalance: 500 });
    const data = h.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.creditsExpireAt).toBeInstanceOf(Date);
    expect((data.creditsExpireAt as Date).getTime()).toBeGreaterThan(Date.now() + 20 * 86_400_000);
    expect(data.expiryRemindedAt).toBeNull();
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    expect(h.notify).toHaveBeenCalledTimes(1);
  });

  it("saldo TURUN/tetap -> masa aktif tidak disentuh, tanpa struk", async () => {
    await patch(U1, { creditBalance: 50 });
    await patch(U1, { creditBalance: 100 });
    for (const call of h.update.mock.calls) {
      expect(call[0].data.creditsExpireAt).toBeUndefined();
    }
    expect(h.sendEmail).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("ganti paket -> model & limit harian ikut paket (override direset)", async () => {
    await patch(U1, { plan: "power" });
    const data = h.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.allowedModels).toEqual(PLAN_MODELS.power);
    expect(data.dailyMsgLimit).toBeNull();
  });

  it("ganti paket + allowedModels/dailyMsgLimit kustom -> override admin dihormati", async () => {
    await patch(U1, { plan: "power", allowedModels: ["ollama:*"], dailyMsgLimit: 7 });
    const data = h.update.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.allowedModels).toEqual(["ollama:*"]);
    expect(data.dailyMsgLimit).toBe(7);
  });
});
