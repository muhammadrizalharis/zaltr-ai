import type { ChatRequest, ProviderGenerator } from "./contract";

/** Provider demo internal: streaming lokal tanpa model eksternal. */
export async function* demoChat(req: ChatRequest): ProviderGenerator {
  const prompt = req.history.at(-1)?.content ?? "";
  const jumlahPesan = req.history.length;
  const reply =
    `Ini **Zaltr Core**, provider demo internal zaltr.ai — dipakai untuk menguji ` +
    `antarmuka sebelum Copilot Enterprise dan Ollama diaktifkan.\n\n` +
    `Pesanmu barusan:\n\n> ${prompt.slice(0, 500)}\n\n` +
    `Beberapa hal yang sudah bekerja pada pratinjau ini:\n\n` +
    `- Streaming token seperti ini, kata demi kata\n` +
    `- Riwayat tersimpan di PostgreSQL (percakapan ini berisi ${jumlahPesan} pesan)\n` +
    `- Tombol **model picker** di samping kolom chat\n` +
    `- Markdown: \`inline code\`, daftar, dan blok kode\n\n` +
    "```ts\n" +
    `const provider = "zaltr-core"; // ganti ke Copilot/Ollama dari tombol model\n` +
    "```\n\n" +
    `Ganti model dari tombol di kiri kolom chat untuk melihat status provider lain.`;

  for (const token of reply.split(/(?<=\s)/)) {
    if (req.signal.aborted) throw new Error("aborted");
    yield { kind: "text", text: token };
    await new Promise((r) => setTimeout(r, 12));
  }
}
