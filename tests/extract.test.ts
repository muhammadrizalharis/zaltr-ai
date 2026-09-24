import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { extractText } from "@/server/extract";

async function zipBuf(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip();
  for (const [k, v] of Object.entries(files)) zip.file(k, v);
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

describe("extractText — Office", () => {
  it("xlsx: membaca ANGKA + teks per sel (bukan hanya sharedStrings)", async () => {
    const buf = await zipBuf({
      "xl/sharedStrings.xml":
        `<?xml version="1.0"?><sst xmlns="u"><si><t>nama</t></si><si><t>skor</t></si><si><t>Ani</t></si></sst>`,
      "xl/worksheets/sheet1.xml":
        `<?xml version="1.0"?><worksheet xmlns="u"><sheetData>` +
        `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
        `<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>97.5</v></c></row>` +
        `</sheetData></worksheet>`,
    });
    const out = (await extractText(buf, "data.xlsx")) ?? "";
    expect(out).toContain("nama");
    expect(out).toContain("skor");
    expect(out).toContain("Ani");
    expect(out).toContain("97.5"); // angka kini ikut terbaca
  });

  it("docx: membaca paragraf", async () => {
    const buf = await zipBuf({
      "word/document.xml":
        `<?xml version="1.0"?><w:document xmlns:w="u"><w:body>` +
        `<w:p><w:r><w:t>Baris satu</w:t></w:r></w:p>` +
        `<w:p><w:r><w:t>Baris dua</w:t></w:r></w:p>` +
        `</w:body></w:document>`,
    });
    const out = (await extractText(buf, "a.docx")) ?? "";
    expect(out).toContain("Baris satu");
    expect(out).toContain("Baris dua");
  });
});
