import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import http from "node:http";
import zlib from "node:zlib";
import dns from "node:dns";
import type net from "node:net";
import type { AddressInfo } from "node:net";
import { fetchPageText, htmlToText, type PageFetchHooks } from "@/server/pagefetch";
import { guardedLookup, isPrivateIp } from "@/server/netguard";

const ARTICLE = (extra = "") => `<!doctype html><html><head><title>Harga Emas &amp; Berita Hari Ini</title>
<script>var x = "JANGAN-MUNCUL";</script><style>.a{color:red}</style></head>
<body><nav>Beranda Menu Login Daftar</nav>
<main><h1>Harga emas Antam turun</h1>
<p>Harga emas Antam hari ini turun Rp1.000 per gram menjadi Rp2.500.000 menurut data resmi perusahaan pada Rabu pagi.</p>
<p>Analis menilai pelemahan ini dipengaruhi penguatan dolar AS dan turunnya permintaan fisik di pasar domestik &mdash; sumber: laporan harian.</p>
<ul><li>Harga jual Rp2.500.000 per gram untuk satu gram emas batangan</li><li>Harga buyback Rp2.350.000 per gram saat dijual kembali</li></ul>
<table><tr><td>Berat</td><td>Harga</td></tr><tr><td>1 gram</td><td>Rp2.500.000</td></tr></table>
${extra}</main><footer>Hak cipta JANGAN-MUNCUL-FOOTER</footer></body></html>`;

let server: http.Server;
let base = "";
const hits: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url ?? "");
    const send = (status: number, body: string | Buffer, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "content-type": "text/html; charset=utf-8", ...headers });
      res.end(body);
    };
    switch (req.url) {
      case "/ok":
        return send(200, ARTICLE());
      case "/gzip":
        return send(200, zlib.gzipSync(ARTICLE()), { "content-encoding": "gzip" });
      case "/br":
        return send(200, zlib.brotliCompressSync(ARTICLE()), { "content-encoding": "br" });
      case "/deflate":
        return send(200, zlib.deflateSync(ARTICLE()), { "content-encoding": "deflate" });
      case "/redir":
        return send(302, "", { location: "/ok" });
      case "/redir-abs":
        return send(301, "", { location: `${base}/ok` });
      case "/redir-loop":
        return send(302, "", { location: "/redir-loop" });
      case "/redir-forbidden":
        return send(302, "", { location: "/forbidden" });
      case "/forbidden":
        return send(200, ARTICLE());
      case "/404":
        return send(404, "tidak ada");
      case "/500":
        return send(500, "galat server");
      case "/pdf":
        return send(200, "%PDF-1.4 ...", { "content-type": "application/pdf" });
      case "/json":
        return send(200, "{}", { "content-type": "application/json" });
      case "/plain":
        return send(200, "baris satu\nbaris dua", { "content-type": "text/plain; charset=utf-8" });
      case "/latin1":
        return send(200, Buffer.from("<html><head><title>Caf\xe9</title></head><body><main><p>Kopi di caf\xe9 itu enak sekali dan murah untuk semua orang yang datang berkunjung setiap hari, termasuk akhir pekan dan hari libur nasional.</p></main></body></html>", "latin1"), {
          "content-type": "text/html; charset=ISO-8859-1",
        });
      case "/big": {
        // paragraf berbeda-beda (yang identik berurutan sengaja disatukan oleh ekstraktor)
        let body = "<html><body><main>";
        for (let i = 0; i < 12_000; i++) body += `<p>Paragraf nomor ${i} ${"kata ".repeat(40)}</p>`;
        return send(200, body + "</main></body></html>");
      }
      case "/slow":
        return void setTimeout(() => send(200, ARTICLE()), 3_000);
      case "/hang-body": {
        res.writeHead(200, { "content-type": "text/html" });
        res.write("<html><body><main><p>mulai</p>");
        return; // tak pernah selesai
      }
      default:
        return send(404, "?");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});
afterEach(() => (hits.length = 0));

// Hook uji: loopback diizinkan (server uji ada di 127.0.0.1). Pertahanan asli diuji terpisah di bawah.
const lookupPlain = ((hostname: string, options: dns.LookupOptions, cb: (...a: unknown[]) => void) =>
  dns.lookup(hostname, options, cb as never)) as unknown as net.LookupFunction;
const open: PageFetchHooks = { assertUrl: async (u) => u, lookup: lookupPlain };
const get = (path: string, over: Partial<{ maxChars: number; timeoutMs: number; hooks: PageFetchHooks; signal: AbortSignal }> = {}) =>
  fetchPageText(base + path, { maxChars: 12_000, timeoutMs: 2_000, hooks: open, ...over });

describe("fetchPageText: pengambilan & ekstraksi", () => {
  it("halaman biasa: judul + isi utama; skrip/gaya/menu/footer dibuang; entitas didekode", async () => {
    const r = await get("/ok");
    expect(r.text.startsWith("# Harga Emas & Berita Hari Ini")).toBe(true);
    expect(r.text).toContain("## Harga emas Antam turun");
    expect(r.text).toContain("Rp2.500.000");
    expect(r.text).toContain("— sumber: laporan harian");
    expect(r.text).toContain("- Harga jual Rp2.500.000 per gram");
    expect(r.text).toContain("1 gram | Rp2.500.000");
    expect(r.text).not.toMatch(/JANGAN-MUNCUL|Beranda Menu|color:red/);
  });

  it.each(["/gzip", "/br", "/deflate"])("konten terkompresi %s didekompresi", async (p) => {
    expect((await get(p)).text).toContain("Harga emas Antam hari ini turun");
  });

  it("redirect relatif & absolut diikuti", async () => {
    expect((await get("/redir")).url).toBe(`${base}/ok`);
    expect((await get("/redir-abs")).text).toContain("Harga emas Antam");
  });

  it("redirect tanpa akhir -> berhenti setelah 3 lompatan", async () => {
    await expect(get("/redir-loop")).rejects.toThrow(/terlalu banyak redirect/);
    expect(hits.filter((h) => h === "/redir-loop").length).toBe(4); // 1 awal + 3 lompatan
  });

  it("charset non-UTF8 (ISO-8859-1) didekode benar", async () => {
    expect((await get("/latin1")).text).toContain("café");
  });

  it("text/plain dikembalikan apa adanya", async () => {
    expect((await get("/plain")).text).toBe("baris satu\nbaris dua");
  });

  it.each([
    ["/404", /HTTP 404/],
    ["/500", /HTTP 500/],
    ["/pdf", /bukan halaman teks/],
    ["/json", /bukan halaman teks/],
  ])("%s ditolak dengan alasan jelas", async (p, re) => {
    await expect(get(p)).rejects.toThrow(re);
  });

  it("dipotong ke maxChars dan melaporkan sisa", async () => {
    const r = await get("/ok", { maxChars: 120 });
    expect(r.text.length).toBe(120);
    expect(r.omitted).toBeGreaterThan(100);
  });

  it("badan sangat besar (>1,5MB) dipotong di batas, tidak menggantung & tidak error", async () => {
    const t0 = Date.now();
    const r = await get("/big", { maxChars: 500_000, timeoutMs: 5_000 });
    expect(Date.now() - t0).toBeLessThan(4_000);
    expect(r.text.length).toBeGreaterThan(1_000);
    expect(r.text.length).toBeLessThan(1_600_000);
  });

  it("server lambat -> timeout sesuai batas", async () => {
    const t0 = Date.now();
    await expect(get("/slow", { timeoutMs: 300 })).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(1_500);
  });

  it("badan yang tak pernah selesai -> tetap dibatasi timeout (tak menggantung selamanya)", async () => {
    const t0 = Date.now();
    await expect(get("/hang-body", { timeoutMs: 400 })).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(1_500);
  });

  it("sinyal batal dari pemanggil menghentikan permintaan", async () => {
    const ac = new AbortController();
    const p = get("/slow", { timeoutMs: 5_000, signal: ac.signal });
    setTimeout(() => ac.abort(), 100);
    const t0 = Date.now();
    await expect(p).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(1_000);
  });
});

describe("fetchPageText: pertahanan keamanan", () => {
  it("URL loopback ditolak oleh validasi URL bawaan (tanpa hook)", async () => {
    await expect(fetchPageText(`${base}/ok`, { maxChars: 1000, timeoutMs: 1000 })).rejects.toThrow(/privat|port/);
    expect(hits).toEqual([]); // tak ada permintaan yang sampai ke server
  });

  it("DNS-rebinding: NAMA HOST lolos validasi awal tapi me-resolve ke IP privat -> koneksi DITOLAK saat connect", async () => {
    // Hanya assertUrl yang dilonggarkan; lookup bawaan (guardedLookup) tetap menjaga saat koneksi.
    // (Host berupa IP literal tak melewati lookup — itu dijaga assertPublicUrl, lihat tes validasi di crawl-research.)
    const port = new URL(base).port;
    await expect(
      fetchPageText(`http://localhost:${port}/ok`, { maxChars: 1000, timeoutMs: 1000, hooks: { assertUrl: async (u) => u } }),
    ).rejects.toThrow(/privat|EPRIVATE/);
    expect(hits).toEqual([]); // server tak pernah menerima permintaan
  });

  it("redirect ke alamat terlarang ditolak pada lompatan itu (divalidasi ulang)", async () => {
    const hooks: PageFetchHooks = {
      lookup: lookupPlain,
      assertUrl: async (u) => {
        if (u.includes("/forbidden")) throw new Error("alamat privat ditolak");
        return u;
      },
    };
    await expect(get("/redir-forbidden", { hooks })).rejects.toThrow(/privat/);
    expect(hits).toEqual(["/redir-forbidden"]); // /forbidden tak pernah diminta
  });

  it("guardedLookup menolak localhost dan IP privat literal", async () => {
    const run = (host: string) =>
      new Promise<{ err?: Error }>((resolve) => guardedLookup(host, { all: false }, (err) => resolve({ err: err ?? undefined })));
    expect((await run("localhost")).err?.message).toMatch(/privat/);
    expect((await run("127.0.0.1")).err?.message).toMatch(/privat/);
    expect((await run("10.0.0.5")).err?.message).toMatch(/privat/);
    expect((await run("169.254.169.254")).err?.message).toMatch(/privat/);
    expect((await run("::1")).err?.message).toMatch(/privat/);
  });

  it("guardedLookup mengembalikan IP publik tanpa menolak (IP literal publik)", async () => {
    const r = await new Promise<{ err?: Error; addr?: unknown }>((resolve) =>
      guardedLookup("93.184.216.34", { all: false }, (err, addr) => resolve({ err: err ?? undefined, addr })),
    );
    expect(r.err).toBeUndefined();
    expect(r.addr).toBe("93.184.216.34");
  });

  it("isPrivateIp tetap mengenali rentang yang dilindungi (ekspor bersama dengan Crawl4AI)", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "::1", "fd00::1", "::ffff:10.0.0.1"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
    expect(isPrivateIp("93.184.216.34")).toBe(false);
  });
});

describe("htmlToText", () => {
  it("memilih <main>/<article> bila cukup panjang, selain itu seluruh body", () => {
    const long = "Kalimat isi utama yang cukup panjang. ".repeat(20);
    const withMain = `<body><div>sampah sisi samping yang tak perlu</div><main><p>${long}</p></main></body>`;
    expect(htmlToText(withMain).text).not.toContain("sampah sisi samping");
    const noMain = `<body><p>Paragraf pertama di body biasa tanpa main sama sekali.</p></body>`;
    expect(htmlToText(noMain).text).toContain("Paragraf pertama");
  });

  it("baris menu pendek dibuang, judul/daftar/tabel dipertahankan, duplikat berurutan disatukan", () => {
    const html = `<body><div>Home</div><div>Cari</div><h2>Judul Bagian</h2><p>Isi paragraf yang cukup panjang untuk dipertahankan.</p><p>Isi paragraf yang cukup panjang untuk dipertahankan.</p><ul><li>Butir</li></ul></body>`;
    const t = htmlToText(html).text;
    expect(t).not.toMatch(/^Home$/m);
    expect(t).toContain("### Judul Bagian");
    expect(t).toContain("- Butir");
    expect(t.match(/Isi paragraf yang cukup panjang/g)).toHaveLength(1);
  });

  it("entitas bernama/numerik/heksa didekode; entitas tak dikenal dibiarkan; kode tak sah diabaikan", () => {
    const t = htmlToText(`<body><p>Rp5 &amp; &lt;b&gt; &#8364;100 &#x20AC;200 &unknown; &#99999999; teks pengisi supaya lolos panjang.</p></body>`).text;
    expect(t).toContain("Rp5 & <b> €100 €200 &unknown;");
    expect(t).not.toContain("&#99999999;");
  });

  it("skrip/gaya/komentar/iframe/form tidak bocor, termasuk yang bersarang atribut aneh", () => {
    const t = htmlToText(`<body><!-- rahasia komentar --><script type="x">bocor()</script><style>a{}</style><iframe src=x>if</iframe><form><input value=pw>formisi</form><p>Isi sah yang cukup panjang untuk dipertahankan di sini.</p></body>`).text;
    expect(t).toBe("Isi sah yang cukup panjang untuk dipertahankan di sini.");
  });

  it("HTML rusak/kosong tidak melempar galat", () => {
    expect(() => htmlToText("")).not.toThrow();
    expect(() => htmlToText("<div><p>tak ditutup <b>")).not.toThrow();
    expect(htmlToText("").text).toBe("");
  });
});
