"use client";

import { useCallback, useEffect, useState } from "react";

type WsFile = { path: string; key: string; size: number; url: string };

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function icon(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (["pdf"].includes(ext)) return "📄";
  if (["doc", "docx"].includes(ext)) return "📝";
  if (["xls", "xlsx", "csv"].includes(ext)) return "📊";
  if (["ppt", "pptx"].includes(ext)) return "📽️";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext)) return "🖼️";
  if (["py", "js", "ts", "sh", "json", "html", "css"].includes(ext)) return "💻";
  if (["zip", "tar", "gz"].includes(ext)) return "🗜️";
  return "📎";
}

/**
 * Panel "Berkas percakapan": semua berkas hasil kerja agen (workspace) untuk
 * percakapan ini — lihat, unduh, hapus. Muat ulang saat `refreshKey` berubah
 * (dipicu setelah jawaban agen selesai).
 */
export function ConversationFiles({
  conversationId,
  refreshKey,
}: {
  conversationId: string | null;
  refreshKey: number;
}) {
  const [files, setFiles] = useState<WsFile[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    if (!conversationId) {
      setFiles([]);
      return;
    }
    try {
      const res = await fetch(`/api/conversations/${conversationId}/files`, { cache: "no-store" });
      if (!res.ok) return;
      const d = (await res.json()) as { files?: WsFile[] };
      setFiles(d.files ?? []);
    } catch {
      /* abaikan */
    }
  }, [conversationId]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  async function remove(path: string) {
    if (!conversationId) return;
    if (!confirm(`Hapus berkas "${path}"?`)) return;
    const res = await fetch(
      `/api/conversations/${conversationId}/files?path=${encodeURIComponent(path)}`,
      { method: "DELETE" },
    );
    if (res.ok) setFiles((prev) => prev.filter((f) => f.path !== path));
  }

  if (!conversationId || files.length === 0) return null;

  return (
    <div>
      <div className="rounded-xl border border-line bg-panel">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-muted hover:text-ink"
        >
          <span>
            📂 Berkas percakapan <span className="tabular-nums">({files.length})</span>
          </span>
          <span>{open ? "▾" : "▸"}</span>
        </button>
        {open && (
          <ul className="divide-y divide-line border-t border-line">
            {files.map((f) => (
              <li key={f.key} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <span aria-hidden>{icon(f.path)}</span>
                <a
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 truncate text-ink hover:underline"
                  title={f.path}
                >
                  {f.path}
                </a>
                <span className="shrink-0 tabular-nums text-muted">{fmtSize(f.size)}</span>
                <a
                  href={f.url}
                  download
                  className="shrink-0 rounded border border-line px-1.5 py-0.5 text-muted hover:text-ink"
                  title="Unduh"
                >
                  ⤓
                </a>
                <button
                  onClick={() => void remove(f.path)}
                  className="shrink-0 rounded border border-line px-1.5 py-0.5 text-muted hover:border-red-500/60 hover:text-red-300"
                  title="Hapus"
                  aria-label={`Hapus ${f.path}`}
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Indikator langkah alat agen saat streaming (UI-only). */
export function AgentSteps({ steps }: { steps: string[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="mb-2 space-y-1 rounded-lg border border-accent-b/30 bg-accent-b/5 px-3 py-2 text-xs text-muted">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={i} className="flex items-center gap-2">
            <span className={last ? "inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent-b" : "text-accent-a"}>
              {last ? "" : "✓"}
            </span>
            <span className={last ? "text-ink" : ""}>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}
