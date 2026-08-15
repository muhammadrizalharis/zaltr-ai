const OLLAMA_URL = process.env.ZALTR_OLLAMA_URL ?? "http://127.0.0.1:46434";
const TITLE_MODEL = process.env.ZALTR_FREE_MODEL ?? "llama3.2:latest";

// JANGAN beri contoh few-shot: model kecil justru menyalin jawaban contohnya
// alih-alih meringkas pesan asli. Instruksi langsung + pembatas paling andal.
const INSTRUKSI =
  "Ringkas pesan berikut menjadi judul singkat maksimal 5 kata dalam Bahasa " +
  "Indonesia. Jawab hanya judulnya.\n\n---\n";

/**
 * Judul chat ringkas ala ChatGPT, dibuat model lokal (gratis, tanpa kredit).
 * Mengembalikan null bila gagal — pemanggil memakai judul cadangan.
 */
export async function generateTitle(pesanPertama: string): Promise<string | null> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: TITLE_MODEL,
        stream: false,
        keep_alive: "10m",
        options: { temperature: 0, num_predict: 20 },
        messages: [
          { role: "user", content: `${INSTRUKSI}${pesanPertama.slice(0, 500)}\n---` },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { message?: { content?: string } };
    const judul = (data.message?.content ?? "")
      .split("\n")[0]
      .replace(/^["'`\s]+|["'`.\s]+$/g, "")
      .trim();
    return judul.length >= 3 && judul.length <= 70 ? judul : null;
  } catch {
    return null;
  }
}
