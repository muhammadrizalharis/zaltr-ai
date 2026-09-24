// Uji cepat ekstraksi tanpa perlu MCP client. Jalankan: npm run smoke
import JSZip from "jszip";
import { extractText } from "./extract.mjs";

async function zipBuf(files) {
  const zip = new JSZip();
  for (const [k, v] of Object.entries(files)) zip.file(k, v);
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

let ok = 0;
let fail = 0;
function check(label, cond) {
  if (cond) { ok++; console.log(`  OK  ${label}`); }
  else { fail++; console.log(`  XX  ${label}`); }
}

const docx = await zipBuf({
  "word/document.xml":
    `<?xml version="1.0"?><w:document xmlns:w="u"><w:body><w:p><w:r><w:t>Halo docx</w:t></w:r></w:p></w:body></w:document>`,
});
check("docx -> teks", (await extractText(docx, "a.docx")).includes("Halo docx"));

const xlsx = await zipBuf({
  "xl/sharedStrings.xml": `<?xml version="1.0"?><sst xmlns="u"><si><t>skor</t></si></sst>`,
  "xl/worksheets/sheet1.xml":
    `<?xml version="1.0"?><worksheet xmlns="u"><sheetData><row><c t="s"><v>0</v></c><c><v>97.5</v></c></row></sheetData></worksheet>`,
});
const xOut = await extractText(xlsx, "a.xlsx");
check("xlsx -> teks", xOut.includes("skor"));
check("xlsx -> angka", xOut.includes("97.5"));

const txt = Buffer.from("baris teks biasa", "utf8");
check("txt -> teks", (await extractText(txt, "a.txt")).includes("baris teks"));

console.log(`\n${ok} lolos, ${fail} gagal`);
process.exit(fail ? 1 : 0);
