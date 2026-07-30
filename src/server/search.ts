/**
 * Web search via SearXNG self-hosted (container zaltr-searxng).
 * Dipakai route chat saat user menyalakan toggle "Cari web".
 */

const SEARXNG_URL = (process.env.ZALTR_SEARXNG_URL ?? "").replace(/\/$/, "");

export type SearchHit = { title: string; url: string; snippet: string };

export async function webSearch(query: string, max = 5): Promise<SearchHit[]> {
  if (!SEARXNG_URL) throw new Error("SearXNG belum dikonfigurasi (ZALTR_SEARXNG_URL)");
  const qs = new URLSearchParams({
    q: query.slice(0, 300),
    format: "json",
    language: "id",
    safesearch: "1",
  });
  const res = await fetch(`${SEARXNG_URL}/search?${qs}`, {
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
    headers: { "User-Agent": "zaltr-web" },
  });
  if (!res.ok) throw new Error(`SearXNG menolak (${res.status})`);
  const data = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (data.results ?? [])
    .filter((r) => r.url && r.title)
    .slice(0, max)
    .map((r) => ({
      title: r.title!,
      url: r.url!,
      snippet: (r.content ?? "").slice(0, 400),
    }));
}

/** Format hasil pencarian menjadi blok konteks untuk prompt model. */
export function formatSearchContext(query: string, hits: SearchHit[]): string {
  if (hits.length === 0) {
    return `=== Hasil pencarian web untuk "${query}" ===\n(tidak ada hasil)\n=== Akhir hasil pencarian ===`;
  }
  const rows = hits
    .map((h, i) => `[${i + 1}] ${h.title}\nURL: ${h.url}\n${h.snippet}`)
    .join("\n\n");
  return (
    `=== Hasil pencarian web untuk "${query}" (${new Date().toISOString().slice(0, 10)}) ===\n` +
    `${rows}\n=== Akhir hasil pencarian ===\n` +
    `Jawab berdasarkan hasil di atas bila relevan dan sebutkan sumbernya sebagai link markdown.`
  );
}
