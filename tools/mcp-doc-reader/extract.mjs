// Ekstraksi teks dokumen (selaras dengan CALYZR src/server/extract.ts).
// Dipakai oleh MCP server agar Continue bisa membaca docx/pdf/xlsx/pptx/teks
// LANGSUNG di mesin pengguna (tempat berkasnya berada).
import JSZip from "jszip";

const MAX_CHARS = Number(process.env.DOC_MAX_CHARS) || 200_000;

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

async function fromDocx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const doc = zip.file("word/document.xml");
  if (!doc) return "";
  const xml = await doc.async("string");
  return xml
    .split(/<\/w:p>/)
    .map((p) => xmlTexts(p, "w:t").join(""))
    .filter((l) => l.trim())
    .join("\n");
}

async function fromPptx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const parts = [];
  for (const n of slides) {
    const xml = await zip.files[n].async("string");
    const t = xmlTexts(xml, "a:t").filter((x) => x.trim());
    if (t.length) parts.push(`[Slide ${n.match(/\d+/)[0]}]\n${t.join("\n")}`);
  }
  return parts.join("\n\n");
}

async function fromXlsx(buf) {
  const zip = await JSZip.loadAsync(buf);
  const shared = [];
  const ss = zip.file("xl/sharedStrings.xml");
  if (ss) {
    const xml = await ss.async("string");
    for (const si of xml.split(/<\/si>/)) if (si.includes("<si")) shared.push(xmlTexts(si, "t").join(""));
  }
  const sheets = Object.keys(zip.files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const parts = [];
  for (const sheet of sheets) {
    const xml = await zip.files[sheet].async("string");
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

async function fromPdf(buf) {
  // Import lib internal langsung (index pdf-parse punya kode debug path-relatif).
  const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");
  const out = await pdfParse(buf);
  return out.text;
}

const fileExt = (name) => (name.split(".").pop() || "").toLowerCase();

/** Ekstrak teks dari buffer berkas berdasarkan ekstensinya. */
export async function extractText(buf, name) {
  const e = fileExt(name);
  let text = null;
  if (e === "pdf") text = await fromPdf(buf);
  else if (e === "docx") text = await fromDocx(buf);
  else if (e === "pptx") text = await fromPptx(buf);
  else if (e === "xlsx") text = await fromXlsx(buf);
  else if (e === "doc" || e === "ppt" || e === "xls")
    return "(Format Office lama .doc/.ppt/.xls tidak didukung — simpan ulang sebagai .docx/.pptx/.xlsx.)";
  else text = buf.toString("utf8"); // teks/kode/csv/json/md/yaml/dll
  if (text == null) return "(Tidak dapat diekstrak sebagai teks.)";
  text = text.replace(/\u0000/g, "").trim();
  if (!text) return "(Kosong / tidak ada teks yang bisa diekstrak.)";
  return text.length > MAX_CHARS
    ? `${text.slice(0, MAX_CHARS)}\n…(terpotong, total ${text.length} karakter)`
    : text;
}
