"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ConversationSummary } from "@/lib/types";

export const CONVERSATIONS_CHANGED = "zaltr:conversations-changed";

export function notifyConversationsChanged() {
  window.dispatchEvent(new Event(CONVERSATIONS_CHANGED));
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/conversations", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { conversations: ConversationSummary[] };
    setItems(data.conversations);
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener(CONVERSATIONS_CHANGED, load);
    return () => window.removeEventListener(CONVERSATIONS_CHANGED, load);
  }, [load]);

  const filtered = q.trim()
    ? items.filter((c) => c.title.toLowerCase().includes(q.toLowerCase()))
    : items;
  const pinned = filtered.filter((c) => c.pinned);
  const recent = filtered.filter((c) => !c.pinned);

  async function togglePin(c: ConversationSummary) {
    await fetch(`/api/conversations/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned: !c.pinned }),
    });
    void load();
  }

  async function moveToTrash(c: ConversationSummary) {
    if (!confirm(`Pindahkan "${c.title}" ke trash?`)) return;
    await fetch(`/api/conversations/${c.id}`, { method: "DELETE" });
    if (pathname === `/chat/${c.id}`) router.push("/chat");
    void load();
  }

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-line bg-panel max-md:hidden">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <Link href="/chat" className="wordmark text-lg font-bold">
          ZALTR.AI
        </Link>
        <span className="rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted">
          preview
        </span>
      </div>

      <div className="px-3 pb-2">
        <Link
          href="/chat"
          className="flex w-full items-center gap-2 rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm font-medium hover:border-accent-a/60"
        >
          <span className="text-accent-a">+</span> Chat baru
        </Link>
      </div>

      <div className="px-3 pb-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cari chat…"
          className="w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-sm outline-none placeholder:text-muted focus:border-accent-b/60"
        />
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {pinned.length > 0 && (
          <Section title="Disematkan">
            {pinned.map((c) => (
              <Row
                key={c.id}
                c={c}
                active={pathname === `/chat/${c.id}`}
                onPin={togglePin}
                onTrash={moveToTrash}
              />
            ))}
          </Section>
        )}
        <Section title="Terbaru">
          {recent.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted">Belum ada chat.</p>
          )}
          {recent.map((c) => (
            <Row
              key={c.id}
              c={c}
              active={pathname === `/chat/${c.id}`}
              onPin={togglePin}
              onTrash={moveToTrash}
            />
          ))}
        </Section>
      </nav>

      <footer className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-muted">
        Chat tersimpan permanen di PostgreSQL zaltr.
        <br />
        Hapus = pindah ke trash (bukan musnah).
      </footer>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
        {title}
      </h3>
      <ul className="space-y-0.5">{children}</ul>
    </div>
  );
}

function Row({
  c,
  active,
  onPin,
  onTrash,
}: {
  c: ConversationSummary;
  active: boolean;
  onPin: (c: ConversationSummary) => void;
  onTrash: (c: ConversationSummary) => void;
}) {
  return (
    <li className="group relative">
      <Link
        href={`/chat/${c.id}`}
        className={`block truncate rounded-lg px-2 py-1.5 pr-14 text-sm ${
          active ? "bg-panel-2 text-ink" : "text-muted hover:bg-panel-2 hover:text-ink"
        }`}
        title={c.title}
      >
        {c.title}
      </Link>
      <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 gap-1 group-hover:flex">
        <button
          onClick={() => onPin(c)}
          title={c.pinned ? "Lepas sematan" : "Sematkan"}
          className="rounded p-1 text-xs text-muted hover:text-accent-a"
        >
          {c.pinned ? "📌" : "📍"}
        </button>
        <button
          onClick={() => onTrash(c)}
          title="Pindahkan ke trash"
          className="rounded p-1 text-xs text-muted hover:text-red-400"
        >
          🗑
        </button>
      </div>
    </li>
  );
}
