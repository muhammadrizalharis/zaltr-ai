"use client";

import { useCallback, useEffect, useState } from "react";
import type { ModelDescriptor } from "@/lib/types";

interface AdminUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  creditBalance: number;
  creditUsed: number;
  allowedModels: string[];
  dailyMsgLimit: number | null;
  notes: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  conversationCount: number;
}

const PROVIDER_WILDCARDS: Array<[string, string]> = [
  ["*", "Semua model"],
  ["copilot:*", "Semua Copilot"],
  ["ollama:*", "Semua Ollama"],
  ["comfyui:*", "Semua ComfyUI"],
];

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const [me, setMe] = useState<{ id: string; role: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [uRes, mRes, meRes] = await Promise.all([
      fetch("/api/admin/users", { cache: "no-store" }),
      fetch("/api/models", { cache: "no-store" }),
      fetch("/api/auth/me", { cache: "no-store" }),
    ]);
    if (uRes.ok) setUsers(((await uRes.json()) as { users: AdminUser[] }).users);
    if (mRes.ok) setModels(((await mRes.json()) as { models: ModelDescriptor[] }).models);
    if (meRes.ok) {
      const data = (await meRes.json()) as { user: { id: string; role: string } };
      setMe(data.user);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { error?: string };
    setNotice(res.ok ? "Tersimpan ✓" : `Gagal: ${data.error}`);
    setTimeout(() => setNotice(null), 2500);
    void load();
  }

  async function removeUser(u: AdminUser) {
    if (!confirm(`HAPUS AKUN ${u.email}?\n\nSemua chat & project miliknya ikut terhapus permanen.`)) return;
    if (!confirm("Konfirmasi sekali lagi: hapus permanen akun ini?")) return;
    const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
    const data = (await res.json()) as { error?: string };
    setNotice(res.ok ? "Akun dihapus" : `Gagal: ${data.error}`);
    setTimeout(() => setNotice(null), 2500);
    void load();
  }

  const pendingCount = users.filter((u) => u.status === "pending").length;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Pengguna</h1>
          <p className="mt-1 text-sm text-muted">
            {users.length} akun{pendingCount > 0 && ` · ${pendingCount} menunggu persetujuan`}
          </p>
        </div>
        {notice && (
          <span className="rounded-lg border border-accent-a/40 bg-accent-a/10 px-3 py-1.5 text-sm text-accent-a">
            {notice}
          </span>
        )}
      </div>

      <div className="space-y-3">
        {users.map((u) => (
          <UserCard
            key={u.id}
            u={u}
            me={me}
            models={models}
            open={openId === u.id}
            onToggle={() => setOpenId(openId === u.id ? null : u.id)}
            onPatch={patch}
            onDelete={removeUser}
          />
        ))}
      </div>
    </div>
  );
}

function UserCard({
  u,
  me,
  models,
  open,
  onToggle,
  onPatch,
  onDelete,
}: {
  u: AdminUser;
  me: { id: string; role: string } | null;
  models: ModelDescriptor[];
  open: boolean;
  onToggle: () => void;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
  onDelete: (u: AdminUser) => void;
}) {
  const [credit, setCredit] = useState(String(u.creditBalance));
  const [limit, setLimit] = useState(u.dailyMsgLimit == null ? "" : String(u.dailyMsgLimit));
  const [notes, setNotes] = useState(u.notes ?? "");
  const [allowed, setAllowed] = useState<string[]>(u.allowedModels);

  useEffect(() => {
    setCredit(String(u.creditBalance));
    setLimit(u.dailyMsgLimit == null ? "" : String(u.dailyMsgLimit));
    setNotes(u.notes ?? "");
    setAllowed(u.allowedModels);
  }, [u]);

  const isSuper = me?.role === "superadmin";
  const canManage =
    isSuper || (me?.role === "admin" && (u.role === "user" || u.id === me.id));
  // Admin tidak boleh mengubah kredit dirinya sendiri (server juga menolak).
  const canEditCredit = canManage && (isSuper || u.id !== me?.id);

  function togglePattern(p: string) {
    setAllowed((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  const statusColor =
    u.status === "active"
      ? "text-accent-a border-accent-a/40 bg-accent-a/10"
      : u.status === "pending"
        ? "text-yellow-300 border-yellow-500/40 bg-yellow-500/10"
        : "text-red-300 border-red-500/40 bg-red-500/10";

  return (
    <div className="rounded-2xl border border-line bg-panel">
      <button onClick={onToggle} className="flex w-full items-center gap-4 px-5 py-4 text-left">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {u.name} <span className="text-sm text-muted">· {u.email}</span>
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {u.conversationCount} chat · terpakai {u.creditUsed.toLocaleString("id-ID")} kredit ·
            login terakhir{" "}
            {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("id-ID") : "belum pernah"}
          </p>
        </div>
        <span className="rounded-full border border-accent-b/40 bg-accent-b/10 px-2.5 py-1 text-[11px] uppercase tracking-wider text-accent-b">
          {u.role}
        </span>
        <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-wider ${statusColor}`}>
          {u.status}
        </span>
        <span className="text-sm tabular-nums text-muted">
          {u.creditBalance.toLocaleString("id-ID")} kr
        </span>
        <span className="text-muted">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="border-t border-line px-5 py-5">
          {!canManage && (
            <p className="mb-4 rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-300">
              Hanya superadmin yang bisa mengatur akun admin/superadmin lain.
            </p>
          )}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* --- Kolom kiri: akses & status --- */}
            <div className="space-y-5">
              {u.status === "pending" && isSuper && (
                <button
                  onClick={() => void onPatch(u.id, { status: "active" })}
                  className="w-full rounded-xl bg-accent-a py-2.5 font-semibold text-bg hover:opacity-90"
                >
                  ✓ Aktifkan akun ini
                </button>
              )}
              {u.status === "pending" && !isSuper && (
                <p className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-300">
                  Menunggu aktivasi — hanya superadmin yang bisa mengaktifkan akun baru.
                </p>
              )}

              <Section title="Role & status">
                <div className="flex flex-wrap gap-2">
                  <select
                    disabled={!isSuper}
                    value={u.role}
                    onChange={(e) => void onPatch(u.id, { role: e.target.value })}
                    className="input w-auto disabled:opacity-40"
                  >
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                    <option value="superadmin">superadmin</option>
                  </select>
                  <select
                    disabled={!canManage}
                    value={u.status}
                    onChange={(e) => void onPatch(u.id, { status: e.target.value })}
                    className="input w-auto disabled:opacity-40"
                  >
                    <option value="pending">pending</option>
                    <option value="active">active</option>
                    <option value="suspended">suspended</option>
                  </select>
                </div>
                {!isSuper && (
                  <p className="mt-1 text-[11px] text-muted">Role hanya bisa diubah superadmin.</p>
                )}
              </Section>

              <Section title="Kredit AI">
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={0}
                    value={credit}
                    disabled={!canEditCredit}
                    onChange={(e) => setCredit(e.target.value)}
                    className="input w-40 tabular-nums"
                  />
                  <button
                    disabled={!canEditCredit}
                    onClick={() => void onPatch(u.id, { creditBalance: Number(credit) })}
                    className="rounded-xl border border-accent-a/50 px-4 text-sm text-accent-a hover:bg-accent-a/10 disabled:opacity-40"
                  >
                    Simpan
                  </button>
                  {[100, 1000, 10000].map((n) => (
                    <button
                      key={n}
                      disabled={!canEditCredit}
                      onClick={() => setCredit(String(Number(credit || 0) + n))}
                      className="rounded-xl border border-line px-3 text-xs text-muted hover:text-ink disabled:opacity-40"
                    >
                      +{n.toLocaleString("id-ID")}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-muted">
                  1 kredit = 1 pesan Copilot. Model lokal (Ollama/ComfyUI/demo) gratis.
                  {!isSuper && u.id === me?.id && " Kredit sendiri hanya bisa diubah superadmin."}
                </p>
              </Section>

              <Section title="Batas pesan per hari">
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    placeholder="tanpa batas"
                    value={limit}
                    disabled={!canManage}
                    onChange={(e) => setLimit(e.target.value)}
                    className="input w-40 tabular-nums"
                  />
                  <button
                    disabled={!canManage}
                    onClick={() =>
                      void onPatch(u.id, { dailyMsgLimit: limit === "" ? null : Number(limit) })
                    }
                    className="rounded-xl border border-accent-a/50 px-4 text-sm text-accent-a hover:bg-accent-a/10 disabled:opacity-40"
                  >
                    Simpan
                  </button>
                </div>
              </Section>

              <Section title="Reset password">
                <button
                  disabled={!canManage}
                  onClick={() => {
                    const pw = prompt("Password baru (min 8 karakter):");
                    if (pw && pw.length >= 8) void onPatch(u.id, { newPassword: pw });
                    else if (pw) alert("Minimal 8 karakter");
                  }}
                  className="rounded-xl border border-line px-4 py-2 text-sm hover:border-accent-b/60 disabled:opacity-40"
                >
                  Set password baru…
                </button>
              </Section>
            </div>

            {/* --- Kolom kanan: model AI & catatan --- */}
            <div className="space-y-5">
              <Section title="Model AI yang boleh dipakai">
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {PROVIDER_WILDCARDS.map(([p, label]) => (
                    <Chip
                      key={p}
                      active={allowed.includes(p)}
                      disabled={!canManage}
                      onClick={() => togglePattern(p)}
                    >
                      {label}
                    </Chip>
                  ))}
                </div>
                <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-line bg-bg p-2">
                  {models
                    .filter((m) => !m.id.endsWith(":offline") && !m.id.endsWith(":kosong"))
                    .map((m) => (
                      <label
                        key={m.id}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm hover:bg-panel-2"
                      >
                        <input
                          type="checkbox"
                          disabled={!canManage}
                          checked={allowed.includes(m.id)}
                          onChange={() => togglePattern(m.id)}
                        />
                        <span className="truncate">{m.label}</span>
                        <span className="ml-auto text-[10px] uppercase text-muted">
                          {m.provider}
                        </span>
                      </label>
                    ))}
                </div>
                <button
                  disabled={!canManage}
                  onClick={() => void onPatch(u.id, { allowedModels: allowed })}
                  className="mt-2 rounded-xl border border-accent-a/50 px-4 py-1.5 text-sm text-accent-a hover:bg-accent-a/10 disabled:opacity-40"
                >
                  Simpan daftar model
                </button>
                <p className="mt-1 text-[11px] text-muted">
                  Wildcard provider mencakup model baru yang muncul kemudian.
                </p>
              </Section>

              <Section title="Catatan admin">
                <textarea
                  value={notes}
                  disabled={!canManage}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Catatan internal tentang akun ini…"
                  className="input resize-y"
                />
                <button
                  disabled={!canManage}
                  onClick={() => void onPatch(u.id, { notes: notes || null })}
                  className="mt-2 rounded-xl border border-accent-a/50 px-4 py-1.5 text-sm text-accent-a hover:bg-accent-a/10 disabled:opacity-40"
                >
                  Simpan catatan
                </button>
              </Section>

              {isSuper && u.id !== me?.id && (
                <Section title="Zona berbahaya">
                  <button
                    onClick={() => onDelete(u)}
                    className="rounded-xl border border-red-500/40 px-4 py-2 text-sm text-red-300 hover:bg-red-500/10"
                  >
                    Hapus akun permanen…
                  </button>
                </Section>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">
        {title}
      </h3>
      {children}
    </div>
  );
}

function Chip({
  children,
  active,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-3 py-1 text-xs disabled:opacity-40 ${
        active
          ? "border-accent-a/60 bg-accent-a/15 text-accent-a"
          : "border-line text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
