/**
 * Saran pertanyaan lanjutan (ala Gemini/Perplexity), dibuat model lokal gratis
 * (tanpa kredit) berdasarkan pertukaran terakhir.
 */

const OLLAMA_URL = process.env.ZALTR_OLLAMA_URL ?? "http://127.0.0.1:46434";
const MODEL = process.env.ZALTR_FREE_MODEL ?? "llama3.2:latest";

export async function suggestFollowups(lastUser: string, lastAssistant: string): Promise<string[]> {
  try {
    const prompt =
      "Berdasarkan percakapan berikut, tulis 3 pertanyaan LANJUTAN singkat yang " +
      "kemungkinan diajukan PENGGUNA berikutnya. Bahasa Indonesia, maksimal 8 kata " +
      "per pertanyaan. Jawab HANYA 3 baris, satu pertanyaan per baris, tanpa nomor " +
      "dan tanpa tanda kutip.\n\n" +
      `Pengguna: ${lastUser.slice(0, 400)}\nAsisten: ${lastAssistant.slice(0, 800)}\n`;
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        keep_alive: "10m",
        options: { temperature: 0.4, num_predict: 90 },
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { message?: { content?: string } };
    return (data.message?.content ?? "")
      .split("\n")
      .map((l) => l.replace(/^[\s\d.)*_-]+/, "").replace(/^["'`]+|["'`]+$/g, "").trim())
      .filter((l) => l.length >= 5 && l.length <= 100)
      .slice(0, 3);
  } catch {
    return [];
  }
}
