/** Fungsi murni untuk blok diagram Mermaid (diuji terpisah dari komponen React). */

/** Batas ukuran kode diagram yang dirender (mencegah render berat dari keluaran model yang sangat panjang). */
export const MERMAID_MAX_CHARS = 20_000;

export function isMermaidClass(cls?: string): boolean {
  return /language-mermaid\b/.test(cls ?? "");
}

/** Ukuran SVG dari viewBox (utama) atau atribut width/height; null bila tak bisa ditentukan. */
export function svgSize(svg: string): { w: number; h: number } | null {
  const vb = /viewBox\s*=\s*"\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/i.exec(svg);
  if (vb) {
    const w = Number(vb[1]);
    const h = Number(vb[2]);
    if (w > 0 && h > 0) return { w, h };
  }
  const w = /<svg[^>]*\swidth\s*=\s*"([\d.]+)(?:px)?"/i.exec(svg)?.[1];
  const h = /<svg[^>]*\sheight\s*=\s*"([\d.]+)(?:px)?"/i.exec(svg)?.[1];
  return w && h && Number(w) > 0 && Number(h) > 0 ? { w: Number(w), h: Number(h) } : null;
}

/** Skala ekspor PNG: lebar hasil minimal ±1600px (tajam untuk dokumen) tetapi tak melebihi 4x dan 6000px. */
export function pngScale(width: number): number {
  const scale = Math.min(4, Math.max(1, 1600 / width));
  return Math.min(scale, 6000 / width);
}

/** Nama berkas unduhan dari judul diagram (title "..." / title: ...), tanpa karakter bermasalah. */
export function diagramFileName(code: string): string {
  const m = /\btitle\s*:?\s*"?([^"\n]+)"?/i.exec(code); // "title X", `title "X"`, `title: X`, dan `pie title X`
  const slug = (m?.[1] ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "diagram";
}
