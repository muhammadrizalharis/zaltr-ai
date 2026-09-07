"use client";

import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import { ModelPicker, loadSavedModel, DEFAULT_MODEL } from "@/components/model-picker";
import { CanvasEditor } from "@/components/canvas-editor";
import { notifyConversationsChanged } from "@/components/sidebar";
import type { ChatMessage, ModelDescriptor, StreamLine } from "@/lib/types";
import { MODE_PARAFRASE, type ModeParafrase } from "@/server/paraphrase";

/** Batas lampiran per pesan (server menolak lebih dari ini). */
const MAX_FILES = 5;
/** Batas ukuran per berkas di sisi klien (samakan dgn server ZALTR_MAX_UPLOAD_MB). */
const MAX_UPLOAD_MB = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_MB) || 500;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;

type UploadResp = {
  files?: Array<{ url: string; name: string; type: string; size: number; ephemeral: boolean }>;
  quota?: { usedBytes: number; limitBytes: number };
  ephemeralCount?: number;
  error?: string;
};

/** Upload via XHR agar dapat progres unggah (fetch tidak memberi progres). */
function uploadFiles(files: File[], onProgress: (pct: number) => void): Promise<UploadResp> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    for (const f of files) fd.append("file", f);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/uploads");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: UploadResp = {};
      try {
        data = JSON.parse(xhr.responseText) as UploadResp;
      } catch {
        reject(new Error("Respons upload tidak valid"));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300 && data.files) resolve(data);
      else reject(new Error(data.error ?? "Upload gagal"));
    };
    xhr.onerror = () => reject(new Error("Koneksi upload gagal"));
    xhr.send(fd);
  });
}

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
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [ephemeralActive, setEphemeralActive] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [webSearch, setWebSearch] = useState(false);
  const [agentMode, setAgentMode] = useState(false);
  const [parafrase, setParafrase] = useState<ModeParafrase | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [imageModelId, setImageModelId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [sttOk, setSttOk] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const [canvas, setCanvas] = useState<{ open: boolean; content: string }>({ open: false, content: "" });
  const [canvasInstruction, setCanvasInstruction] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  // Naik tiap "chat baru" -> callback stream lama diabaikan (tak mengotori chat baru).
  const sessionRef = useRef(0);
  // Auto-scroll hanya saat pembaca memang sedang di bawah; kalau ia menggulir
  // ke atas untuk membaca, jangan diseret balik walau jawaban masih mengalir.
  const [stickToBottom, setStickToBottom] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setModel(loadSavedModel()), []);
  useEffect(() => {
    setSttOk("SpeechRecognition" in window || "webkitSpeechRecognition" in window);
  }, []);

  // "+ Chat baru": reset tampilan ke chat kosong. Dipakai karena URL chat diubah
  // via replaceState (router Next bisa mengira masih di /chat -> Link jadi no-op).
  useEffect(() => {
    function onNewChat() {
      sessionRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      runIdRef.current = null;
      setConversationId(null);
      setMessages([]);
      setStreamText(null);
      setDraft("");
      setError(null);
      setSuggestions([]);
      setAttachments([]);
      window.history.replaceState(null, "", "/chat");
      textareaRef.current?.focus();
    }
    window.addEventListener("zaltr:new-chat", onNewChat);
    return () => window.removeEventListener("zaltr:new-chat", onNewChat);
  }, []);
  // Freemium: bila model tersimpan terkunci/tidak tersedia utk akun ini,
  // otomatis pindah ke model pertama yang bisa dipakai (mis. Calyzr Free).
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/models", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { models: ModelDescriptor[] };
      const saved = loadSavedModel();
      const usable = (id: string) =>
        data.models.some((m) => m.id === id && m.available && !m.locked);
      if (!usable(saved)) {
        const first = data.models.find((m) => m.available && !m.locked);
        if (first) setModel(first.id);
      }
      const img = data.models.find(
        (m) => m.capabilities.includes("image") && m.available && !m.locked,
      );
      setImageModelId(img?.id ?? null);
    })();
  }, []);

  // Tutup menu "+" saat klik di luar / tekan Escape.
  useEffect(() => {
    if (!plusOpen) return;
    function onDocClick(e: MouseEvent) {
      if ((e.target as HTMLElement | null)?.closest("[data-plus-root]")) return;
      setPlusOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPlusOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [plusOpen]);

  /** Sumber tunggal penambahan lampiran: tombol, tempel (Ctrl+V), & seret-lepas. */
  function addFiles(incoming: File[]) {
    if (incoming.length === 0) return;
    setError(null);
    const tooBig = incoming.filter((f) => f.size > MAX_UPLOAD_BYTES);
    const ok = incoming.filter((f) => f.size <= MAX_UPLOAD_BYTES);
    if (tooBig.length) {
      setError(
        `${tooBig.map((f) => f.name).join(", ")} melebihi ${MAX_UPLOAD_MB} MB — dilewati.`,
      );
    }
    if (ok.length === 0) return;
    setAttachments((prev) => {
      if (prev.length >= MAX_FILES) {
        setError(`Maksimal ${MAX_FILES} lampiran per pesan.`);
        return prev;
      }
      const next = [...prev, ...ok].slice(0, MAX_FILES);
      if (prev.length + ok.length > MAX_FILES) {
        setError(`Maksimal ${MAX_FILES} lampiran per pesan — sisanya diabaikan.`);
      }
      return next;
    });
  }

  // Tempel (Ctrl+V) gambar/berkas dari papan klip — berlaku di seluruh halaman
  // chat, bukan hanya saat kursor berada di kolom pesan.
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault(); // jangan tempel nama berkas sebagai teks
      addFiles(files);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Denyut selama sesi memiliki lampiran sementara: jaga file dari pembersih TTL
  // (berhenti saat aplikasi ditutup -> file dibersihkan setelah masa tenggang).
  useEffect(() => {
    if (!ephemeralActive) return;
    const ping = () => void fetch("/api/uploads/heartbeat", { method: "POST" });
    ping();
    const id = setInterval(ping, 4 * 60_000);
    return () => clearInterval(id);
  }, [ephemeralActive]);

  useEffect(() => {
    if (!stickToBottom) return;
    // Saat streaming pakai lompatan instan: "smooth" tiap token bertabrakan
    // dengan guliran manual pengguna.
    bottomRef.current?.scrollIntoView({
      behavior: streamText === null ? "smooth" : "auto",
      block: "end",
    });
  }, [messages, streamText, stickToBottom]);

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
    setSuggestions([]);
    setStickToBottom(true); // kirim pesan = kembali mengikuti bagian bawah
    const mySession = sessionRef.current;

    // Upload lampiran dulu -> jadikan markdown di isi pesan (gambar inline,
    // dokumen sebagai link; server mengekstrak isinya untuk model).
    let content = text;
    if (!regenerate && attachments.length > 0) {
      setUploading(true);
      setUploadPct(0);
      try {
        const data = await uploadFiles(attachments, setUploadPct);
        const files = data.files ?? [];
        const lines = files.map((f) =>
          f.type.startsWith("image/")
            ? `![${f.name}](${f.url})`
            : `[\u{1F4CE} ${f.name}${f.ephemeral ? " (sementara)" : ""}](${f.url})`,
        );
        content = [text, ...lines].filter(Boolean).join("\n\n");
        if ((data.ephemeralCount ?? 0) > 0) {
          const gb = Math.round((data.quota?.limitBytes ?? 5 * 1024 ** 3) / 1024 ** 3);
          setEphemeralActive(true);
          setNotice(
            `Kuota ${gb} GB penuh — berkas ini disimpan sementara: tetap bisa diproses AI sekarang, tapi hilang saat kamu keluar/logout (bukan sekadar pindah tab).`,
          );
        }
        setAttachments([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload gagal");
        setDraft(text);
        setUploading(false);
        setUploadPct(null);
        return;
      }
      setUploading(false);
      setUploadPct(null);
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
          ...(agentMode ? { agent: true } : {}),
          ...(parafrase ? { paraphrase: parafrase } : {}),
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
          if (sessionRef.current !== mySession) continue; // sesi lama (chat baru ditekan)
          if (line.type === "meta") {
            runIdRef.current = line.runId;
            notifyConversationsChanged();
          }
          if (line.type === "delta") {
            acc += line.text;
            setStreamText(acc);
          }
          if (line.type === "error") setError(line.message);
          if (line.type === "done") {
            notifyConversationsChanged(); // judul hasil AI biasanya siap di sini
            // Jawaban kosong bukan jawaban — servernya pun tidak menyimpannya.
            if (!line.content.trim()) continue;
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
            void loadSuggestions(convId);
          }
        }
      }
    } catch (err) {
      if (sessionRef.current !== mySession) {
        // Sesi lama (pengguna menekan "chat baru") — abaikan.
      } else if (!controller.signal.aborted) {
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
      if (sessionRef.current === mySession) {
        setStreamText(null);
        abortRef.current = null;
        runIdRef.current = null;
      }
    }
  }

  async function loadSuggestions(convId: string) {
    try {
      const res = await fetch("/api/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: convId }),
      });
      const data = (await res.json()) as { suggestions?: string[] };
      setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
    } catch {
      /* saran opsional */
    }
  }

  function toggleMic() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "id-ID";
    rec.continuous = true;
    rec.interimResults = true;
    let base = draft;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let interim = "";
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript as string;
        if (e.results[i].isFinal) final += t;
        else interim += t;
      }
      if (final) base = `${base} ${final}`.trim();
      setDraft(`${base} ${interim}`.trim());
    };
    rec.onend = () => {
      setListening(false);
      recognitionRef.current = null;
    };
    rec.onerror = () => setListening(false);
    recognitionRef.current = rec;
    rec.start();
    setListening(true);
  }

  function openCanvas(raw: string) {
    setCanvas({ open: true, content: extractArtifact(raw) });
    setCanvasInstruction("");
  }

  function stop() {
    // Batalkan di server dulu — menutup koneksi saja tidak lagi menghentikan
    // generasi (agar pindah halaman/tab tidak memotong jawaban).
    const runId = runIdRef.current;
    if (runId) {
      void fetch("/api/chat/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
    }
    abortRef.current?.abort();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <div
      className="relative flex h-full flex-col"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(false);
        addFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-40 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-accent-a/70 bg-bg/80 backdrop-blur">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-accent-a">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
          </svg>
          <p className="text-sm font-medium text-ink">Lepaskan berkas di sini</p>
          <p className="text-xs text-muted">Gambar, PDF, Word, Excel, kode — maks {MAX_FILES} berkas · {MAX_UPLOAD_MB} MB/berkas</p>
        </div>
      )}
      <div className="flex shrink-0 items-center justify-end border-b border-line/70 bg-panel/40 px-4 py-2 backdrop-blur">
        <ModelPicker value={model} onChange={setModel} disabled={streaming} />
      </div>

      <div
        onScroll={(e) => {
          const el = e.currentTarget;
          const sisa = el.scrollHeight - el.scrollTop - el.clientHeight;
          setStickToBottom(sisa < 80);
        }}
        className="flex-1 overflow-y-auto"
      >
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
                onCanvas={openCanvas}
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
            {!streaming && suggestions.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => void send(s)}
                    className="rounded-full border border-line bg-panel-2 px-3 py-1.5 text-left text-xs text-muted hover:border-accent-a/60 hover:text-ink"
                  >
                    {s}
                  </button>
                ))}
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

      <div className="relative border-t border-line bg-panel/60 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        {!stickToBottom && (
          <button
            onClick={() => {
              setStickToBottom(true);
              bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
            }}
            className="absolute -top-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-panel-solid px-3 py-1.5 text-xs text-muted shadow-xl hover:border-accent-a/60 hover:text-ink"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M19 12l-7 7-7-7" />
            </svg>
            Ke pesan terbaru
          </button>
        )}
        {notice && (
          <div className="mx-auto mb-2 flex w-full max-w-3xl items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <span className="mt-0.5">⚠️</span>
            <span className="flex-1">{notice}</span>
            <button
              onClick={() => setNotice(null)}
              className="text-amber-200/70 hover:text-amber-100"
              aria-label="Tutup peringatan"
            >
              ×
            </button>
          </div>
        )}
        {uploading && uploadPct !== null && (
          <div className="mx-auto mb-2 w-full max-w-3xl">
            <div className="mb-1 flex justify-between text-[11px] text-muted">
              <span>Mengunggah…</span>
              <span>{uploadPct}%</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
              <div
                className="h-full rounded-full bg-accent-a transition-all"
                style={{ width: `${uploadPct}%` }}
              />
            </div>
          </div>
        )}
        {(attachments.length > 0 || webSearch || parafrase || agentMode) && (
          <div className="mx-auto mb-2 flex w-full max-w-3xl flex-wrap items-center gap-1.5">
            {parafrase && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-accent-b/50 bg-accent-b/10 px-2 py-1 text-xs text-accent-b">
                Parafrase
                <select
                  value={parafrase}
                  onChange={(e) => setParafrase(e.target.value as ModeParafrase)}
                  className="rounded border border-accent-b/40 bg-bg px-1 py-0.5 text-[11px] text-ink outline-none"
                >
                  {Object.entries(MODE_PARAFRASE).map(([nilai, label]) => (
                    <option key={nilai} value={nilai}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setParafrase(null)}
                  className="hover:text-ink"
                  aria-label="Matikan parafrase"
                >
                  ×
                </button>
              </span>
            )}
            {webSearch && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-accent-a/50 bg-accent-a/10 px-2 py-1 text-xs text-accent-a">
                Cari web aktif
                <button
                  onClick={() => setWebSearch(false)}
                  className="hover:text-ink"
                  aria-label="Matikan cari web"
                >
                  ×
                </button>
              </span>
            )}
            {agentMode && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-accent-b/50 bg-accent-b/10 px-2 py-1 text-xs text-accent-b">
                Agent aktif
                <button
                  onClick={() => setAgentMode(false)}
                  className="hover:text-ink"
                  aria-label="Matikan agent"
                >
                  ×
                </button>
              </span>
            )}
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
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
          <div className="relative shrink-0" data-plus-root>
            <button
              onClick={() => setPlusOpen((v) => !v)}
              disabled={streaming || uploading}
              title="Tambah berkas & alat"
              aria-label="Tambah berkas & alat"
              className={`flex h-10 w-10 items-center justify-center rounded-xl border text-muted disabled:opacity-40 ${
                plusOpen || webSearch
                  ? "border-accent-a/70 bg-accent-a/10 text-accent-a"
                  : "border-line bg-panel-2 hover:border-accent-b/60 hover:text-ink"
              }`}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>

            {plusOpen && (
              <div className="absolute bottom-12 left-0 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-panel-solid p-1.5 shadow-2xl">
                <PlusItem
                  title="Tambah foto & file"
                  desc="Unggah dari perangkat, atau tempel & seret ke sini"
                  onClick={() => {
                    setPlusOpen(false);
                    fileInputRef.current?.click();
                  }}
                  icon={
                    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  }
                />
                <PlusItem
                  title="Buat gambar"
                  desc={imageModelId ? "Ubah teks jadi gambar" : "Studio gambar tidak tersedia untuk akunmu"}
                  disabled={!imageModelId}
                  onClick={() => {
                    if (!imageModelId) return;
                    setModel(imageModelId);
                    setPlusOpen(false);
                    textareaRef.current?.focus();
                  }}
                  icon={
                    <>
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="m21 15-5-5L5 21" />
                    </>
                  }
                />
                <PlusItem
                  title="Agent"
                  desc={agentMode ? "Aktif — model pakai web/kode beruntun" : "Model memilih alat (web/kode) sendiri"}
                  active={agentMode}
                  onClick={() => {
                    setAgentMode((v) => !v);
                    setPlusOpen(false);
                  }}
                  icon={
                    <>
                      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                      <circle cx="12" cy="12" r="3" />
                    </>
                  }
                />
                <PlusItem
                  title="Parafrase"
                  desc={
                    parafrase
                      ? `Aktif — mode ${MODE_PARAFRASE[parafrase]}`
                      : "Tulis ulang teks: alur & struktur dirombak"
                  }
                  active={parafrase !== null}
                  onClick={() => {
                    setParafrase((v) => (v ? null : "akademik"));
                    setPlusOpen(false);
                    textareaRef.current?.focus();
                  }}
                  icon={
                    <>
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </>
                  }
                />
                <PlusItem
                  title="Cari web"
                  desc={webSearch ? "Aktif — jawaban memakai hasil pencarian" : "Info & berita terkini"}
                  active={webSearch}
                  onClick={() => {
                    setWebSearch((v) => !v);
                    setPlusOpen(false);
                  }}
                  icon={
                    <>
                      <circle cx="12" cy="12" r="10" />
                      <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </>
                  }
                />
              </div>
            )}
          </div>
          <div className="flex min-h-10 min-w-0 flex-1 items-end rounded-xl border border-line bg-panel-2 focus-within:border-accent-b/60">
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
              className="max-h-52 w-full resize-none bg-transparent px-3 py-2.5 text-base outline-none placeholder:text-muted md:text-sm"
            />
          </div>
          {sttOk && !streaming && (
            <button
              onClick={toggleMic}
              title={listening ? "Berhenti merekam" : "Bicara (suara jadi teks)"}
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${
                listening
                  ? "animate-pulse border-accent-a/70 bg-accent-a/10 text-accent-a"
                  : "border-line bg-panel-2 text-muted hover:text-ink"
              }`}
            >
              🎤
            </button>
          )}
          {streaming ? (
            <button
              onClick={stop}
              title="Batalkan jawaban"
              className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-red-500/50 bg-red-500/10 px-4 text-sm font-medium text-red-300 hover:bg-red-500/20"
            >
              <span className="inline-block h-3 w-3 rounded-[2px] bg-red-400" />
              Stop
            </button>
          ) : (
            <button
              onClick={() => void send()}
              disabled={(!draft.trim() && attachments.length === 0) || uploading}
              className="h-10 shrink-0 rounded-xl bg-gradient-to-r from-accent-a to-accent-b px-4 text-sm font-semibold text-black disabled:opacity-40"
            >
              {uploading ? "Mengunggah…" : "Kirim"}
            </button>
          )}
        </div>
        <p className="mx-auto mt-1.5 w-full max-w-3xl text-center text-[10px] text-muted">
          Setiap pesan tersimpan permanen sebelum model dijalankan (write-first).
        </p>
      </div>
      {canvas.open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setCanvas((c) => ({ ...c, open: false }))}
          />
          <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col border-l border-line bg-panel-solid shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">Canvas</h2>
              <button
                onClick={() => setCanvas((c) => ({ ...c, open: false }))}
                className="text-muted hover:text-ink"
                aria-label="Tutup Canvas"
              >
                ✕
              </button>
            </div>
            <CanvasEditor
              value={canvas.content}
              onChange={(v) => setCanvas((c) => ({ ...c, content: v }))}
            />
            <div className="space-y-2 border-t border-line p-3">
              <input
                value={canvasInstruction}
                onChange={(e) => setCanvasInstruction(e.target.value)}
                placeholder="Minta AI merevisi (mis. tambahkan komentar, perbaiki bug)…"
                className="w-full rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm outline-none focus:border-accent-b/60"
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    const instr = canvasInstruction.trim() || "Perbaiki/lanjutkan dokumen berikut.";
                    void send(`${instr}\n\n\`\`\`\n${canvas.content}\n\`\`\``);
                    setCanvas((c) => ({ ...c, open: false }));
                  }}
                  disabled={streaming}
                  className="flex-1 rounded-xl bg-gradient-to-r from-accent-a to-accent-b px-3 py-2 text-sm font-semibold text-black disabled:opacity-40"
                >
                  Kirim revisi ke AI
                </button>
                <button
                  onClick={() => void navigator.clipboard?.writeText(canvas.content).catch(() => {})}
                  className="rounded-xl border border-line px-3 py-2 text-sm text-muted hover:text-ink"
                >
                  Salin
                </button>
                <button
                  onClick={() => {
                    const blob = new Blob([canvas.content], { type: "text/plain" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = "canvas.txt";
                    a.click();
                    URL.revokeObjectURL(a.href);
                  }}
                  className="rounded-xl border border-line px-3 py-2 text-sm text-muted hover:text-ink"
                >
                  Unduh
                </button>
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

/** Satu baris di menu "+" (tambah berkas, buat gambar, cari web). */
function PlusItem({
  title,
  desc,
  icon,
  onClick,
  active,
  disabled,
}: {
  title: string;
  desc: string;
  icon: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left ${
        disabled ? "cursor-not-allowed opacity-45" : "hover:bg-panel-2"
      }`}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
          active ? "border-accent-a/60 bg-accent-a/10 text-accent-a" : "border-line text-muted"
        }`}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {icon}
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">{title}</span>
        <span className="block truncate text-[11px] text-muted">{desc}</span>
      </span>
      {active && <span className="text-accent-a">✓</span>}
    </button>
  );
}

function EmptyState({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 px-4">
      <h1 className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-192.png" alt="" className="h-12 w-12 rounded-xl" />
        <span className="wordmark text-4xl font-black tracking-widest">CALYZR.AI</span>
      </h1>
      <p className="max-w-md text-center text-sm text-muted">
        Satu ruang kerja untuk semua AI terbaik — chat, gambar, video, dan musik.
        Pilih model dari tombol di pojok kanan atas.
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

/** Ambil artifact (blok kode pertama) dari pesan; bila tak ada, pakai seluruh teks. */
function extractArtifact(md: string): string {
  const m = md.match(/```[\w-]*\n([\s\S]*?)```/);
  return (m ? m[1] : md).trim();
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
  onCanvas,
}: {
  message: ChatMessage;
  isLastAssistant?: boolean;
  isLastUser?: boolean;
  onRegenerate?: () => void;
  onEdit?: (text: string) => void;
  onCanvas?: (content: string) => void;
}) {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [ttsOk, setTtsOk] = useState(false);
  // Pesan user dengan lampiran berisi markdown gambar/link -> render markdown
  // supaya lampiran tampil; teks murni tetap plain (tanpa formatting tak sengaja).
  const hasAttachment = isUser && message.content.includes("](/api/files/");

  async function copy() {
    await navigator.clipboard.writeText(message.content).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  useEffect(() => setTtsOk("speechSynthesis" in window), []);

  function speak() {
    if (!("speechSynthesis" in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const plain = message.content
      .replace(/```[\s\S]*?```/g, " (blok kode) ")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[#*_>|]/g, "")
      .slice(0, 4000);
    const u = new SpeechSynthesisUtterance(plain);
    u.lang = "id-ID";
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    setSpeaking(true);
  }

  return (
    <div
      className={`group text-sm leading-relaxed ${
        isUser ? "flex flex-col items-end" : ""
      }`}
    >
      <RoleTag role={message.role} />
      <div
        className={`mt-1 ${
          isUser
            ? "max-w-[85%] rounded-2xl rounded-tr-sm border border-line bg-panel-2 px-4 py-3"
            : ""
        }`}
      >
        {isUser && !hasAttachment ? (
          <p className="whitespace-pre-wrap break-words">{message.content}</p>
        ) : (
          <Markdown>{message.content}</Markdown>
        )}
      </div>
      {/* Aksi kecil ala ChatGPT: salin / regenerate / edit */}
      <div
        className={`mt-1 flex gap-3 opacity-0 transition-opacity group-hover:opacity-100 max-md:gap-4 max-md:py-1 max-md:opacity-100 ${
          isUser ? "justify-end" : ""
        }`}
      >
        <button
          onClick={() => void copy()}
          className="text-[11px] text-muted hover:text-ink"
          title="Salin isi pesan"
        >
          {copied ? "Tersalin ✓" : "Salin"}
        </button>
        {!isUser && ttsOk && (
          <button
            onClick={speak}
            className="text-[11px] text-muted hover:text-accent-a"
            title="Bacakan jawaban"
          >
            {speaking ? "■ Stop" : "🔊 Bacakan"}
          </button>
        )}
        {!isUser && onCanvas && (
          <button
            onClick={() => onCanvas(message.content)}
            className="text-[11px] text-muted hover:text-accent-a"
            title="Buka di Canvas untuk diedit"
          >
            ✎ Canvas
          </button>
        )}
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
