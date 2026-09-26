"use client";

import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

// Model kadang menulis math dengan \[..\] / \(..\); samakan ke $$..$$ / $..$ agar
// remark-math + KaTeX merendernya jadi rumus typeset (seperti Word/Gemini).
function normalizeMath(s: string): string {
  return s
    .replace(/\\\[/g, () => "$$")
    .replace(/\\\]/g, () => "$$")
    .replace(/\\\(/g, () => "$")
    .replace(/\\\)/g, () => "$");
}

// Di-memo: tiap ketikan di composer me-render ulang ChatView; tanpa memo SEMUA
// pesan mem-parse ulang markdown + KaTeX (berat) -> lag di percakapan panjang.
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
      components={{
        h1: (p) => <h1 className="mb-2 mt-4 text-xl font-bold" {...p} />,
        h2: (p) => <h2 className="mb-2 mt-4 text-lg font-bold" {...p} />,
        h3: (p) => <h3 className="mb-1 mt-3 text-base font-semibold" {...p} />,
        p: (p) => <p className="mb-3 break-words leading-relaxed last:mb-0" {...p} />,
        ul: (p) => <ul className="mb-3 list-disc space-y-1 pl-5" {...p} />,
        ol: (p) => <ol className="mb-3 list-decimal space-y-1 pl-5" {...p} />,
        blockquote: (p) => (
          <blockquote
            className="mb-3 border-l-2 border-accent-b/60 pl-3 text-muted"
            {...p}
          />
        ),
        a: (p) => (
          <a
            className="break-all text-accent-a underline underline-offset-2"
            target="_blank"
            {...p}
          />
        ),
        img: ({ src, alt }) => {
          // Hasil ComfyUI / lampiran — dilayani dari MinIO via /api/files.
          // Provider media mengirim semua hasil sebagai markdown image;
          // ekstensi menentukan render <video>/<audio>/<img>.
          const url = typeof src === "string" ? src : undefined;
          const ext = url?.split(".").pop()?.toLowerCase() ?? "";
          if (["mp4", "webm", "mov"].includes(ext)) {
            return (
              <video
                src={url}
                controls
                loop
                playsInline
                className="mb-3 max-h-[480px] w-auto max-w-full rounded-xl border border-line"
              />
            );
          }
          if (["mp3", "wav", "flac", "opus", "ogg", "m4a"].includes(ext)) {
            return <audio src={url} controls className="mb-3 w-full max-w-md" />;
          }
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={alt ?? ""}
              loading="lazy"
              className="mb-3 max-h-[480px] w-auto max-w-full rounded-xl border border-line"
            />
          );
        },
        table: (p) => (
          <div className="mb-3 overflow-x-auto">
            <table className="w-full border-collapse text-sm" {...p} />
          </div>
        ),
        th: (p) => <th className="border border-line bg-panel-2 px-2 py-1 text-left" {...p} />,
        td: (p) => <td className="border border-line px-2 py-1" {...p} />,
        code: ({ className, children, ...rest }) => {
          const isBlock = /language-/.test(className ?? "");
          return isBlock ? (
            <code className={`${className} block`} {...rest}>
              {children}
            </code>
          ) : (
            <code
              className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[0.85em] text-accent-a"
              {...rest}
            >
              {children}
            </code>
          );
        },
        pre: ({ children, ...p }) => <CodeBlock {...p}>{children}</CodeBlock>,
      }}
    >
      {normalizeMath(children)}
    </ReactMarkdown>
  );
});

/** Ambil teks mentah dari children React (untuk salin/eksekusi kode). */
function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node && typeof node === "object" && "props" in node) {
    return extractText((node as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
}

function isPythonBlock(node: React.ReactNode): boolean {
  if (node && typeof node === "object" && "props" in node) {
    const cls =
      (node as { props: { className?: string } }).props.className ?? "";
    return /language-(python|py)\b/.test(cls);
  }
  return false;
}

/** Blok yang bisa dipratinjau langsung (artifact) di iframe ter-sandbox. */
function isPreviewBlock(node: React.ReactNode): boolean {
  if (node && typeof node === "object" && "props" in node) {
    const cls = (node as { props: { className?: string } }).props.className ?? "";
    return /language-(html|htm|svg|xml)\b/.test(cls);
  }
  return false;
}

/**
 * Blok kode dengan tombol Salin; khusus Python ada tombol Jalankan
 * (code interpreter — dieksekusi di container runner terisolasi).
 */
function CodeBlock({ children, ...rest }: React.HTMLAttributes<HTMLPreElement>) {
  const [copied, setCopied] = useState(false);
  const [running, setRunning] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [result, setResult] = useState<{
    stdout: string;
    stderr: string;
    exitCode: number;
    timeMs: number;
  } | null>(null);

  const inner = children as React.ReactNode;
  const python = isPythonBlock(Array.isArray(inner) ? inner[0] : inner);
  const previewable = isPreviewBlock(Array.isArray(inner) ? inner[0] : inner);

  async function copy() {
    await navigator.clipboard.writeText(extractText(inner)).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function run() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: extractText(inner) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
      setResult(data);
    } catch (err) {
      setResult({
        stdout: "",
        stderr: err instanceof Error ? err.message : "Gagal menjalankan",
        exitCode: -1,
        timeMs: 0,
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="group relative mb-3">
      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
        {python && (
          <button
            onClick={() => void run()}
            disabled={running}
            className="rounded-md border border-line bg-panel px-2 py-0.5 text-[11px] text-muted hover:text-accent-a disabled:opacity-50"
          >
            {running ? "Menjalankan…" : "▶ Jalankan"}
          </button>
        )}
        {previewable && (
          <button
            onClick={() => setShowPreview((v) => !v)}
            className="rounded-md border border-line bg-panel px-2 py-0.5 text-[11px] text-muted hover:text-accent-a"
          >
            {showPreview ? "✕ Tutup pratinjau" : "▶ Pratinjau"}
          </button>
        )}
        <button
          onClick={() => void copy()}
          className="rounded-md border border-line bg-panel px-2 py-0.5 text-[11px] text-muted hover:text-ink"
        >
          {copied ? "Tersalin ✓" : "Salin"}
        </button>
      </div>
      <pre
        className="overflow-x-auto rounded-xl border border-line bg-[#0d1320] p-3 font-mono text-[13px] leading-relaxed"
        {...rest}
      >
        {children}
      </pre>
      {previewable && showPreview && (
        <iframe
          title="Pratinjau artifact"
          sandbox="allow-scripts allow-popups"
          className="mt-1 h-96 w-full rounded-xl border border-line bg-white"
          srcDoc={extractText(inner)}
        />
      )}
      {result && (
        <div className="mt-1 rounded-xl border border-line bg-panel-2 p-3 font-mono text-[12px]">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-muted">
            Hasil eksekusi · exit {result.exitCode} · {result.timeMs} ms
          </p>
          {result.stdout && <pre className="whitespace-pre-wrap">{result.stdout}</pre>}
          {result.stderr && (
            <pre className="whitespace-pre-wrap text-red-400">{result.stderr}</pre>
          )}
          {!result.stdout && !result.stderr && (
            <p className="text-muted">(tanpa output)</p>
          )}
        </div>
      )}
    </div>
  );
}
