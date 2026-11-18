/**
 * Web search via SearXNG self-hosted (container zaltr-searxng).
 * Dipakai route chat saat user menyalakan toggle "Cari web".
 */

const SEARXNG_URL = (process.env.ZALTR_SEARXNG_URL ?? "").replace(/\/$/, "");

export type SearchHit = { title: string; url: string; snippet: string };

export async function webSearch(
  query: string,
  max = 5,
  opts?: { science?: boolean },
): Promise<SearchHit[]> {
  if (!SEARXNG_URL) throw new Error("SearXNG belum dikonfigurasi (ZALTR_SEARXNG_URL)");
  const qs = new URLSearchParams({
    q: query.slice(0, 300),
    format: "json",
    language: opts?.science ? "all" : "id",
    safesearch: "1",
  });
  // Kategori "science": PubMed, arXiv, Semantic Scholar, Crossref, OpenAlex, dll.
  if (opts?.science) qs.set("categories", "science");
  const res = await fetch(`${SEARXNG_URL}/search?${qs}`, {
    signal: AbortSignal.timeout(opts?.science ? 20_000 : 10_000),
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

/** Batas tunggu hasil mesin ilmiah (kadang lambat sampai 20 dtk) agar hasil web biasa tak tertahan. */
const SCIENCE_WAIT_MS = 9_000;

/** Pertanyaan bernuansa akademik (jurnal/referensi/sitasi) -> sertakan hasil ilmiah. */
export function isScholarlyQuery(q: string): boolean {
  return /\b(jurnal|journal|paper|referensi|sitasi|citation|literatur|literature|artikel ilmiah|scopus|sinta|doi|penelitian terdahulu|state of the art|systematic review|tinjauan pustaka)\b/i.test(
    q,
  );
}

/** Pencarian web; bila query akademik, gabungkan dengan hasil mesin ilmiah (tanpa duplikat URL). */
export async function webSearchSmart(query: string, max = 5): Promise<SearchHit[]> {
  if (!isScholarlyQuery(query)) return webSearch(query, max);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sciSlow = new Promise<SearchHit[]>((r) => {
    timer = setTimeout(() => r([]), SCIENCE_WAIT_MS);
  });
  const [web, sci] = await Promise.all([
    webSearch(query, max).catch(() => [] as SearchHit[]),
    Promise.race([webSearch(query, max + 3, { science: true }).catch(() => [] as SearchHit[]), sciSlow]),
  ]);
  clearTimeout(timer);
  const seen = new Set<string>();
  return [...sci, ...web].filter((h) => !seen.has(h.url) && seen.add(h.url)).slice(0, max + 3);
}

/** Khusus jurnal/referensi ilmiah (aksi agen "jurnal"). */
export async function scholarSearch(query: string, max = 8): Promise<SearchHit[]> {
  return webSearch(query, max, { science: true });
}
