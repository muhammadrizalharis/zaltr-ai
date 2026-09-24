// Uji cepat ekstraksi zero-dependency. Jalankan: node smoke.mjs
// Membuat ZIP (OpenXML) mini sendiri untuk menguji pembaca ZIP bawaan.
import { deflateRawSync } from "node:zlib";
import { extractText } from "./extract.mjs";

// Bangun ZIP minimal (stored=0 atau deflate=8). CRC diabaikan (reader tak memeriksa).
function makeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const raw = Buffer.from(e.data, "utf8");
    const comp = e.deflate ? deflateRawSync(raw) : raw;
    const method = e.deflate ? 8 : 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    const local = Buffer.concat([lh, nameBuf, comp]);
    const localOff = offset;
    locals.push(local);
    offset += local.length;
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(localOff, 42);
    central.push(Buffer.concat([ch, nameBuf]));
  }
  const localAll = Buffer.concat(locals);
  const centralAll = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralAll.length, 12);
  eocd.writeUInt32LE(localAll.length, 16);
  return Buffer.concat([localAll, centralAll, eocd]);
}

let ok = 0;
let fail = 0;
const check = (label, cond) => {
  if (cond) { ok++; console.log(`  OK  ${label}`); }
  else { fail++; console.log(`  XX  ${label}`); }
};

// docx via DEFLATE (metode nyata Office)
const docx = makeZip([
  { name: "word/document.xml", deflate: true, data: `<w:document xmlns:w="u"><w:body><w:p><w:r><w:t>Halo docx zerodep</w:t></w:r></w:p></w:body></w:document>` },
]);
check("docx (deflate) -> teks", (await extractText(docx, "a.docx")).includes("Halo docx zerodep"));

// pptx via DEFLATE
const pptx = makeZip([
  { name: "ppt/slides/slide1.xml", deflate: true, data: `<p:sld xmlns:a="u"><a:t>Halo pptx</a:t></p:sld>` },
]);
check("pptx (deflate) -> teks", (await extractText(pptx, "a.pptx")).includes("Halo pptx"));

// xlsx via STORED, dengan ANGKA
const xlsx = makeZip([
  { name: "xl/sharedStrings.xml", data: `<sst xmlns="u"><si><t>skor</t></si></sst>` },
  { name: "xl/worksheets/sheet1.xml", data: `<worksheet xmlns="u"><sheetData><row><c t="s"><v>0</v></c><c><v>97.5</v></c></row></sheetData></worksheet>` },
]);
const x = await extractText(xlsx, "a.xlsx");
check("xlsx -> teks", x.includes("skor"));
check("xlsx -> angka", x.includes("97.5"));

check("txt -> teks", (await extractText(Buffer.from("teks biasa apa adanya", "utf8"), "a.txt")).includes("teks biasa"));

console.log(`\n${ok} lolos, ${fail} gagal`);
process.exit(fail ? 1 : 0);
