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
// Instance cadangan ikut jalan bila utama belum menjawab "cukup" dalam waktu ini (permintaan "hedged"),
// jadi mesin yang tersendat tak membuat riset menunggu timeout penuh.
const HEDGE_MS = 1_500;
// Cache hasil pencarian: kueri berulang tak mengetuk mesin lagi (mengurangi penangguhan CAPTCHA/429).
const CACHE_TTL_MS = Math.max(0, Number(process.env.ZALTR_SEARCH_CACHE_SEC ?? 600) || 0) * 1000;
const CACHE_MAX = 200;

export type SearchHit = { title: string; url: string; snippet: string };

async function searxQuery(
  base: string,
  query: string,
  max: number,
  opts: { science?: boolean } | undefined,
  signal?: AbortSignal,
): Promise<SearchHit[]> {
  const qs = new URLSearchParams({
    q: query.slice(0, 300),
    format: "json",
    language: opts?.science ? "all" : "id",
    safesearch: "1",
  });
  // Kategori "science": PubMed, arXiv, Semantic Scholar, Crossref, OpenAlex, dll.
  if (opts?.science) qs.set("categories", "science");
  const timeout = AbortSignal.timeout(opts?.science ? 20_000 : 10_000);
  const res = await fetch(`${base}/search?${qs}`, {
    signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
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

function dedupeByUrl(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  return hits.filter((h) => !seen.has(h.url) && seen.add(h.url));
}

/**
 * "Cukup" = jumlahnya memadai DAN ada yang nyambung topik: mesin yang diblokir sering tetap
 * menjawab, tetapi dengan hasil generik tak relevan (mis. hanya Bing), jadi hitungan saja menipu.
 */
function isEnough(hits: SearchHit[], words: string[], max: number): boolean {
  if (hits.length < Math.min(MIN_PRIMARY_HITS, max)) return false;
  if (words.length === 0) return true;
  const relevant = hits.filter((h) => topicScore(h, words) > 0).length;
  return relevant >= Math.min(MIN_RELEVANT, hits.length);
}

/**
 * Utama dulu; cadangan menyusul (setelah HEDGE_MS, atau segera bila utama selesai tapi kurang).
 * Hasil pertama yang "cukup" menang dan yang lain dibatalkan. Bila tak ada yang cukup, hasil
 * semua instance yang menjawab digabung lalu diurutkan menurut topik. Galat dilempar hanya bila
 * TIDAK ADA instance yang menjawab sah (0 hasil dari instance yang sehat = hasil kosong, bukan galat).
 */
async function searchHedged(
  query: string,
  max: number,
  opts: { science?: boolean } | undefined,
  words: string[],
): Promise<SearchHit[]> {
  type R = { from: "p" | "f"; hits: SearchHit[]; err?: unknown };
  const stop = new AbortController();
  const finished: R[] = [];
  let launched = 0;
  let fallbackStarted = false;
  let wake: (() => void) | undefined;
  const launch = (base: string, from: "p" | "f") => {
    launched++;
    searxQuery(base, query, max, opts, stop.signal)
      .then(
        (hits) => void finished.push({ from, hits }),
        (err) => void finished.push({ from, hits: [], err }),
      )
      .finally(() => wake?.());
  };
  const startFallback = () => {
    if (!SEARXNG_FALLBACK_URL || fallbackStarted) return;
    fallbackStarted = true;
    launch(SEARXNG_FALLBACK_URL, "f");
  };
  if (SEARXNG_URL) launch(SEARXNG_URL, "p");
  else startFallback();
  const hedge = setTimeout(startFallback, HEDGE_MS);
  // Urutan gabungan deterministik: instance utama didahulukan, apa pun yang selesai lebih dulu.
  const byPriority = (a: R, b: R) => (a.from === b.from ? 0 : a.from === "p" ? -1 : 1);
  try {
    for (;;) {
      const good = finished.find((r) => !r.err && isEnough(r.hits, words, max));
      if (good) {
        // Utama didahulukan pada duplikat; urutan akhir ditentukan relevansi topik.
        const merged = [...finished].sort(byPriority).flatMap((r) => r.hits);
        return rankByTopic(dedupeByUrl(merged), words).slice(0, max);
      }
      if (finished.length === launched) {
        if (!fallbackStarted && SEARXNG_FALLBACK_URL) {
          startFallback(); // utama sudah selesai tapi kurang: jangan tunggu jeda hedge
          continue;
        }
        break;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  } finally {
    clearTimeout(hedge);
    stop.abort(); // batalkan permintaan yang kalah
  }
  const answered = finished.filter((r) => !r.err).sort(byPriority);
  if (answered.length === 0) {
    throw finished.find((r) => r.from === "p")?.err ?? finished[0]?.err ?? new Error("pencarian gagal");
  }
  return rankByTopic(dedupeByUrl(answered.flatMap((r) => r.hits)), words).slice(0, max);
}

const searchCache = new Map<string, { at: number; hits: SearchHit[] }>();
const searchInflight = new Map<string, Promise<SearchHit[]>>();
const copyHits = (hits: SearchHit[]) => hits.map((h) => ({ ...h }));

export async function webSearch(
  query: string,
  max = 5,
  opts?: { science?: boolean },
): Promise<SearchHit[]> {
  if (!SEARXNG_URL && !SEARXNG_FALLBACK_URL) {
    throw new Error("SearXNG belum dikonfigurasi (ZALTR_SEARXNG_URL)");
  }
  const key = `${opts?.science ? "s" : "w"}|${max}|${query.trim().toLowerCase().replace(/\s+/g, " ")}`;
  if (CACHE_TTL_MS > 0) {
    const cached = searchCache.get(key);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return copyHits(cached.hits);
    const running = searchInflight.get(key); // permintaan identik yang sedang berjalan dipakai bersama
    if (running) return copyHits(await running);
  }
  const p = searchHedged(query, max, opts, topicWords(query)).then((hits) => {
    // Hanya hasil berisi yang di-cache: kosong/galat bisa saja sementara (mesin sedang ditangguhkan).
    if (CACHE_TTL_MS > 0 && hits.length > 0) {
      searchCache.set(key, { at: Date.now(), hits });
      if (searchCache.size > CACHE_MAX) searchCache.delete(searchCache.keys().next().value!);
    }
    return hits;
  });
  if (CACHE_TTL_MS > 0) {
    searchInflight.set(key, p);
    p.then(
      () => searchInflight.delete(key),
      () => searchInflight.delete(key),
    );
  }
  return copyHits(await p);
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
