"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { notifyConversationsChanged } from "@/components/sidebar";

interface TrashedConversation {
  id: string;
  title: string;
  trashedAt: string;
}

export default function TrashPage() {
  const [items, setItems] = useState<TrashedConversation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch("/api/trash", { cache: "no-store" });
    if (res.ok) {
      setItems(((await res.json()) as { conversations: TrashedConversation[] }).conversations);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function restore(c: TrashedConversation) {
    await fetch(`/api/conversations/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trashed: false }),
    });
    notifyConversationsChanged();
    void load();
  }

  async function destroy(c: TrashedConversation) {
    if (
      !confirm(
        `HAPUS PERMANEN "${c.title}"?\n\nSemua pesan di dalamnya akan dimusnahkan dan TIDAK BISA dikembalikan.`,
      )
    )
      return;
    if (!confirm("Konfirmasi sekali lagi: hapus permanen?")) return;
    await fetch(`/api/conversations/${c.id}?permanent=1`, { method: "DELETE" });
    void load();
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Trash</h1>
        <Link href="/chat" className="text-sm text-accent-a hover:underline">
          ← Kembali ke chat
        </Link>
      </div>

      <p className="mb-6 text-sm text-muted">
        Chat di sini tersimpan selamanya sampai kamu memulihkan atau menghapusnya permanen.
        Hapus permanen adalah satu-satunya cara memusnahkan data (kontrak persistensi calyzr.ai).
      </p>

      {loading && <p className="text-sm text-muted">Memuat…</p>}
      {!loading && items.length === 0 && (
        <p className="rounded-xl border border-line bg-panel px-4 py-6 text-center text-sm text-muted">
          Trash kosong.
        </p>
      )}

      <ul className="space-y-2">
        {items.map((c) => (
          <li
            key={c.id}
            className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{c.title}</p>
              <p className="text-[11px] text-muted">
                Dihapus {new Date(c.trashedAt).toLocaleString("id-ID")}
              </p>
            </div>
            <button
              onClick={() => void restore(c)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs hover:border-accent-a/60 hover:text-accent-a"
            >
              Pulihkan
            </button>
            <button
              onClick={() => void destroy(c)}
              className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10"
            >
              Hapus permanen
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
