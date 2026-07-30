"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import { ModelPicker, loadSavedModel, DEFAULT_MODEL } from "@/components/model-picker";
import { notifyConversationsChanged } from "@/components/sidebar";
import type { ChatMessage, StreamLine } from "@/lib/types";

const SUGGESTIONS = [
  "Buatkan rencana belajar AI 30 hari untuk pemula",
  "Tulis contoh fungsi TypeScript dengan penjelasan",
  "Buatkan gambar pemandangan kota futuristik saat senja",
  "Ringkas dokumen yang saya lampirkan",
];

export function ChatView({
  conversationId: initialConversationId,
  initialMessages,
}: {
  conversationId: string | null;
  initialMessages: ChatMessage[];
}) {
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [streamText, setStreamText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [webSearch, setWebSearch] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setModel(loadSavedModel()), []);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  const streaming = streamText !== null;

  async function ensureConversation(): Promise<string> {
    if (conversationId) return conversationId;
    const res = await fetch("/api/conversations", { method: "POST" });
    const data = (await res.json()) as { conversation: { id: string } };
    setConversationId(data.conversation.id);
    window.history.replaceState(null, "", `/chat/${data.conversation.id}`);
    notifyConversationsChanged();
    return data.conversation.id;
  }

  async function send(textArg?: string, opts?: { regenerate?: boolean }) {
    const regenerate = opts?.regenerate ?? false;
    const text = (textArg ?? draft).trim();
    if ((!text && attachments.length === 0 && !regenerate) || streaming || uploading) return;
    setDraft("");
    setError(null);

    // Upload lampiran dulu -> jadikan markdown di isi pesan (gambar inline,
    // dokumen sebagai link; server mengekstrak isinya untuk model).
    let content = text;
    if (!regenerate && attachments.length > 0) {
      setUploading(true);
      try {
        const fd = new FormData();
        for (const f of attachments) fd.append("file", f);
        const up = await fetch("/api/uploads", { method: "POST", body: fd });
        const data = (await up.json()) as {
          files?: Array<{ url: string; name: string; type: string }>;
          error?: string;
        };
        if (!up.ok || !data.files) throw new Error(data.error ?? "Upload gagal");
        const lines = data.files.map((f) =>
          f.type.startsWith("image/") ? `![${f.name}](${f.url})` : `[\u{1F4CE} ${f.name}](${f.url})`,
        );
        content = [text, ...lines].filter(Boolean).join("\n\n");
        setAttachments([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload gagal");
        setDraft(text);
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    const convId = await ensureConversation();
    if (!regenerate) {
      const optimistic: ChatMessage = {
        id: `tmp-${Date.now()}`,
        role: "user",
        content,
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
    }
    setStreamText("");

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: convId,
          content,
          modelId: model,
          web: webSearch,
          regenerate,
        }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error ?? `Server error ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          if (!raw.trim()) continue;
          const line = JSON.parse(raw) as StreamLine;
          if (line.type === "meta") notifyConversationsChanged();
          if (line.type === "delta") {
            acc += line.text;
            setStreamText(acc);
          }
          if (line.type === "error") setError(line.message);
          if (line.type === "done") {
            setMessages((prev) => [
              ...prev,
              {
                id: line.messageId,
                role: "assistant",
                content: line.content,
                model,
                status: line.status,
                createdAt: new Date().toISOString(),
              },
            ]);
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "Gagal menghubungi server");
      } else if (acc) {
        setMessages((prev) => [
          ...prev,
          {
            id: `stopped-${Date.now()}`,
            role: "assistant",
            content: acc,
            model,
            status: "stopped",
            createdAt: new Date().toISOString(),
          },
        ]);
      }
    } finally {
      setStreamText(null);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && !streaming ? (
          <EmptyState onPick={(s) => void send(s)} />
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
            {messages.map((m, i) => (
              <Bubble
                key={m.id}
                message={m}
                isLastAssistant={
                  m.role === "assistant" &&
                  i === messages.length - 1 &&
                  !streaming
                }
                isLastUser={
                  m.role === "user" &&
                  !messages.slice(i + 1).some((x) => x.role === "user") &&
                  !streaming
                }
                onRegenerate={() => void send(undefined, { regenerate: true })}
                onEdit={(text) => {
                  setDraft(text);
                  textareaRef.current?.focus();
                }}
              />
            ))}
            {streaming && (
              <div className="text-sm leading-relaxed">
                <RoleTag role="assistant" />
                <div className="stream-caret mt-1">
                  <Markdown>{streamText ?? ""}</Markdown>
                </div>
              </div>
            )}
            {error && (
              <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
                {error}
              </p>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="border-t border-line bg-panel/60 px-4 py-3 backdrop-blur">
        {attachments.length > 0 && (
          <div className="mx-auto mb-2 flex w-full max-w-3xl flex-wrap gap-1.5">
            {attachments.map((f, i) => (
              <span
                key={`${f.name}-${i}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel-2 px-2 py-1 text-xs"
              >
                <span className="max-w-[180px] truncate">{f.name}</span>
                <span className="text-muted">{formatSize(f.size)}</span>
                <button
                  onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                  className="text-muted hover:text-red-400"
                  aria-label={`Hapus ${f.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          {/* Tombol model DI SAMPING kolom chat — fitur inti zaltr.ai */}
          <ModelPicker value={model} onChange={setModel} disabled={streaming} />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              const picked = Array.from(e.target.files ?? []);
              setAttachments((prev) => [...prev, ...picked].slice(0, 5));
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={streaming || uploading}
            title="Lampirkan file (maks 5, 25 MB per file)"
            aria-label="Lampirkan file"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-panel-2 text-muted hover:border-accent-b/60 hover:text-ink disabled:opacity-40"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
            </svg>
          </button>
          <button
            onClick={() => setWebSearch((v) => !v)}
            disabled={streaming}
            title={webSearch ? "Cari web: AKTIF — jawaban memakai hasil pencarian" : "Cari web: mati"}
            aria-label="Toggle cari web"
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-sm disabled:opacity-40 ${
              webSearch
                ? "border-accent-a/70 bg-accent-a/10 text-accent-a"
                : "border-line bg-panel-2 text-muted hover:border-accent-b/60 hover:text-ink"
            }`}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          </button>
          <div className="flex min-h-10 flex-1 items-end rounded-xl border border-line bg-panel-2 focus-within:border-accent-b/60">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                const el = e.target;
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
              }}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Tulis pesan… (Enter kirim, Shift+Enter baris baru)"
              className="max-h-52 w-full resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted"
            />
          </div>
          {streaming ? (
            <button
              onClick={stop}
              className="h-10 rounded-xl border border-red-500/50 bg-red-500/10 px-4 text-sm font-medium text-red-300 hover:bg-red-500/20"
            >
              Stop
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={(!draft.trim() && attachments.length === 0) || uploading}
              className="h-10 rounded-xl bg-gradient-to-r from-accent-a to-accent-b px-4 text-sm font-semibold text-black disabled:opacity-40"
            >
              {uploading ? "Mengunggah…" : "Kirim"}
            </button>
          )}
        </div>
        <p className="mx-auto mt-1.5 w-full max-w-3xl text-center text-[10px] text-muted">
          Setiap pesan tersimpan permanen sebelum model dijalankan (write-first).
        </p>
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-4">
      <h1 className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-192.png" alt="" className="h-12 w-12 rounded-xl" />
        <span className="wordmark text-4xl font-black tracking-widest">ZALTR.AI</span>
      </h1>
      <p className="max-w-md text-center text-sm text-muted">
        Satu ruang kerja untuk semua AI terbaik — chat, gambar, video, dan musik.
        Pilih model dari tombol di samping kolom pesan.
      </p>
      <div className="grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onPick(s)}
            className="rounded-xl border border-line bg-panel px-3 py-2.5 text-left text-sm text-muted hover:border-accent-a/50 hover:text-ink"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function RoleTag({ role }: { role: string }) {
  return role === "user" ? (
    <span className="text-[11px] font-semibold uppercase tracking-wider text-accent-b">
      Kamu
    </span>
  ) : (
    <span className="wordmark text-[11px] font-semibold uppercase tracking-wider">
      zaltr
    </span>
  );
}

function Bubble({
  message,
  isLastAssistant,
  isLastUser,
  onRegenerate,
  onEdit,
}: {
  message: ChatMessage;
  isLastAssistant?: boolean;
  isLastUser?: boolean;
  onRegenerate?: () => void;
  onEdit?: (text: string) => void;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  // Pesan user dengan lampiran berisi markdown gambar/link -> render markdown
  // supaya lampiran tampil; teks murni tetap plain (tanpa formatting tak sengaja).
  const hasAttachment = isUser && message.content.includes("](/api/files/");

  async function copy() {
    await navigator.clipboard.writeText(message.content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="group text-sm leading-relaxed">
      <RoleTag role={message.role} />
      <div
        className={`mt-1 ${
          isUser
            ? "rounded-2xl rounded-tl-sm border border-line bg-panel-2 px-4 py-3"
            : ""
        }`}
      >
        {isUser && !hasAttachment ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <Markdown>{message.content}</Markdown>
        )}
      </div>
      {/* Aksi kecil ala ChatGPT: salin / regenerate / edit */}
      <div className="mt-1 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={() => void copy()}
          className="text-[11px] text-muted hover:text-ink"
          title="Salin isi pesan"
        >
          {copied ? "Tersalin ✓" : "Salin"}
        </button>
        {isLastAssistant && onRegenerate && (
          <button
            onClick={onRegenerate}
            className="text-[11px] text-muted hover:text-accent-a"
            title="Buat ulang jawaban (model menjawab lagi)"
          >
            ↻ Ulangi jawaban
          </button>
        )}
        {isUser && isLastUser && onEdit && (
          <button
            onClick={() => onEdit(message.content.split("\n\n![")[0].split("\n\n[📎")[0])}
            className="text-[11px] text-muted hover:text-accent-a"
            title="Salin teks ke kolom pesan untuk diedit lalu kirim ulang"
          >
            ✎ Edit
          </button>
        )}
      </div>
      {message.status === "stopped" && (
        <p className="mt-1 text-[11px] italic text-muted">Dihentikan oleh pengguna.</p>
      )}
      {message.status === "failed" && (
        <p className="mt-1 text-[11px] italic text-red-400">Provider gagal menjawab.</p>
      )}
    </div>
  );
}
