"use client";

import { useEffect, useState } from "react";
import { MERMAID_MAX_CHARS, diagramFileName, pngScale, svgSize } from "./mermaid-utils";

/** Tema aplikasi saat ini (data-theme="light" di <html>); ikut berubah saat tombol tema ditekan. */
function useIsLight(): boolean {
  const [light, setLight] = useState(false);
  useEffect(() => {
    const read = () => setLight(document.documentElement.getAttribute("data-theme") === "light");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return light;
}

// mermaid.render tidak aman dijalankan bersamaan: antrekan semua render.
let queue: Promise<unknown> = Promise.resolve();
let seq = 0;

async function renderSvg(code: string, light: boolean): Promise<string> {
  const run = async () => {
    const mermaid = (await import("mermaid")).default;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict", // keluaran model tak tepercaya: tanpa skrip/klik/HTML bebas
      theme: light ? "default" : "dark",
      fontFamily: "inherit",
      htmlLabels: false, // label SVG murni -> bisa diekspor ke PNG tanpa foreignObject
      flowchart: { htmlLabels: false },
    });
    if (!(await mermaid.parse(code, { suppressErrors: true }))) throw new Error("sintaks diagram tidak valid");
    const id = `mmd-${++seq}`;
    try {
      const { svg } = await mermaid.render(id, code);
      return svg;
    } finally {
      document.getElementById(`d${id}`)?.remove(); // sisa elemen sementara mermaid
      document.getElementById(id)?.remove();
    }
  };
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function svgToPng(svg: string): Promise<Blob> {
  const size = svgSize(svg) ?? { w: 800, h: 450 };
  const scale = pngScale(size.w);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(size.w * scale);
  canvas.height = Math.round(size.h * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; // latar putih: siap ditempel ke Word/PDF
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("gagal membuat PNG"))), "image/png"));
}

/**
 * Blok ```mermaid```: dirender jadi diagram/grafik (xychart, flowchart, sequence, dll). Saat jawaban masih
 * mengalir (kode belum utuh) render ditunda 500 ms setelah perubahan terakhir sehingga tak berkedip;
 * bila sintaks tak valid, kode asli tetap ditampilkan (`fallback`) beserta keterangan singkat.
 */
export function MermaidBlock({
  code,
  fallback,
  onCopy,
  copied,
}: {
  code: string;
  fallback: React.ReactNode;
  onCopy: () => void;
  copied: boolean;
}) {
  const light = useIsLight();
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const tooLong = code.length > MERMAID_MAX_CHARS;

  useEffect(() => {
    if (tooLong) return;
    let cancelled = false;
    const t = setTimeout(() => {
      renderSvg(code.trim(), light).then(
        (s) => {
          if (cancelled) return;
          setSvg(s);
          setError(null);
        },
        (e: unknown) => {
          if (cancelled) return;
          setSvg(null);
          setError(e instanceof Error ? e.message : "gagal merender diagram");
        },
      );
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [code, light, tooLong]);

  async function exportAs(kind: "svg" | "png") {
    setBusy(true);
    try {
      // Ekspor selalu memakai tema terang (latar putih) agar terbaca di dokumen, apa pun tema aplikasi.
      const exportSvg = light && svg ? svg : await renderSvg(code.trim(), true);
      const name = diagramFileName(code);
      if (kind === "svg") download(new Blob([exportSvg], { type: "image/svg+xml" }), `${name}.svg`);
      else download(await svgToPng(exportSvg), `${name}.png`);
    } catch {
      setError("gagal mengekspor diagram");
    } finally {
      setBusy(false);
    }
  }

  const failed = tooLong || (error !== null && svg === null);
  const btn = "rounded-md border border-line bg-panel px-2 py-0.5 text-[11px] text-muted hover:text-ink disabled:opacity-50";

  return (
    <div className="group relative mb-3">
      <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 max-md:opacity-100">
        {!failed && (
          <>
            <button onClick={() => setShowCode((v) => !v)} className={btn}>
              {showCode ? "Diagram" : "Kode"}
            </button>
            <button onClick={() => void exportAs("png")} disabled={busy || svg === null} className={btn}>
              PNG
            </button>
            <button onClick={() => void exportAs("svg")} disabled={busy || svg === null} className={btn}>
              SVG
            </button>
          </>
        )}
        <button onClick={onCopy} className={btn}>
          {copied ? "Tersalin ✓" : "Salin"}
        </button>
      </div>
      {failed || showCode ? (
        <>
          {fallback}
          {failed && (
            <p className="mt-1 text-[11px] text-muted">
              {tooLong ? "Diagram terlalu besar untuk ditampilkan — menampilkan kode." : `Diagram tak bisa dirender (${error}) — menampilkan kode.`}
            </p>
          )}
        </>
      ) : svg ? (
        <div
          className="mermaid-diagram overflow-x-auto rounded-xl border border-line bg-panel-2 p-3 [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          // svg dibersihkan mermaid (securityLevel: strict, DOMPurify) sebelum sampai sini
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="rounded-xl border border-line bg-panel-2 p-4 text-xs text-muted">Menyusun diagram…</div>
      )}
    </div>
  );
}
