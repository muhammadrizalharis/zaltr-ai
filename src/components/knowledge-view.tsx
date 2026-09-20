"use client";

import { useEffect, useMemo, useState } from "react";

type Source = {
  id: string;
  name: string;
  kind: string;
  status: string;
  chunkCount: number;
  bytes: number;
  projectId: string | null;
  assistantId: string | null;
  error: string | null;
  createdAt: string;
};
type Project = { id: string; name: string; instructions: string | null };
type Assistant = { id: string; name: string };

type Mode = "text" | "drive" | "upload";

/**
 * Kelola basis pengetahuan (RAG): tambah sumber (teks / link Drive / unggah),
 * lihat & hapus, dan atur cakupan Global vs per-Project + instruksi project.
 */
export function KnowledgeView() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [scope, setScope] = useState<string>("global"); // "global" | "p:<id>" | "a:<id>"
  const [mode, setMode] = useState<Mode>("text");
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [instr, setInstr] = useState("");
  const [savingInstr, setSavingInstr] = useState(false);

  const projectId = scope.startsWith("p:") ? scope.slice(2) : null;
  const assistantId = scope.startsWith("a:") ? scope.slice(2) : null;

  async function loadAll() {
    const [p, a, k] = await Promise.all([
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/assistants").then((r) => r.json()),
      fetch("/api/knowledge").then((r) => r.json()),
    ]);
    setProjects(p.projects ?? []);
    setAssistants(a.assistants ?? []);
    setSources(k.sources ?? []);
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    const p = projects.find((x) => x.id === projectId);
    setInstr(p?.instructions ?? "");
  }, [projectId, projects]);

  const visible = useMemo(
    () =>
      sources.filter((s) =>
        projectId
          ? s.projectId === projectId
          : assistantId
            ? s.assistantId === assistantId
            : s.projectId === null && s.assistantId === null,
      ),
    [sources, projectId, assistantId],
  );

  // Sumber dari unggah folder bernama "folder/path/file" -> kelompokkan jadi
  // pohon per-folder. Sumber tanpa "/" (catatan/berkas tunggal) tetap datar.
  const grouped = useMemo(() => {
    const folders = new Map<string, Source[]>();
    const flat: Source[] = [];
    for (const s of visible) {
      const slash = s.name.indexOf("/");
      if (slash > 0) {
        const folder = s.name.slice(0, slash);
        const arr = folders.get(folder);
        if (arr) arr.push(s);
        else folders.set(folder, [s]);
      } else {
        flat.push(s);
      }
    }
    return { folders: [...folders.entries()], flat };
  }, [visible]);

  async function add() {
    setBusy(true);
    setNotice(null);
    try {
      let body: Record<string, unknown>;
      if (mode === "text") {
        if (!text.trim()) throw new Error("Teks kosong");
        body = { kind: "text", name: name.trim() || "Catatan", content: text, projectId, assistantId };
      } else if (mode === "drive") {
        if (!link.trim()) throw new Error("Tempel link Google Drive");
        body = { kind: "drive", link: link.trim(), projectId, assistantId };
      } else {
        if (!file) throw new Error("Pilih berkas");
        const fd = new FormData();
        fd.append("files", file);
        const up = await fetch("/api/uploads", { method: "POST", body: fd }).then((r) => r.json());
        const key = up.files?.[0]?.key;
        if (!key) throw new Error("Unggah gagal");
        body = { kind: "upload", key, projectId, assistantId };
      }
      const res = await fetch("/api/knowledge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mengindeks");
      const total = (data.sources ?? []).reduce((a: number, b: { chunkCount: number }) => a + b.chunkCount, 0);
      setNotice(`Terindeks: ${(data.sources ?? []).length} sumber, ${total} potongan.`);
      setText("");
      setLink("");
      setFile(null);
      setName("");
      await loadAll();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    const res = await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
    if (res.ok) setSources((prev) => prev.filter((s) => s.id !== id));
  }

  async function removeGroup(items: Source[]) {
    await Promise.all(
      items.map((s) => fetch(`/api/knowledge/${s.id}`, { method: "DELETE" }).catch(() => {})),
    );
    const ids = new Set(items.map((i) => i.id));
    setSources((prev) => prev.filter((s) => !ids.has(s.id)));
  }

  async function saveInstr() {
    if (!projectId) return;
    setSavingInstr(true);
    const res = await fetch(`/api/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ instructions: instr }),
    });
    setSavingInstr(false);
    if (res.ok) {
      setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, instructions: instr } : p)));
      setNotice("Instruksi project tersimpan.");
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-8 px-4 py-8">
      <div>
        <h1 className="text-lg font-semibold">Basis Pengetahuan</h1>
        <p className="text-sm text-muted">
          Tambahkan dokumen agar AI menjawab berdasarkan isinya (dengan sitasi). Berlaku otomatis
          di chat — Global untuk semua, atau khusus sebuah Project.
        </p>
      </div>

      <section className="space-y-2">
        <label className="text-sm font-semibold">Cakupan</label>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          className="w-full rounded-xl border border-line bg-panel-solid px-3 py-2.5 text-base outline-none focus:border-accent-b/60 md:text-sm"
        >
          <option value="global">🌐 Global (semua chat)</option>
          {projects.map((p) => (
            <option key={p.id} value={`p:${p.id}`}>
              🗂️ {p.name}
            </option>
          ))}
          {assistants.map((a) => (
            <option key={a.id} value={`a:${a.id}`}>
              🤖 {a.name}
            </option>
          ))}
        </select>
      </section>

      {projectId && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold">Instruksi khusus project</h2>
          <p className="text-xs text-muted">
            Disuntik ke setiap chat di dalam project ini (ala Claude Projects).
          </p>
          <textarea
            value={instr}
            onChange={(e) => setInstr(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder="Mis. “Fokus ke jurnal deteksi plagiarisme. Jawab dalam bahasa Indonesia akademik.”"
            className="w-full resize-y rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-base outline-none focus:border-accent-b/60 md:text-sm"
          />
          <button
            onClick={() => void saveInstr()}
            disabled={savingInstr}
            className="rounded-xl border border-line px-3 py-1.5 text-sm hover:border-accent-b/60 disabled:opacity-40"
          >
            {savingInstr ? "Menyimpan…" : "Simpan instruksi"}
          </button>
        </section>
      )}

      <section className="space-y-3 rounded-2xl border border-line bg-panel p-4">
        <h2 className="text-sm font-semibold">Tambah sumber</h2>
        <div className="flex gap-2">
          {(["text", "drive", "upload"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                mode === m ? "bg-panel-2 text-ink" : "text-muted hover:text-ink"
              }`}
            >
              {m === "text" ? "Teks" : m === "drive" ? "Link Drive" : "Unggah berkas"}
            </button>
          ))}
        </div>

        {mode === "text" && (
          <>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nama sumber (opsional)"
              className="w-full rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-base outline-none focus:border-accent-b/60 md:text-sm"
            />
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              placeholder="Tempel teks/catatan di sini…"
              className="w-full resize-y rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-base outline-none focus:border-accent-b/60 md:text-sm"
            />
          </>
        )}
        {mode === "drive" && (
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            placeholder="https://drive.google.com/drive/folders/…"
            className="w-full rounded-xl border border-line bg-panel-2 px-3 py-2.5 text-base outline-none focus:border-accent-b/60 md:text-sm"
          />
        )}
        {mode === "upload" && (
          <input
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-panel-2 file:px-3 file:py-1.5 file:text-sm file:text-ink"
          />
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={() => void add()}
            disabled={busy}
            className="rounded-xl bg-gradient-to-r from-accent-a to-accent-b px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {busy ? "Mengindeks…" : "Tambah ke pengetahuan"}
          </button>
          {notice && <span className="text-xs text-muted">{notice}</span>}
        </div>
        {mode === "drive" && (
          <p className="text-xs text-muted">
            Folder besar bisa beberapa menit (maks 50 berkas teks; folder harus “Anyone with the link”).
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">
          Sumber {projectId ? "project ini" : assistantId ? "asisten ini" : "global"} ({visible.length})
        </h2>
        {visible.length === 0 ? (
          <p className="rounded-xl border border-line bg-panel px-3 py-3 text-sm text-muted">
            Belum ada sumber. Tambahkan dokumen di atas.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {grouped.folders.map(([folder, items]) => (
              <li key={`folder:${folder}`} className="rounded-xl border border-line bg-panel">
                <details>
                  <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate font-medium">📁 {folder}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted">
                        {items.length} berkas · {items.reduce((a, b) => a + b.chunkCount, 0)} potongan
                      </span>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          void removeGroup(items);
                        }}
                        className="text-xs text-muted hover:text-red-400"
                        title="Hapus seluruh folder"
                      >
                        Hapus folder
                      </button>
                    </span>
                  </summary>
                  <ul className="space-y-1 border-t border-line px-3 py-2">
                    {items.map((s) => (
                      <li key={s.id} className="flex items-start justify-between gap-3 text-xs">
                        <span className="min-w-0">
                          <span className="block truncate">{s.name.slice(folder.length + 1)}</span>
                          <span className="text-muted">
                            {s.status === "indexed" ? `${s.chunkCount} potongan` : s.status}
                            {s.error ? ` · ${s.error}` : ""}
                          </span>
                        </span>
                        <button
                          onClick={() => void remove(s.id)}
                          className="shrink-0 text-muted hover:text-red-400"
                          title="Hapus berkas ini"
                        >
                          Hapus
                        </button>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))}
            {grouped.flat.map((s) => (
              <li
                key={s.id}
                className="flex items-start justify-between gap-3 rounded-xl border border-line bg-panel px-3 py-2 text-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{s.name}</span>
                  <span className="text-xs text-muted">
                    {s.kind} · {s.status === "indexed" ? `${s.chunkCount} potongan` : s.status}
                    {s.error ? ` · ${s.error}` : ""}
                  </span>
                </span>
                <button
                  onClick={() => void remove(s.id)}
                  className="shrink-0 text-xs text-muted hover:text-red-400"
                  title="Hapus sumber ini"
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
