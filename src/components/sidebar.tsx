"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ConversationSummary, ProjectSummary } from "@/lib/types";

export const CONVERSATIONS_CHANGED = "zaltr:conversations-changed";

export function notifyConversationsChanged() {
  window.dispatchEvent(new Event(CONVERSATIONS_CHANGED));
}

export function Sidebar({
  user,
}: {
  user: { name: string; role: string; creditBalance: number };
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [convs, setConvs] = useState<ConversationSummary[]>([]);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // Sidebar ciut (rail mini) — pilihan tersimpan di localStorage.
  const [mini, setMini] = useState(false);
  useEffect(() => {
    setMini(localStorage.getItem("zaltr:sidebar") === "mini");
  }, []);
  function setMiniPersist(v: boolean) {
    setMini(v);
    localStorage.setItem("zaltr:sidebar", v ? "mini" : "full");
  }
  // Drawer sidebar untuk mobile (<md): tertutup otomatis tiap pindah halaman.
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const load = useCallback(async () => {
    const [cRes, pRes] = await Promise.all([
      fetch("/api/conversations", { cache: "no-store" }),
      fetch("/api/projects", { cache: "no-store" }),
    ]);
    if (cRes.ok) {
      setConvs(((await cRes.json()) as { conversations: ConversationSummary[] }).conversations);
    }
    if (pRes.ok) {
      setProjects(((await pRes.json()) as { projects: ProjectSummary[] }).projects);
    }
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener(CONVERSATIONS_CHANGED, load);
    return () => window.removeEventListener(CONVERSATIONS_CHANGED, load);
  }, [load]);

  useEffect(() => {
    function close(e: MouseEvent) {
      if ((e.target as HTMLElement | null)?.closest("[data-menu-root]")) return;
      setMenuFor(null);
    }
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  const filter = (list: ConversationSummary[]) =>
    q.trim() ? list.filter((c) => c.title.toLowerCase().includes(q.toLowerCase())) : list;

  const byProject = (pid: string) => filter(convs.filter((c) => c.projectId === pid));
  const loose = filter(convs.filter((c) => !c.projectId));
  const pinned = loose.filter((c) => c.pinned);
  const recent = loose.filter((c) => !c.pinned);

  async function createProject() {
    const name = projectName.trim();
    if (!name) return;
    await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setProjectName("");
    setCreatingProject(false);
    void load();
  }

  async function renameProject(p: ProjectSummary) {
    const name = prompt("Nama project:", p.name)?.trim();
    if (!name || name === p.name) return;
    await fetch(`/api/projects/${p.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    void load();
  }

  async function deleteProject(p: ProjectSummary) {
    if (!confirm(`Hapus project "${p.name}"? Chat di dalamnya tetap ada (keluar dari project).`))
      return;
    await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
    void load();
  }

  async function newChatInProject(pid: string) {
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: pid }),
    });
    const data = (await res.json()) as { conversation: { id: string } };
    void load();
    router.push(`/chat/${data.conversation.id}`);
  }

  async function patchConv(id: string, body: Record<string, unknown>) {
    await fetch(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    void load();
  }

  async function renameConv(c: ConversationSummary) {
    const title = prompt("Judul chat:", c.title)?.trim();
    if (!title || title === c.title) return;
    await patchConv(c.id, { title });
  }

  async function moveToTrash(c: ConversationSummary) {
    if (!confirm(`Pindahkan "${c.title}" ke trash?`)) return;
    await fetch(`/api/conversations/${c.id}`, { method: "DELETE" });
    if (pathname === `/chat/${c.id}`) router.push("/chat");
    void load();
  }

  function toggleCollapse(pid: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid);
      else next.add(pid);
      return next;
    });
  }

  const row = (c: ConversationSummary) => (
    <Row
      key={c.id}
      c={c}
      active={pathname === `/chat/${c.id}`}
      projects={projects}
      menuOpen={menuFor === c.id}
      onMenu={(open) => setMenuFor(open ? c.id : null)}
      onPatch={patchConv}
      onRename={renameConv}
      onTrash={moveToTrash}
    />
  );

  // Chrome mobile: bilah atas (buka drawer) + latar gelap saat drawer terbuka.
  const mobileChrome = (
    <>
      <div className="fixed inset-x-0 top-0 z-30 flex h-[calc(3rem+env(safe-area-inset-top))] items-center gap-2 border-b border-line bg-bg/85 px-3 pt-[env(safe-area-inset-top)] backdrop-blur md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Buka menu"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink hover:border-accent-a/60"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <Link href="/chat" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-192.png" alt="" className="h-6 w-6 rounded-md" />
          <span className="wordmark text-base font-bold">CALYZR.AI</span>
        </Link>
      </div>
      {mobileOpen && (
        <div
          onClick={() => setMobileOpen(false)}
          aria-hidden
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
        />
      )}
    </>
  );

  // Rail mini hanya untuk desktop; di mobile selalu memakai drawer penuh.
  const rail = (
    <aside className="hidden w-14 shrink-0 flex-col items-center gap-3 border-r border-line bg-panel py-4 md:flex">
      <button onClick={() => setMiniPersist(false)} title="Bentangkan sidebar">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-192.png" alt="zaltr" className="h-8 w-8 rounded-lg" />
      </button>
      <Link
        href="/chat"
        title="Chat baru"
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-line text-lg text-accent-a hover:border-accent-a/60"
      >
        +
      </Link>
      <button
        onClick={() => setMiniPersist(false)}
        title="Bentangkan sidebar"
        className="mt-auto flex h-9 w-9 items-center justify-center rounded-xl border border-line text-muted hover:text-ink"
      >
        »
      </button>
    </aside>
  );

  return (
    <>
      {mobileChrome}
      {mini && rail}
      <aside
        className={`flex w-72 shrink-0 flex-col border-r border-line bg-panel ${
          mini ? "md:hidden" : ""
        } max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-50 max-md:max-w-[85vw] max-md:bg-panel-solid max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)] max-md:shadow-2xl max-md:transition-transform max-md:duration-300 max-md:ease-out ${
          mobileOpen ? "max-md:translate-x-0" : "max-md:-translate-x-full"
        }`}
      >
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <Link href="/chat" className="flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-192.png" alt="" className="h-7 w-7 rounded-lg" />
          <span className="wordmark text-lg font-bold">CALYZR.AI</span>
        </Link>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMiniPersist(true)}
            title="Ciutkan sidebar"
            className="rounded-lg border border-line px-2 py-1 text-xs text-muted hover:text-ink max-md:hidden"
          >
            «
          </button>
          <button
            onClick={() => setMobileOpen(false)}
            title="Tutup menu"
            aria-label="Tutup menu"
            className="rounded-lg border border-line px-2 py-1 text-xs text-muted hover:text-ink md:hidden"
          >
            ✕
          </button>
        </div>
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
          className="w-full rounded-lg border border-line bg-bg px-3 py-1.5 text-base outline-none placeholder:text-muted focus:border-accent-b/60 md:text-sm"
        />
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
        {/* ===== Projects (folder ala GPT) ===== */}
        <div>
          <div className="flex items-center justify-between px-2 pb-1">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted">
              Projects
            </h3>
            <button
              onClick={() => setCreatingProject((v) => !v)}
              title="Project baru"
              className="rounded px-1 text-sm text-muted hover:text-accent-a"
            >
              +
            </button>
          </div>

          {creatingProject && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void createProject();
              }}
              className="px-1 pb-2"
            >
              <input
                autoFocus
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setCreatingProject(false)}
                placeholder="Nama project… (Enter)"
                className="w-full rounded-lg border border-accent-b/50 bg-bg px-2 py-1.5 text-sm outline-none"
              />
            </form>
          )}

          {projects.length === 0 && !creatingProject && (
            <p className="px-2 py-1 text-xs text-muted">
              Belum ada project. Klik + untuk membuat folder.
            </p>
          )}

          <ul className="space-y-0.5">
            {projects.map((p) => {
              const items = byProject(p.id);
              const isCollapsed = collapsed.has(p.id);
              return (
                <li key={p.id}>
                  <div className="group flex items-center gap-1 rounded-lg px-1 py-1 hover:bg-panel-2">
                    <button
                      onClick={() => toggleCollapse(p.id)}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm"
                      title={p.name}
                    >
                      <span className="text-[10px] text-muted">{isCollapsed ? "▸" : "▾"}</span>
                      <span aria-hidden>🗂️</span>
                      <span className="truncate">{p.name}</span>
                      <span className="text-[10px] text-muted">{items.length}</span>
                    </button>
                    <div className="flex shrink-0 gap-0.5 md:hidden md:group-hover:flex">
                      <button
                        onClick={() => void newChatInProject(p.id)}
                        title="Chat baru di project ini"
                        className="rounded px-1 text-xs text-muted hover:text-accent-a"
                      >
                        +
                      </button>
                      <button
                        onClick={() => void renameProject(p)}
                        title="Ganti nama"
                        className="rounded px-1 text-xs text-muted hover:text-ink"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => void deleteProject(p)}
                        title="Hapus project"
                        className="rounded px-1 text-xs text-muted hover:text-red-400"
                      >
                        🗑
                      </button>
                    </div>
                  </div>
                  {!isCollapsed && (
                    <ul className="ml-4 space-y-0.5 border-l border-line pl-2">
                      {items.length === 0 && (
                        <li className="px-2 py-1 text-[11px] text-muted">Kosong</li>
                      )}
                      {items.map(row)}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {pinned.length > 0 && <Section title="Disematkan">{pinned.map(row)}</Section>}

        <Section title="Terbaru">
          {recent.length === 0 && (
            <p className="px-2 py-1 text-xs text-muted">Belum ada chat.</p>
          )}
          {recent.map(row)}
        </Section>
      </nav>

      <footer className="border-t border-line px-4 py-3 text-[11px] leading-relaxed text-muted">
        <div className="mb-2 flex items-center justify-between">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-ink">{user.name}</p>
            <p className="text-[10px] uppercase tracking-wider">
              {user.role} · {user.creditBalance.toLocaleString("id-ID")} kredit
            </p>
          </div>
          <button
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              router.push("/login");
              router.refresh();
            }}
            title="Keluar"
            className="shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] hover:border-red-400/60 hover:text-red-300"
          >
            Keluar
          </button>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/chat/trash" className="text-xs text-muted hover:text-accent-a">
            🗑 Trash
          </Link>
          <Link href="/chat/settings" className="text-xs text-muted hover:text-accent-a">
            ⚙ Pengaturan
          </Link>
          {(user.role === "admin" || user.role === "superadmin") && (
            <Link href="/admin" className="text-xs text-muted hover:text-accent-b">
              ⚙ Admin
            </Link>
          )}
        </div>
        {user.role === "user" && (
          <Link
            href="/chat/upgrade"
            className="mt-2 block rounded-xl bg-gradient-to-r from-accent-a to-accent-b px-3 py-2 text-center text-xs font-semibold text-black hover:opacity-90"
          >
            ✨ Beli Kredit
          </Link>
        )}
      </footer>
    </aside>
    </>
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
  projects,
  menuOpen,
  onMenu,
  onPatch,
  onRename,
  onTrash,
}: {
  c: ConversationSummary;
  active: boolean;
  projects: ProjectSummary[];
  menuOpen: boolean;
  onMenu: (open: boolean) => void;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
  onRename: (c: ConversationSummary) => void;
  onTrash: (c: ConversationSummary) => void;
}) {
  return (
    <li className="group relative">
      <Link
        href={`/chat/${c.id}`}
        className={`block truncate rounded-lg px-2 py-1.5 pr-8 text-sm ${
          active ? "bg-panel-2 text-ink" : "text-muted hover:bg-panel-2 hover:text-ink"
        }`}
        title={c.title}
      >
        {c.pinned && <span className="mr-1 text-[10px]">📌</span>}
        {c.title}
      </Link>
      <button
        data-menu-root
        onClick={(e) => {
          e.stopPropagation();
          onMenu(!menuOpen);
        }}
        title="Menu chat"
        className={`absolute right-1 top-1/2 -translate-y-1/2 rounded px-1 text-sm text-muted hover:text-ink max-md:px-2 max-md:py-1 ${
          menuOpen ? "" : "block md:hidden md:group-hover:block"
        }`}
      >
        ⋯
      </button>

      {menuOpen && (
        <div
          data-menu-root
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-8 z-30 w-56 rounded-xl border border-line bg-panel-solid p-1.5 shadow-2xl"
        >
          <MenuBtn
            onClick={() => {
              onMenu(false);
              onRename(c);
            }}
          >
            Ganti nama
          </MenuBtn>
          <MenuBtn
            onClick={() => {
              onMenu(false);
              void onPatch(c.id, { pinned: !c.pinned });
            }}
          >
            {c.pinned ? "Lepas sematan" : "Sematkan"}
          </MenuBtn>

          <p className="px-2 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Pindahkan ke project
          </p>
          {projects.length === 0 && (
            <p className="px-2 pb-1 text-[11px] text-muted">Belum ada project</p>
          )}
          {projects
            .filter((p) => p.id !== c.projectId)
            .map((p) => (
              <MenuBtn
                key={p.id}
                onClick={() => {
                  onMenu(false);
                  void onPatch(c.id, { projectId: p.id });
                }}
              >
                🗂️ {p.name}
              </MenuBtn>
            ))}
          {c.projectId && (
            <MenuBtn
              onClick={() => {
                onMenu(false);
                void onPatch(c.id, { projectId: null });
              }}
            >
              Keluarkan dari project
            </MenuBtn>
          )}

          <div className="my-1 border-t border-line" />
          <MenuBtn
            danger
            onClick={() => {
              onMenu(false);
              onTrash(c);
            }}
          >
            Pindahkan ke trash
          </MenuBtn>
        </div>
      )}
    </li>
  );
}

function MenuBtn({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full truncate rounded-lg px-2 py-1.5 text-left text-sm ${
        danger ? "text-red-300 hover:bg-red-500/10" : "text-ink hover:bg-panel-2"
      }`}
    >
      {children}
    </button>
  );
}
