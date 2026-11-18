/**
 * Cegah nominal uang ("US$3.776,60", "$100") dibaca sebagai rumus oleh remark-math.
 * Aturan Pandoc untuk $...$ inline: pembuka harus diikuti non-spasi; penutup tidak boleh didahului
 * spasi dan tidak boleh langsung diikuti angka. `$` yang tak bisa jadi pasangan rumus di-escape (\$).
 * Kode (``...`` dan blok ```), `$$` display, dan `\$` yang sudah di-escape tidak disentuh.
 */

/** Posisi `$` yang HARUS literal (bukan pembuka/penutup rumus) dalam satu potongan teks tanpa kode. */
function literalDollarPositions(text: string): number[] {
  const literal: number[] = [];
  let open = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "$") continue;
    const prev = text[i - 1];
    const next = text[i + 1];
    if (prev === "\\" || prev === "$" || next === "$") continue; // sudah di-escape / bagian dari $$
    if (open >= 0) {
      const closes = prev !== undefined && !/\s/.test(prev) && !(next !== undefined && /\d/.test(next));
      if (closes) {
        open = -1; // pasangan rumus sah
        continue;
      }
      literal.push(open); // pembuka sebelumnya tak punya penutup
      open = -1;
    }
    if (next !== undefined && !/\s/.test(next)) open = i;
    else literal.push(i);
  }
  if (open >= 0) literal.push(open);
  return literal;
}

function escapeSegment(text: string): string {
  const positions = literalDollarPositions(text);
  if (positions.length === 0) return text;
  const set = new Set(positions);
  let out = "";
  for (let i = 0; i < text.length; i++) out += set.has(i) ? "\\$" : text[i];
  return out;
}

export function escapeCurrencyDollars(src: string): string {
  if (!src.includes("$")) return src;
  let fence: string | null = null;
  return src
    .split("\n")
    .map((line) => {
      const f = line.match(/^\s*(`{3,}|~{3,})/);
      if (f) {
        if (fence === null) fence = f[1][0];
        else if (f[1][0] === fence) fence = null;
        return line;
      }
      if (fence !== null || line.includes("$$")) return line;
      // Pisahkan kode inline: segmen ganjil adalah `kode` dan dibiarkan apa adanya.
      return line
        .split(/(`[^`]*`)/)
        .map((seg, i) => (i % 2 === 1 ? seg : escapeSegment(seg)))
        .join("");
    })
    .join("\n");
}
