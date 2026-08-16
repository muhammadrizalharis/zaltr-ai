"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { ModelDescriptor } from "@/lib/types";

type Task = {
  id: string;
  title: string;
  prompt: string;
  model: string;
  intervalMinutes: number;
  active: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastResult: string | null;
};

const INTERVALS = [
  { v: 60, label: "Tiap jam" },
  { v: 360, label: "Tiap 6 jam" },
  { v: 720, label: "Tiap 12 jam" },
  { v: 1440, label: "Harian" },
  { v: 10080, label: "Mingguan" },
];

function intervalLabel(m: number): string {
  return INTERVALS.find((i) => i.v === m)?.label ?? `Tiap ${m} menit`;
}

/** Kelola tugas terjadwal (ala ChatGPT Tasks): prompt jalan otomatis berkala. */
export function TasksView() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [models, setModels] = useState<ModelDescriptor[]>([]);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [interval, setIntervalM] = useState(1440);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function load() {
    const [t, m] = await Promise.all([
      fetch("/api/tasks").then((r) => r.json()),
      fetch("/api/models", { cache: "no-store" }).then((r) => r.json()),
    ]);
    setTasks(t.tasks ?? []);
    const usable = (m.models ?? []).filter((x: ModelDescriptor) => x.available && !x.locked);
    setModels(usable);
    if (!model && usable[0]) setModel(usable[0].id);
  }
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    if (!title.trim() || !prompt.trim() || !model) {
      setNotice("Judul, prompt, dan model wajib diisi.");
      return;
    }
    setBusy(true);
    setNotice(null);
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), prompt: prompt.trim(), model, intervalMinutes: interval }),
    });
    setBusy(false);
    if (res.ok) {
      setTitle("");
      setPrompt("");
      setNotice("Tugas dibuat.");
      await load();
    } else {
      const d = await res.json().catch(() => ({}));
      setNotice(d.error ?? "Gagal membuat tugas.");
    }
  }

  async function toggle(t: Task) {
    const res = await fetch(`/api/tasks/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !t.active }),
    });
    if (res.ok) await load();
  }

  async function del(id: string) {
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    if (res.ok) setTasks((prev) => prev.filter((t) => t.id !== id));
  }

  async function runNow(id: string) {
    setNotice("Menjalankan…");
    const res = await fetch(`/api/tasks/${id}/run`, { method: "POST" });
    const d = await res.json().catch(() => ({}));
    if (res.ok && d.conversationId) {
      setNotice("Selesai — buka hasil di daftar chat.");
      await load();
    } else {
      setNotice(d.note ? `Tidak jalan: ${d.note}` : "Gagal menjalankan.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-lg font-semibold">Tugas Terjadwal</h1>
        <p className="text-sm text-muted">
          Jalankan prompt otomatis berkala; hasilnya muncul sebagai chat baru di daftarmu.
        </p>
      </div>

      <section className="space-y-3 rounded-2xl border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold">Tugas baru</h2>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Judul (mis. Ringkasan berita AI harian)"
          className="w-full rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-base outline-none focus:border-accent-b/60 md:text-sm"
        />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder="Prompt yang dijalankan tiap jadwal…"
          className="w-full resize-y rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-base outline-none focus:border-accent-b/60 md:text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="flex-1 rounded-xl border border-line bg-panel-solid px-3 py-2.5 text-base outline-none focus:border-accent-b/60 md:text-sm"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label ?? m.id}
              </option>
            ))}
          </select>
          <select
            value={interval}
            onChange={(e) => setIntervalM(Number(e.target.value))}
            className="rounded-xl border border-line bg-panel-solid px-3 py-2.5 text-base outline-none focus:border-accent-b/60 md:text-sm"
          >
            {INTERVALS.map((i) => (
              <option key={i.v} value={i.v}>
                {i.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void create()}
            disabled={busy}
            className="rounded-xl bg-gradient-to-r from-accent-a to-accent-b px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {busy ? "Membuat…" : "Buat tugas"}
          </button>
          {notice && <span className="text-xs text-muted">{notice}</span>}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Tugasku ({tasks.length})</h2>
        {tasks.length === 0 ? (
          <p className="rounded-xl border border-line bg-panel px-3 py-3 text-sm text-muted">
            Belum ada tugas.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {tasks.map((t) => (
              <li key={t.id} className="rounded-xl border border-line bg-panel px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {t.active ? "🟢" : "⚪"} {t.title}
                    </span>
                    <span className="block text-xs text-muted">
                      {intervalLabel(t.intervalMinutes)} · {t.model}
                      {t.lastRunAt ? ` · terakhir ${new Date(t.lastRunAt).toLocaleString("id-ID")}` : " · belum pernah"}
                    </span>
                    {t.lastResult && (
                      <span className="mt-0.5 block truncate text-xs text-muted">↳ {t.lastResult}</span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button onClick={() => void runNow(t.id)} className="text-xs text-muted hover:text-accent-a" title="Jalankan sekarang">
                      ▶ Jalankan
                    </button>
                    <button onClick={() => void toggle(t)} className="text-xs text-muted hover:text-ink">
                      {t.active ? "Jeda" : "Aktifkan"}
                    </button>
                    <button onClick={() => void del(t.id)} className="text-xs text-muted hover:text-red-400">
                      Hapus
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted">
          Penjadwal berjalan di server tiap menit; tugas dijalankan saat tiba waktunya walau kamu offline.{" "}
          <Link href="/chat" className="text-accent-a hover:underline">
            Lihat hasil di chat
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
