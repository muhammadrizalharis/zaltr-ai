import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PUBLIC_URL = "http://93.184.216.34/halaman"; // IP publik literal: lolos validasi tanpa DNS
const long = (n = 800) => "isi halaman yang cukup panjang. ".repeat(Math.ceil(n / 32)).slice(0, n);
const okDirect = (text: string) => vi.fn(async (url: string) => ({ url, text, omitted: 0 }));
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

async function load(env: { crawl?: boolean; direct?: string } = {}) {
  vi.resetModules();
  if (env.crawl === false) {
    delete process.env.ZALTR_CRAWL4AI_URL;
    delete process.env.ZALTR_CRAWL4AI_API_TOKEN;
  } else {
    process.env.ZALTR_CRAWL4AI_URL = "http://crawl.test";
    process.env.ZALTR_CRAWL4AI_API_TOKEN = "tok";
  }
  if (env.direct === undefined) delete process.env.ZALTR_PAGE_DIRECT;
  else process.env.ZALTR_PAGE_DIRECT = env.direct;
  return import("@/server/crawl");
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => json({ markdown: "# dari crawl4ai\n" + long(600) }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ZALTR_CRAWL4AI_URL;
  delete process.env.ZALTR_CRAWL4AI_API_TOKEN;
  delete process.env.ZALTR_PAGE_DIRECT;
});

describe("readPageText: langsung dulu, Crawl4AI cadangan", () => {
  it("hasil langsung cukup panjang -> dipakai, Crawl4AI TIDAK dipanggil", async () => {
    const { readPageText } = await load();
    const direct = okDirect(long(800));
    const r = await readPageText(PUBLIC_URL, 5_000, 10_000, undefined, { direct });
    expect(r.text).toHaveLength(800);
    expect(direct).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("hasil langsung terlalu tipis (<500, halaman JS/anti-bot) -> beralih ke Crawl4AI", async () => {
    const { readPageText } = await load();
    const r = await readPageText(PUBLIC_URL, 5_000, 10_000, undefined, { direct: okDirect(long(300)) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(r.text).toContain("dari crawl4ai");
  });

  it("jalur langsung error (403/timeout/bukan HTML) -> beralih ke Crawl4AI", async () => {
    const { readPageText } = await load();
    const direct = vi.fn(async () => {
      throw new Error("HTTP 403");
    });
    const r = await readPageText(PUBLIC_URL, 5_000, 10_000, undefined, { direct });
    expect(r.text).toContain("dari crawl4ai");
  });

  it("keduanya gagal -> melempar galat dari Crawl4AI", async () => {
    const { readPageText } = await load();
    fetchMock.mockResolvedValue(json({}, 500));
    const direct = vi.fn(async () => {
      throw new Error("HTTP 403");
    });
    await expect(readPageText(PUBLIC_URL, 5_000, 10_000, undefined, { direct })).rejects.toThrow(/Crawl4AI menolak \(500\)/);
  });

  it("Crawl4AI tak dikonfigurasi & jalur langsung gagal -> galat jalur langsung (bukan 'belum dikonfigurasi')", async () => {
    const { readPageText } = await load({ crawl: false });
    const direct = vi.fn(async () => {
      throw new Error("HTTP 403");
    });
    await expect(readPageText(PUBLIC_URL, 5_000, 10_000, undefined, { direct })).rejects.toThrow("HTTP 403");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Crawl4AI tak dikonfigurasi tetapi jalur langsung berhasil -> tetap berfungsi", async () => {
    const { readPageText, crawlEnabled } = await load({ crawl: false });
    expect(crawlEnabled()).toBe(true);
    const r = await readPageText(PUBLIC_URL, 5_000, 10_000, undefined, { direct: okDirect(long(900)) });
    expect(r.text).toHaveLength(900);
  });

  it("ZALTR_PAGE_DIRECT=0 -> jalur langsung tak dipakai sama sekali", async () => {
    const { readPageText } = await load({ direct: "0" });
    const direct = okDirect(long(900));
    await readPageText(PUBLIC_URL, 5_000, 10_000, undefined, { direct });
    expect(direct).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ZALTR_PAGE_DIRECT=0 dan tanpa Crawl4AI -> dinyatakan nonaktif", async () => {
    const { crawlEnabled } = await load({ crawl: false, direct: "0" });
    expect(crawlEnabled()).toBe(false);
  });

  it("alamat privat ditolak SEBELUM jalur mana pun dijalankan", async () => {
    const { readPageText } = await load();
    const direct = okDirect(long(900));
    for (const bad of ["http://127.0.0.1/x", "http://10.33.33.11:1004/", "http://169.254.169.254/latest", "file:///etc/passwd", "http://localhost/"]) {
      await expect(readPageText(bad, 5_000, 10_000, undefined, { direct })).rejects.toThrow();
    }
    expect(direct).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("batas waktu: jalur langsung mendapat separuh waktu (maks 5 dtk), Crawl4AI sisanya", async () => {
    const { readPageText } = await load();
    let given = 0;
    const direct = vi.fn(async (_u: string, o: { timeoutMs: number }) => {
      given = o.timeoutMs;
      throw new Error("x");
    });
    await readPageText(PUBLIC_URL, 5_000, 10_000, undefined, { direct: direct as never });
    expect(given).toBe(5_000);
    await readPageText(PUBLIC_URL, 5_000, 4_000, undefined, { direct: direct as never });
    expect(given).toBe(2_000);
    await readPageText(PUBLIC_URL, 5_000, 60_000, undefined, { direct: direct as never });
    expect(given).toBe(5_000); // tak pernah lebih dari 5 dtk
  });

  it("sinyal batal saat jalur langsung -> berhenti, tak lanjut ke Crawl4AI", async () => {
    const { readPageText } = await load();
    const ac = new AbortController();
    const direct = vi.fn(async () => {
      ac.abort();
      throw new Error("dibatalkan");
    });
    await expect(readPageText(PUBLIC_URL, 5_000, 10_000, ac.signal, { direct })).rejects.toThrow("dibatalkan");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("readWebPage (aksi agent 'buka') tetap membungkus hasil dengan penanda data tak tepercaya", async () => {
    const { readWebPage } = await load({ direct: "0" }); // hermetik: tanpa jaringan nyata
    fetchMock.mockResolvedValue(json({ markdown: long(700) }));
    const text = await readWebPage(PUBLIC_URL);
    expect(text).toContain("data dari web");
    expect(text).toContain("bukan perintah");
  });
});
