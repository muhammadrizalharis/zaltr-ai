/**
 * Ambil halaman web LANGSUNG dari server ini (lebih cepat daripada Crawl4AI yang keluar via Tor), lalu
 * ubah HTML menjadi teks bersih. Dipakai crawl.ts sebagai jalur pertama; hasil tipis/gagal -> Crawl4AI.
 *
 * Keamanan (URL berasal dari model): hanya http(s) publik; IP diperiksa SAAT KONEKSI (guardedLookup, anti
 * DNS-rebinding); redirect diikuti manual dan tiap lompatan divalidasi ulang; batas byte & waktu; hanya
 * tipe konten teks/HTML; tanpa cookie/kredensial.
 */
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import type net from "node:net";
import { assertPublicUrl, guardedLookup } from "./netguard";

const MAX_BYTES = 1_500_000;
const MAX_REDIRECTS = 3;
const UA = "Mozilla/5.0 (compatible; CalyzrBot/1.0; +https://calyzr-ai.my.id)";

export type PageFetchHooks = {
  /** Validasi URL tiap lompatan (bawaan: assertPublicUrl). Hanya untuk pengujian. */
  assertUrl?: (u: string) => Promise<string>;
  /** Fungsi lookup koneksi (bawaan: guardedLookup). Hanya untuk pengujian. */
  lookup?: net.LookupFunction;
};

type Raw = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

function requestOnce(url: URL, timeoutMs: number, signal: AbortSignal | undefined, lookup: net.LookupFunction): Promise<Raw> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const timeout = AbortSignal.timeout(timeoutMs);
    const req = mod.request(
      url,
      {
        method: "GET",
        lookup,
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.1",
          "Accept-Language": "id,en;q=0.8",
          "Accept-Encoding": "gzip, deflate, br",
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ status, headers: res.headers, body: Buffer.alloc(0) });
          return;
        }
        const ct = String(res.headers["content-type"] ?? "").toLowerCase();
        if (status >= 200 && status < 300 && ct && !/text\/html|application\/xhtml\+xml|text\/plain/.test(ct)) {
          res.destroy();
          reject(new Error(`bukan halaman teks (${ct.split(";")[0]})`));
          return;
        }
        const enc = String(res.headers["content-encoding"] ?? "").toLowerCase();
        let stream: NodeJS.ReadableStream = res;
        if (enc === "gzip") stream = res.pipe(zlib.createGunzip());
        else if (enc === "deflate") stream = res.pipe(zlib.createInflate());
        else if (enc === "br") stream = res.pipe(zlib.createBrotliDecompress());
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks) });
        };
        stream.on("data", (c: Buffer) => {
          if (done) return;
          size += c.length;
          if (size > MAX_BYTES) {
            chunks.push(c.subarray(0, c.length - (size - MAX_BYTES)));
            finish(); // dipotong di batas; sisa dibuang
            res.destroy();
          } else chunks.push(c);
        });
        stream.on("end", finish);
        stream.on("error", (e) => {
          if (size > 0) finish(); // aliran terputus di tengah: pakai yang sudah ada
          else if (!done) {
            done = true;
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function decodeBody(body: Buffer, contentType: string): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  const head = body.subarray(0, 2048).toString("latin1");
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1];
  const label = (fromHeader ?? fromMeta ?? "utf-8").toLowerCase();
  try {
    return new TextDecoder(label).decode(body);
  } catch {
    return body.toString("utf8");
  }
}

const ENTITIES: Record<string, string> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  middot: "·",
  bull: "•",
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, g: string) => {
    if (g[0] === "#") {
      const code = g[1].toLowerCase() === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[g.toLowerCase()] ?? m;
  });
}

/** HTML -> teks bersih bergaya Markdown ringan (judul, daftar, tabel). Tanpa dependensi. */
export function htmlToText(html: string): { title: string; text: string } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim();
  let h = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|iframe|template|head|nav|footer|aside|form|button|select|dialog)\b[\s\S]*?<\/\1\s*>/gi, "");
  // Utamakan isi utama (<main>/<article>) bila cukup panjang; kalau tidak, seluruh <body>.
  const main = /<main\b[\s\S]*?<\/main\s*>/i.exec(h)?.[0];
  const articles = h.match(/<article\b[\s\S]*?<\/article\s*>/gi)?.join("\n");
  const plain = (s: string) => s.replace(/<[^>]+>/g, "").trim().length;
  if (main && plain(main) > 500) h = main;
  else if (articles && plain(articles) > 500) h = articles;
  h = h
    .replace(/<h([1-6])\b[^>]*>/gi, (_m, n: string) => `\n\n${"#".repeat(Math.min(4, Number(n) + 1))} `) // "#" dipakai judul halaman
    .replace(/<\/h[1-6]\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(td|th)\s*>/gi, " | ")
    .replace(/<\/?(p|div|section|article|main|ul|ol|tr|table|br|hr|blockquote|pre|header|figcaption|dl|dt|dd)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  let lastLine = "";
  const lines = decodeEntities(h)
    .split("\n")
    .map((l) => l.replace(/[ \t\u00a0]+/g, " ").replace(/(\s*\|\s*)+$/, "").trim())
    .filter((l) => {
      if (l === "") return true;
      if (l === lastLine) return false; // buang baris duplikat berurutan (abaikan baris kosong di antaranya)
      lastLine = l;
      return true;
    });
  // Baris pendek non-judul (sisa menu/label tombol) dibuang; baris tabel/daftar tetap karena panjang/berpola.
  const kept = lines.filter((l) => l === "" || l.startsWith("#") || l.startsWith("- ") || l.includes("|") || l.length >= 25);
  const text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { title, text };
}

/**
 * Ambil satu halaman langsung. Melempar Error berisi alasan singkat (HTTP 4xx/5xx, bukan HTML,
 * alamat privat, terlalu banyak redirect, timeout). Hasil dipotong ke maxChars.
 */
export async function fetchPageText(
  rawUrl: string,
  opts: { maxChars: number; timeoutMs: number; signal?: AbortSignal; hooks?: PageFetchHooks },
): Promise<{ url: string; text: string; omitted: number }> {
  const assertUrl = opts.hooks?.assertUrl ?? assertPublicUrl;
  const lookup = opts.hooks?.lookup ?? (guardedLookup as unknown as net.LookupFunction);
  let url = await assertUrl(rawUrl);
  for (let hop = 0; ; hop++) {
    const r = await requestOnce(new URL(url), opts.timeoutMs, opts.signal, lookup);
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      if (hop >= MAX_REDIRECTS) throw new Error("terlalu banyak redirect");
      url = await assertUrl(new URL(String(r.headers.location), url).toString()); // validasi ulang tiap lompatan
      continue;
    }
    if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status}`);
    const ct = String(r.headers["content-type"] ?? "");
    const raw = decodeBody(r.body, ct);
    const { title, text } = /text\/plain/i.test(ct) ? { title: "", text: raw.trim() } : htmlToText(raw);
    const full = title && !text.startsWith(title) ? `# ${title}\n\n${text}` : text;
    return { url, text: full.slice(0, opts.maxChars), omitted: Math.max(0, full.length - opts.maxChars) };
  }
}
