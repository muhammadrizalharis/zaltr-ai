"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ModelDescriptor } from "@/lib/types";

type Assistant = {
  id: string;
  name: string;
  description: string | null;
  instructions: string | null;
  model: string | null;
  _count?: { conversations: number };
};
type Form = { id?: string; name: string; description: string; instructions: string; model: string };

const EMPTY: Form = { name: "", description: "", instructions: "", model: "" };

/** Kelola custom assistant (ala ChatGPT GPTs): instruksi + model preset. */
export function AssistantsView() {
  const router = useRouter();
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const [a, m] = await Promise.all([
      fetch("/api/assistants").then((r) => r.json()),
      fetch("/api/models", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setAssistants(a.assistants ?? []);
    setModels((m.models ?? []).filter((x: ModelDescriptor) => x.available && !x.locked));
  }
  useEffect(() => {
    void load();
  }, []);

  async function save() {
    if (!form.name.trim()) {
      setNotice("Nama wajib diisi.");
      return;
    }
    setBusy(true);
    setNotice(null);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      instructions: form.instructions.trim() || null,
      model: form.model || null,
    };
    const res = form.id
      ? await fetch(`/api/assistants/${form.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch("/api/assistants", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
    setBusy(false);
    if (res.ok) {
      setForm(EMPTY);
      setNotice("Tersimpan.");
      await load();
    } else {
      setNotice("Gagal menyimpan.");
    }
  }

  async function del(id: string) {
    const res = await fetch(`/api/assistants/${id}`, { method: "DELETE" });
    if (res.ok) {
      setAssistants((prev) => prev.filter((a) => a.id !== id));
      if (form.id === id) setForm(EMPTY);
    }
  }

  async function startChat(a: Assistant) {
    if (a.model) localStorage.setItem("zaltr:model", a.model);
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assistantId: a.id, title: a.name }),
    });
    const data = await res.json();
    if (data.conversation?.id) router.push(`/chat/${data.conversation.id}`);
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-lg font-semibold">Asisten</h1>
        <p className="text-sm text-muted">
          Buat asisten khusus dengan instruksi & model preset sendiri (ala ChatGPT GPTs).
        </p>
      </div>

      <section className="space-y-3 rounded-2xl border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold">{form.id ? "Ubah asisten" : "Asisten baru"}</h2>
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          placeholder="Nama (mis. Reviewer Jurnal)"
          className="w-full rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-base outline-none focus:border-accent-b/60 md:text-sm"
        />
        <input
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Deskripsi singkat (opsional)"
          className="w-full rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-base outline-none focus:border-accent-b/60 md:text-sm"
        />
        <textarea
          value={form.instructions}
          onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))}
          rows={5}
          placeholder="Instruksi/persona — mis. “Kamu reviewer jurnal. Tinjau metodologi dengan kritis, jawab bahasa Indonesia akademik.”"
          className="w-full resize-y rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-base outline-none focus:border-accent-b/60 md:text-sm"
        />
        <select
          value={form.model}
          onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
          className="w-full rounded-xl border border-line bg-panel-solid px-3 py-2.5 text-base outline-none focus:border-accent-b/60 md:text-sm"
        >
          <option value="">Model default (pilihan terakhirku)</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label ?? m.id}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void save()}
            disabled={busy}
            className="rounded-xl bg-gradient-to-r from-accent-a to-accent-b px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {busy ? "Menyimpan…" : form.id ? "Simpan perubahan" : "Buat asisten"}
          </button>
          {form.id && (
            <button
              onClick={() => setForm(EMPTY)}
              className="rounded-xl border border-line px-3 py-2 text-sm text-muted hover:text-ink"
            >
              Batal
            </button>
          )}
          {notice && <span className="text-xs text-muted">{notice}</span>}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Asistenku ({assistants.length})</h2>
        {assistants.length === 0 ? (
          <p className="rounded-xl border border-line bg-panel px-3 py-3 text-sm text-muted">
            Belum ada asisten. Buat satu di atas.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {assistants.map((a) => (
              <li key={a.id} className="rounded-xl border border-line bg-panel px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="block truncate text-sm font-medium">{a.name}</span>
                    {a.description && (
                      <span className="block truncate text-xs text-muted">{a.description}</span>
                    )}
                    <span className="text-xs text-muted">
                      {a.model ?? "model default"} · {a._count?.conversations ?? 0} chat
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => void startChat(a)}
                      className="rounded-lg bg-gradient-to-r from-accent-a to-accent-b px-2.5 py-1 text-xs font-semibold text-black"
                    >
                      Mulai chat
                    </button>
                    <button
                      onClick={() =>
                        setForm({
                          id: a.id,
                          name: a.name,
                          description: a.description ?? "",
                          instructions: a.instructions ?? "",
                          model: a.model ?? "",
                        })
                      }
                      className="text-xs text-muted hover:text-ink"
                    >
                      Ubah
                    </button>
                    <button
                      onClick={() => void del(a.id)}
                      className="text-xs text-muted hover:text-red-400"
                    >
                      Hapus
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
