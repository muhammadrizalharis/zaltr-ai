/**
 * Web search via SearXNG self-hosted (container zaltr-searxng).
 * Dipakai riset otomatis (research.ts), aksi agent, dan parameter `web` di /api/chat (UI tak lagi punya toggle).
 */

const SEARXNG_URL = (process.env.ZALTR_SEARXNG_URL ?? "").replace(/\/$/, "");
// Instance cadangan (opsional): mesin web umum di IP server ini sering diblokir (CAPTCHA/429),
// jadi bila hasil instance utama kurang, instance lain (IP berbeda) dipakai sebagai pelengkap.
const SEARXNG_FALLBACK_URL = (process.env.ZALTR_SEARXNG_FALLBACK_URL ?? "").replace(/\/$/, "");
const MIN_PRIMARY_HITS = 3;
const MIN_RELEVANT = 2; // minimal hasil yang memuat kata topik agar instance utama dianggap cukup

export type SearchHit = { title: string; url: string; snippet: string };

async function searxQuery(
  base: string,
  query: string,
  max: number,
  opts: { science?: boolean } | undefined,
): Promise<SearchHit[]> {
  const qs = new URLSearchParams({
    q: query.slice(0, 300),
    format: "json",
    language: opts?.science ? "all" : "id",
    safesearch: "1",
  });
  // Kategori "science": PubMed, arXiv, Semantic Scholar, Crossref, OpenAlex, dll.
  if (opts?.science) qs.set("categories", "science");
  const res = await fetch(`${base}/search?${qs}`, {
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

export async function webSearch(
  query: string,
  max = 5,
  opts?: { science?: boolean },
): Promise<SearchHit[]> {
  if (!SEARXNG_URL && !SEARXNG_FALLBACK_URL) {
    throw new Error("SearXNG belum dikonfigurasi (ZALTR_SEARXNG_URL)");
  }
  const words = topicWords(query);
  let hits: SearchHit[] = [];
  let primaryError: unknown;
  if (SEARXNG_URL) {
    try {
      hits = await searxQuery(SEARXNG_URL, query, max, opts);
    } catch (e) {
      primaryError = e;
    }
  }
  // "Cukup" = jumlahnya memadai DAN ada yang nyambung topik: mesin yang diblokir sering tetap
  // menjawab, tetapi dengan hasil generik tak relevan (mis. hanya Bing), jadi hitungan saja menipu.
  const relevant = hits.filter((h) => topicScore(h, words) > 0).length;
  const enough =
    hits.length >= Math.min(MIN_PRIMARY_HITS, max) && (words.length === 0 || relevant >= Math.min(MIN_RELEVANT, hits.length));
  if (!SEARXNG_FALLBACK_URL || enough) {
    if (primaryError && hits.length === 0) throw primaryError;
    return rankByTopic(hits, words);
  }
  try {
    const more = await searxQuery(SEARXNG_FALLBACK_URL, query, max, opts);
    const seen = new Set(hits.map((h) => h.url));
    return rankByTopic([...hits, ...more.filter((h) => !seen.has(h.url))], words).slice(0, max);
  } catch (e) {
    // Galat dilempar hanya bila tak ada instance lain yang menjawab sah: utama juga gagal, atau tak ada utama.
    // Utama yang menjawab sah dengan 0 hasil = hasil kosong, bukan galat.
    if (hits.length === 0 && (primaryError || !SEARXNG_URL)) throw primaryError ?? e;
    return rankByTopic(hits, words);
  }
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

/** Kata sambung/penghubung yang tak membawa topik (dipakai pencocokan relevansi & kata kunci cadangan). */
export const STOPWORDS = new Set(
  "yang dan di ke dari untuk dengan tentang soal mengenai terkait pada adalah itu atau juga saja agar the a an of on in for about to and with is are".split(" "),
);
// Kata penanda jenis sumber: bukan topik, jadi tak dipakai menilai relevansi.
const KATA_JENIS_SUMBER = new Set(
  "referensi jurnal paper papers journal journals literatur literature sitasi artikel ilmiah penelitian terbaru terkini".split(" "),
);

/** Kata topik inti kueri (huruf kecil, unik, >3 huruf, tanpa stopword/penanda sumber). */
export function topicWords(q: string): string[] {
  const words = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3 && !STOPWORDS.has(w) && !KATA_JENIS_SUMBER.has(w));
  return [...new Set(words)];
}

/** Jumlah kata topik yang termuat di judul/cuplikan hasil. */
function topicScore(h: SearchHit, words: string[]): number {
  const t = `${h.title} ${h.snippet}`.toLowerCase();
  return words.reduce((n, w) => n + (t.includes(w) ? 1 : 0), 0);
}

/** Urutkan stabil: hasil yang memuat lebih banyak kata topik di judul/cuplikan didahulukan (tak ada yang dibuang). */
function rankByTopic(hits: SearchHit[], words: string[]): SearchHit[] {
  if (words.length === 0) return hits;
  return hits
    .map((h, i) => ({ h, i, s: topicScore(h, words) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.h);
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
  const merged = [...sci, ...web].filter((h) => !seen.has(h.url) && seen.add(h.url));
  // Mesin ilmiah sering menaruh hasil tak nyambung di depan; didahulukan yang cocok dengan topik.
  return rankByTopic(merged, topicWords(query)).slice(0, max + 3);
}

/** Khusus jurnal/referensi ilmiah (aksi agen "jurnal"). */
export async function scholarSearch(query: string, max = 8): Promise<SearchHit[]> {
  return webSearch(query, max, { science: true });
}
