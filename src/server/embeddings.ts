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

// Cache LRU sederhana: hindari meng-embed ulang teks identik (query/ingest
// berulang) -> hemat panggilan Ollama & lebih cepat.
const embedCache = new Map<string, number[]>();
const EMBED_CACHE_MAX = 2000;
function cachePut(key: string, vec: number[]): void {
  if (embedCache.size >= EMBED_CACHE_MAX) {
    const first = embedCache.keys().next().value;
    if (first !== undefined) embedCache.delete(first);
  }
  embedCache.set(key, vec);
}

/** Embedding banyak teks sekaligus (batch). Kosong -> []. Memakai cache. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (!OLLAMA) throw new Error("ZALTR_OLLAMA_URL belum diset");
  const out: (number[] | null)[] = texts.map((t) => embedCache.get(t) ?? null);
  const missIdx: number[] = [];
  for (let i = 0; i < out.length; i++) if (out[i] === null) missIdx.push(i);
  if (missIdx.length > 0) {
    const res = await fetch(`${OLLAMA}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: missIdx.map((i) => texts[i]) }),
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Embedding gagal (${res.status})`);
    const data = (await res.json()) as EmbedResponse;
    const vecs = data.embeddings ?? [];
    if (vecs.length !== missIdx.length) throw new Error("Jumlah embedding tidak cocok");
    missIdx.forEach((idx, j) => {
      out[idx] = vecs[j];
      cachePut(texts[idx], vecs[j]);
    });
  }
  return out as number[][];
}

export async function embedOne(text: string): Promise<number[]> {
  const [v] = await embed([text]);
  return v;
}
