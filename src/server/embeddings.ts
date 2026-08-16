/**
 * Embedding teks untuk RAG. Memakai model embed yang SUDAH ada di Ollama
 * (ZALTR_EMBED_MODEL, default bge-m3:latest, 1024-dim) — hanya memanggil
 * endpoint, tidak mengubah instans Ollama.
 */

const OLLAMA = (process.env.ZALTR_OLLAMA_URL ?? "").replace(/\/$/, "");
export const EMBED_MODEL = process.env.ZALTR_EMBED_MODEL || "bge-m3:latest";
export const EMBED_DIM = 1024;

interface EmbedResponse {
  embeddings?: number[][];
}

/** Embedding banyak teks sekaligus (batch). Kosong -> []. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!OLLAMA) throw new Error("ZALTR_OLLAMA_URL belum diset");
  const res = await fetch(`${OLLAMA}/api/embed`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
    signal: AbortSignal.timeout(120_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Embedding gagal (${res.status})`);
  const data = (await res.json()) as EmbedResponse;
  const out = data.embeddings ?? [];
  if (out.length !== texts.length) throw new Error("Jumlah embedding tidak cocok");
  return out;
}

export async function embedOne(text: string): Promise<number[]> {
  const [v] = await embed([text]);
  return v;
}
