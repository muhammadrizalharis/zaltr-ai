import JSZip from "jszip";

/**
 * Ekstraksi teks lampiran chat (README: lampiran ikut dibaca model).
 * Didukung: teks/kode apa adanya, PDF (pdf-parse), DOCX/PPTX/XLSX
 * (Office OpenXML = zip berisi XML; teks diambil dari tag <w:t>/<a:t>/<t>).
 * Selain itu (arsip, biner, dsb) -> null (hanya metadata yang dikirim ke model).
 */

// Batas teks per lampiran yang dikirim ke MODEL. Bisa diubah via env
// ZALTR_MAX_FILE_CHARS. 200rb karakter ≈ 50rb token — muat di model konteks besar
// (Claude Sonnet/Opus); model konteks kecil bisa menolak bila jauh lebih besar.
export const MAX_CHARS_PER_FILE = Math.max(
  2_000,
  Number(process.env.ZALTR_MAX_FILE_CHARS) || 200_000,
);

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "xml", "yaml", "yml",
  "html", "htm", "css", "js", "jsx", "ts", "tsx", "py", "ipynb", "java", "c",
  "h", "cpp", "hpp", "cs", "go", "rs", "rb", "php", "sh", "bash", "sql", "r",
  "swift", "kt", "scala", "toml", "ini", "cfg", "conf", "env", "log", "tex",
]);

export const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"]);

/** MIME gambar untuk lampiran ke model vision (default png bila tak dikenal). */
export function imageMime(name: string): string {
  const ext = fileExt(name);
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return IMAGE_EXT.has(ext) ? `image/${ext}` : "image/png";
}

export function fileExt(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
}

const FULL_DOWNLOAD_EXT = new Set(["pdf", "docx", "pptx", "xlsx", "doc", "ppt", "xls"]);
/** Format terstruktur yang HARUS diunduh utuh untuk diparse (tak bisa dibaca sebagian). */
export function needsFullDownload(name: string): boolean {
  return FULL_DOWNLOAD_EXT.has(fileExt(name));
}

const BINARY_SKIP_EXT = new Set([
  "joblib", "pkl", "pickle", "npy", "npz", "parquet", "feather", "h5", "hdf5",
  "pt", "pth", "ckpt", "onnx", "safetensors", "bin", "model", "zip", "gz", "bz2",
  "tar", "tgz", "rar", "7z", "exe", "dll", "so", "dylib", "class", "jar", "war",
  "wav", "mp3", "flac", "ogg", "mp4", "mov", "avi", "mkv", "webm",
]);
/** Biner berat (model/arsip/media) yang tak perlu diunduh untuk dibaca sebagai teks. */
export function isBinarySkip(name: string): boolean {
  return BINARY_SKIP_EXT.has(fileExt(name));
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

/** Ambil isi tag teks OpenXML dari string XML. */
function xmlTexts(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(decodeXmlEntities(m[1]));
  return out;
}

async function fromDocx(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file("word/document.xml");
  if (!doc) return "";
  const xml = await doc.async("string");
  // Paragraf dipisah baris agar struktur dokumen terjaga.
  return xml
    .split(/<\/w:p>/)
    .map((p) => xmlTexts(p, "w:t").join(""))
    .filter((line) => line.trim())
    .join("\n");
}

async function fromPptx(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  const parts: string[] = [];
  for (const name of slides) {
    const xml = await zip.files[name].async("string");
    const texts = xmlTexts(xml, "a:t").filter((t) => t.trim());
    if (texts.length > 0) {
      parts.push(`[Slide ${name.match(/\d+/)?.[0]}]\n${texts.join("\n")}`);
    }
  }
  return parts.join("\n\n");
}

async function fromXlsx(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const shared = zip.file("xl/sharedStrings.xml");
  if (!shared) return "";
  const xml = await shared.async("string");
  return xmlTexts(xml, "t").join("\n");
}

async function fromPdf(buf: Buffer): Promise<string> {
  // Import langsung lib internal: index pdf-parse punya kode debug yang
  // membaca file uji saat dimuat di luar CommonJS parent (bug dikenal).
  const { default: pdfParse } = (await import("pdf-parse/lib/pdf-parse.js")) as {
    default: (b: Buffer) => Promise<{ text: string }>;
  };
  const out = await pdfParse(buf);
  return out.text;
}

function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, 4096);
  if (sample.includes(0)) return false;
  let printable = 0;
  for (const b of sample) {
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128) printable++;
  }
  return sample.length === 0 || printable / sample.length > 0.9;
}

function nbSource(src: unknown): string {
  return Array.isArray(src) ? src.join("") : typeof src === "string" ? src : "";
}

/** Jupyter notebook: ambil sel kode + markdown + output teks ringkas (bukan JSON mentah). */
function fromIpynb(raw: string): string {
  let nb: unknown;
  try {
    nb = JSON.parse(raw);
  } catch {
    return raw; // bukan JSON valid -> kembalikan apa adanya
  }
  const cells = (nb as { cells?: unknown[] }).cells;
  if (!Array.isArray(cells)) return raw;
  const parts: string[] = [];
  let n = 0;
  for (const cell of cells) {
    const c = cell as { cell_type?: string; source?: unknown; outputs?: unknown[] };
    const src = nbSource(c.source).trim();
    if (c.cell_type === "code") {
      n++;
      if (src) parts.push(`# ── Sel kode [${n}] ──\n${src}`);
      const outText: string[] = [];
      for (const o of Array.isArray(c.outputs) ? c.outputs : []) {
        const oo = o as {
          output_type?: string;
          text?: unknown;
          ename?: string;
          evalue?: string;
          data?: Record<string, unknown>;
        };
        if (oo.output_type === "stream") outText.push(nbSource(oo.text));
        else if (oo.output_type === "error") outText.push(`${oo.ename}: ${oo.evalue}`);
        else if (oo.data && "text/plain" in oo.data) outText.push(nbSource(oo.data["text/plain"]));
      }
      const joined = outText.join("").trim();
      if (joined) parts.push(`# Output:\n${joined.slice(0, 800)}`);
    } else if (c.cell_type === "markdown" && src) {
      parts.push(src);
    }
  }
  return parts.join("\n\n");
}

function detectSep(line: string): string {
  let best = ",";
  let bestCount = -1;
  for (const s of [",", ";", "\t", "|"]) {
    const c = line.split(s).length;
    if (c > bestCount) {
      bestCount = c;
      best = s;
    }
  }
  return best;
}

function inferColType(vals: string[]): string {
  const nonEmpty = vals.filter((v) => v !== "");
  if (nonEmpty.length === 0) return "kosong";
  const num = nonEmpty.filter((v) => /^-?\d+([.,]\d+)?$/.test(v)).length;
  if (num / nonEmpty.length > 0.8) return "angka";
  const date = nonEmpty.filter((v) => /^\d{4}-\d{2}-\d{2}|^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(v)).length;
  if (date / nonEmpty.length > 0.8) return "tanggal";
  return "teks";
}

/** CSV/TSV: ringkasan (baris, kolom, tipe) + cuplikan 20 baris — hemat konteks. */
function summarizeDelimited(
  raw: string,
  name: string,
  opts?: { partial?: boolean; sourceBytes?: number },
): string {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length === 0) return raw;
  const sep = name.toLowerCase().endsWith(".tsv") ? "\t" : detectSep(lines[0]);
  const header = lines[0].split(sep).map((c) => c.trim());
  const dataLines = lines.slice(1);
  const sample = dataLines.slice(0, 200).map((l) => l.split(sep).map((c) => c.trim()));
  const cols = header
    .map((h, i) => `${h || `kolom${i + 1}`} (${inferColType(sample.map((r) => r[i] ?? ""))})`)
    .join(", ");
  const preview = [lines[0], ...dataLines.slice(0, 20)].join("\n");
  let rowsLine: string;
  const readBytes = Buffer.byteLength(raw, "utf8");
  if (opts?.partial && opts.sourceBytes && readBytes > 0) {
    const est = Math.round((opts.sourceBytes / readBytes) * dataLines.length);
    rowsLine = `- Perkiraan TOTAL baris: ~${est.toLocaleString("id-ID")} (berkas besar; hanya bagian awal dibaca)`;
  } else {
    rowsLine = `- Perkiraan baris data: ${dataLines.length}`;
  }
  return (
    `Ringkasan tabel "${name}":\n` +
    `${rowsLine}\n` +
    `- Jumlah kolom: ${header.length}\n` +
    `- Kolom & tipe (perkiraan): ${cols}\n\n` +
    `20 baris pertama (mentah):\n${preview}`
  );
}

/**
 * Ekstrak teks dari buffer file. Return null bila jenis tidak didukung
 * (biner umum) — pemanggil cukup menyebut metadata file ke model.
 */
export async function extractText(
  buf: Buffer,
  name: string,
  limit: number = MAX_CHARS_PER_FILE,
  opts?: { partial?: boolean; sourceBytes?: number },
): Promise<string | null> {
  const ext = fileExt(name);
  try {
    let text: string | null = null;
    if (ext === "pdf") text = await fromPdf(buf);
    else if (ext === "docx") text = await fromDocx(buf);
    else if (ext === "pptx") text = await fromPptx(buf);
    else if (ext === "xlsx") text = await fromXlsx(buf);
    else if (ext === "doc" || ext === "ppt" || ext === "xls") {
      // Format Office lama (biner) tidak didukung tanpa lib berat.
      return null;
    } else if (ext === "ipynb") {
      text = fromIpynb(buf.toString("utf8"));
    } else if (ext === "csv" || ext === "tsv") {
      text = summarizeDelimited(buf.toString("utf8"), name, opts);
    } else if (TEXT_EXT.has(ext) || looksLikeText(buf)) {
      text = buf.toString("utf8");
    }
    if (text == null) return null;
    const clean = text.replace(/\u0000/g, "").trim();
    if (!clean) return null;
    return clean.length > limit
      ? `${clean.slice(0, limit)}\n…(terpotong, total ${clean.length} karakter)`
      : clean;
  } catch {
    return null;
  }
}
