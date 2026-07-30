"use client";

import { useEffect, useState } from "react";

type MemoryItem = { id: string; content: string; createdAt: string };

/**
 * Pengaturan pribadi: custom instructions (disuntik ke semua chat)
 * + kelola memori antar-percakapan (lihat & hapus).
 */
export function SettingsView() {
  const [instructions, setInstructions] = useState("");
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [p, m] = await Promise.all([
        fetch("/api/profile").then((r) => r.json()),
        fetch("/api/memories").then((r) => r.json()),
      ]);
      setInstructions(p.profile?.customInstructions ?? "");
      setMemories(m.memories ?? []);
    })();
  }, []);

  async function save() {
    setSaving(true);
    setNotice(null);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customInstructions: instructions }),
    });
    setSaving(false);
    setNotice(res.ok ? "Tersimpan — berlaku untuk chat baru." : "Gagal menyimpan.");
  }

  async function removeMemory(id: string) {
    const res = await fetch(`/api/memories/${id}`, { method: "DELETE" });
    if (res.ok) setMemories((prev) => prev.filter((m) => m.id !== id));
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-lg font-semibold">Pengaturan</h1>
        <p className="text-sm text-muted">
          Berlaku untuk akunmu di semua percakapan.
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Instruksi pribadi</h2>
        <p className="text-xs text-muted">
          Ala ChatGPT Custom Instructions — misal: “Panggil saya Andi. Saya
          developer web. Jawab ringkas dan beri contoh kode Python bila relevan.”
        </p>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={6}
          maxLength={2000}
          placeholder="Tulis preferensimu di sini…"
          className="w-full resize-y rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-sm outline-none focus:border-accent-b/60"
        />
        <div className="flex items-center gap-3">
          <button
            onClick={() => void save()}
            disabled={saving}
            className="rounded-xl bg-gradient-to-r from-accent-a to-accent-b px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {saving ? "Menyimpan…" : "Simpan"}
          </button>
          {notice && <span className="text-xs text-muted">{notice}</span>}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Memori</h2>
        <p className="text-xs text-muted">
          Fakta yang diingat AI dari percakapanmu (diekstrak otomatis oleh model lokal,
          gratis). Hapus yang tidak kamu inginkan.
        </p>
        {memories.length === 0 ? (
          <p className="rounded-xl border border-line bg-panel px-3 py-3 text-sm text-muted">
            Belum ada memori. Mengobrollah dulu — fakta penting akan muncul di sini.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {memories.map((m) => (
              <li
                key={m.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-line bg-panel px-3 py-2 text-sm"
              >
                <span>{m.content}</span>
                <button
                  onClick={() => void removeMemory(m.id)}
                  className="shrink-0 text-xs text-muted hover:text-red-400"
                  title="Hapus memori ini"
                >
                  Hapus
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
