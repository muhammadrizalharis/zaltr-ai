import JSZip from "jszip";

/**
 * Ekstraksi teks lampiran chat (README: lampiran ikut dibaca model).
 * Didukung: teks/kode apa adanya, PDF (pdf-parse), DOCX/PPTX/XLSX
 * (Office OpenXML = zip berisi XML; teks diambil dari tag <w:t>/<a:t>/<t>).
 * Selain itu (arsip, biner, dsb) -> null (hanya metadata yang dikirim ke model).
 */

const MAX_CHARS_PER_FILE = 15_000;

const TEXT_EXT = new Set([
  "txt", "md", "markdown", "csv", "tsv", "json", "jsonl", "xml", "yaml", "yml",
  "html", "htm", "css", "js", "jsx", "ts", "tsx", "py", "ipynb", "java", "c",
  "h", "cpp", "hpp", "cs", "go", "rs", "rb", "php", "sh", "bash", "sql", "r",
  "swift", "kt", "scala", "toml", "ini", "cfg", "conf", "env", "log", "tex",
]);

export const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "avif"]);

export function fileExt(name: string): string {
  return (name.split(".").pop() ?? "").toLowerCase();
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

/**
 * Ekstrak teks dari buffer file. Return null bila jenis tidak didukung
 * (biner umum) — pemanggil cukup menyebut metadata file ke model.
 */
export async function extractText(buf: Buffer, name: string): Promise<string | null> {
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
    } else if (TEXT_EXT.has(ext) || looksLikeText(buf)) {
      text = buf.toString("utf8");
    }
    if (text == null) return null;
    const clean = text.replace(/\u0000/g, "").trim();
    if (!clean) return null;
    return clean.length > MAX_CHARS_PER_FILE
      ? `${clean.slice(0, MAX_CHARS_PER_FILE)}\n…(terpotong, total ${clean.length} karakter)`
      : clean;
  } catch {
    return null;
  }
}
