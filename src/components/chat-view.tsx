"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import { ModelPicker, loadSavedModel, DEFAULT_MODEL } from "@/components/model-picker";
import { notifyConversationsChanged } from "@/components/sidebar";
import type { ChatMessage, StreamLine } from "@/lib/types";

const SUGGESTIONS = [
  "Jelaskan arsitektur zaltr.ai secara singkat",
  "Buat contoh fungsi TypeScript dengan penjelasan",
  "Apa bedanya provider Copilot, Ollama, dan ComfyUI di sini?",
  "Tulis rencana belajar AI 30 hari",
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
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  async function send(textArg?: string) {
    const text = (textArg ?? draft).trim();
    if (!text || streaming) return;
    setDraft("");
    setError(null);

    const convId = await ensureConversation();
    const optimistic: ChatMessage = {
      id: `tmp-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    setStreamText("");

    const controller = new AbortController();
    abortRef.current = controller;
    let acc = "";

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convId, content: text, modelId: model }),
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
            {messages.map((m) => (
              <Bubble key={m.id} message={m} />
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
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          {/* Tombol model DI SAMPING kolom chat — fitur inti zaltr.ai */}
          <ModelPicker value={model} onChange={setModel} disabled={streaming} />
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
              disabled={!draft.trim()}
              className="h-10 rounded-xl bg-gradient-to-r from-accent-a to-accent-b px-4 text-sm font-semibold text-black disabled:opacity-40"
            >
              Kirim
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
      <h1 className="wordmark text-4xl font-black tracking-widest">ZALTR.AI</h1>
      <p className="max-w-md text-center text-sm text-muted">
        Satu ruang kerja AI — Copilot Enterprise, Ollama, dan ComfyUI dalam satu chat.
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

function Bubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className="text-sm leading-relaxed">
      <RoleTag role={message.role} />
      <div
        className={`mt-1 ${
          isUser
            ? "rounded-2xl rounded-tl-sm border border-line bg-panel-2 px-4 py-3"
            : ""
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{message.content}</p>
        ) : (
          <Markdown>{message.content}</Markdown>
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
