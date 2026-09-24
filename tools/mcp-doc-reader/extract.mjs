// Ekstraksi dokumen TANPA dependency (murni Node.js bawaan).
//   docx/xlsx/pptx = OpenXML (ZIP berisi XML) -> dibaca via zlib bawaan.
//   pdf -> via 'pdftotext' (poppler) sistem, opsional.
//   lainnya (txt/csv/kode/json/md/…) -> teks apa adanya.
import { inflateRawSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const MAX_CHARS = Number(process.env.DOC_MAX_CHARS) || 200_000;

// ---------- Pembaca ZIP minimal (hanya stored=0 & deflate=8, non-ZIP64) ----------
function unzip(buf, want) {
  const files = new Map();
  const min = Math.max(0, buf.length - 22 - 65535);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; } // End Of Central Directory
  }
  if (eocd < 0) return files;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break; // Central Directory header
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (want && !want(name)) continue;
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) continue; // Local File header
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(start, start + compSize);
    let data;
    try {
      if (method === 0) data = comp;
      else if (method === 8) data = inflateRawSync(comp);
      else continue;
    } catch {
      continue;
    }
    files.set(name, data);
  }
  return files;
}

// ---------- Bantu XML ----------
function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}
function xmlTexts(xml, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(decodeXmlEntities(m[1]));
  return out;
}

// ---------- Per-format ----------
function fromDocx(buf) {
  const doc = unzip(buf, (n) => n === "word/document.xml").get("word/document.xml");
  if (!doc) return "";
  return doc
    .toString("utf8")
    .split(/<\/w:p>/)
    .map((p) => xmlTexts(p, "w:t").join(""))
    .filter((l) => l.trim())
    .join("\n");
}

function fromPptx(buf) {
  const map = unzip(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const names = [...map.keys()].sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const parts = [];
  for (const n of names) {
    const t = xmlTexts(map.get(n).toString("utf8"), "a:t").filter((x) => x.trim());
    if (t.length) parts.push(`[Slide ${n.match(/\d+/)[0]}]\n${t.join("\n")}`);
  }
  return parts.join("\n\n");
}

function fromXlsx(buf) {
  const map = unzip(buf, (n) => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const shared = [];
  const ss = map.get("xl/sharedStrings.xml");
  if (ss) {
    const xml = ss.toString("utf8");
    for (const si of xml.split(/<\/si>/)) if (si.includes("<si")) shared.push(xmlTexts(si, "t").join(""));
  }
  const sheets = [...map.keys()]
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const parts = [];
  for (const sheet of sheets) {
    const xml = map.get(sheet).toString("utf8");
    const rows = [];
    for (const rowXml of xml.split(/<\/row>/)) {
      if (!rowXml.includes("<c")) continue;
      const cells = [];
      const cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
      let m;
      while ((m = cellRe.exec(rowXml)) !== null) {
        const type = /t="([^"]+)"/.exec(m[1])?.[1];
        if (type === "s") cells.push(shared[Number(xmlTexts(m[2], "v")[0] ?? "")] ?? "");
        else if (type === "inlineStr") cells.push(xmlTexts(m[2], "t").join(""));
        else cells.push(decodeXmlEntities(xmlTexts(m[2], "v")[0] ?? ""));
      }
      rows.push(cells.join("\t"));
      if (rows.length >= 1000) break;
    }
    if (rows.length) {
      const label = sheets.length > 1 ? `[Sheet ${sheet.match(/\d+/)[0]}]\n` : "";
      parts.push(label + rows.join("\n"));
    }
  }
  return parts.join("\n\n") || shared.join("\n");
}

function fromPdf(buf) {
  // 'pdftotext' (poppler) = tool sistem, BUKAN dependency npm. Dijalankan tanpa shell.
  const tmp = join(tmpdir(), `calyzr-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  try {
    writeFileSync(tmp, buf);
    return execFileSync("pdftotext", ["-q", "-enc", "UTF-8", tmp, "-"], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  } catch (e) {
    if (e && e.code === "ENOENT")
      return "(PDF perlu 'pdftotext'. Pasang poppler — Linux: sudo apt install poppler-utils · macOS: brew install poppler · Windows: choco install poppler.)";
    return `(Gagal baca PDF: ${String((e && e.message) || e).slice(0, 140)})`;
  } finally {
    try { unlinkSync(tmp); } catch { /* abaikan */ }
  }
}

const fileExt = (name) => (name.split(".").pop() || "").toLowerCase();

/** Ekstrak teks dari buffer berkas berdasarkan ekstensinya. */
export async function extractText(buf, name) {
  const e = fileExt(name);
  let text = null;
  if (e === "pdf") text = fromPdf(buf);
  else if (e === "docx") text = fromDocx(buf);
  else if (e === "pptx") text = fromPptx(buf);
  else if (e === "xlsx") text = fromXlsx(buf);
  else if (e === "doc" || e === "ppt" || e === "xls")
    return "(Format Office lama .doc/.ppt/.xls tidak didukung — simpan ulang sebagai .docx/.pptx/.xlsx.)";
  else text = buf.toString("utf8");
  if (text == null) return "(Tidak dapat diekstrak sebagai teks.)";
  text = text.replace(/\u0000/g, "").trim();
  if (!text) return "(Kosong / tidak ada teks yang bisa diekstrak.)";
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…(terpotong, total ${text.length} karakter)` : text;
}
