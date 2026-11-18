import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PRIMARY = "http://primary.test";
const FALLBACK = "http://fallback.test";
const hits = (prefix: string, n: number) => ({
  results: Array.from({ length: n }, (_, i) => ({ title: `${prefix}${i}`, url: `https://${prefix}${i}.test/`, content: "c" })),
});
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

async function load(env: { primary?: string; fallback?: string }) {
  vi.resetModules();
  if (env.primary) process.env.ZALTR_SEARXNG_URL = env.primary;
  else delete process.env.ZALTR_SEARXNG_URL;
  if (env.fallback) process.env.ZALTR_SEARXNG_FALLBACK_URL = env.fallback;
  else delete process.env.ZALTR_SEARXNG_FALLBACK_URL;
  return import("@/server/search");
}

describe("webSearch: instance cadangan", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ZALTR_SEARXNG_URL;
    delete process.env.ZALTR_SEARXNG_FALLBACK_URL;
  });

  const urlsCalled = () => fetchMock.mock.calls.map((c) => String(c[0]).split("/search")[0]);

  it("utama cukup hasil (>=3) -> cadangan TIDAK dipanggil", async () => {
    fetchMock.mockResolvedValue(json(hits("a", 5)));
    const { webSearch } = await load({ primary: PRIMARY, fallback: FALLBACK });
    const r = await webSearch("q", 5);
    expect(r).toHaveLength(5);
    expect(urlsCalled()).toEqual([PRIMARY]);
  });

  it("utama kosong (mesin diblokir) -> memakai cadangan", async () => {
    fetchMock.mockImplementation(async (u: string) => json(String(u).startsWith(PRIMARY) ? { results: [] } : hits("f", 4)));
    const { webSearch } = await load({ primary: PRIMARY, fallback: FALLBACK });
    const r = await webSearch("q", 5);
    expect(r.map((x) => x.title)).toEqual(["f0", "f1", "f2", "f3"]);
    expect(urlsCalled()).toEqual([PRIMARY, FALLBACK]);
  });

  it("utama error (500/timeout) -> memakai cadangan", async () => {
    fetchMock.mockImplementation(async (u: string) => (String(u).startsWith(PRIMARY) ? json({}, 500) : json(hits("f", 2))));
    const { webSearch } = await load({ primary: PRIMARY, fallback: FALLBACK });
    expect((await webSearch("q", 5)).map((x) => x.title)).toEqual(["f0", "f1"]);
  });

  it("utama hanya 1-2 hasil -> digabung dengan cadangan tanpa URL ganda, utama di depan, dibatasi max", async () => {
    fetchMock.mockImplementation(async (u: string) =>
      json(
        String(u).startsWith(PRIMARY)
          ? { results: [{ title: "p0", url: "https://dup.test/", content: "" }] }
          : { results: [{ title: "dup", url: "https://dup.test/", content: "" }, ...hits("f", 6).results] },
      ),
    );
    const { webSearch } = await load({ primary: PRIMARY, fallback: FALLBACK });
    const r = await webSearch("q", 4);
    expect(r.map((x) => x.url)).toEqual(["https://dup.test/", "https://f0.test/", "https://f1.test/", "https://f2.test/"]);
    expect(r[0].title).toBe("p0"); // hasil utama menang atas duplikat dari cadangan
  });

  it("utama kosong & cadangan error -> kembali kosong tanpa melempar (bukan galat palsu)", async () => {
    fetchMock.mockImplementation(async (u: string) => (String(u).startsWith(PRIMARY) ? json({ results: [] }) : json({}, 502)));
    const { webSearch } = await load({ primary: PRIMARY, fallback: FALLBACK });
    // utama menjawab sah (0 hasil); kegagalan cadangan tak boleh disalahartikan sebagai galat pencarian
    expect(await webSearch("q", 5)).toEqual([]);
  });

  it("utama TIDAK dikonfigurasi & cadangan error -> melempar (tak ada yang menjawab)", async () => {
    fetchMock.mockResolvedValue(json({}, 502));
    const { webSearch } = await load({ fallback: FALLBACK });
    await expect(webSearch("q", 5)).rejects.toThrow(/502/);
  });

  it("utama error & cadangan error -> melempar galat utama", async () => {
    fetchMock.mockResolvedValue(json({}, 503));
    const { webSearch } = await load({ primary: PRIMARY, fallback: FALLBACK });
    await expect(webSearch("q", 5)).rejects.toThrow(/503/);
  });

  it("tanpa cadangan -> perilaku lama persis (1 panggilan, hasil kosong = kosong)", async () => {
    fetchMock.mockResolvedValue(json({ results: [] }));
    const { webSearch } = await load({ primary: PRIMARY });
    expect(await webSearch("q", 5)).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hanya cadangan terkonfigurasi (tanpa utama) -> tetap jalan", async () => {
    fetchMock.mockResolvedValue(json(hits("f", 3)));
    const { webSearch } = await load({ fallback: FALLBACK });
    expect(await webSearch("q", 5)).toHaveLength(3);
    expect(urlsCalled()).toEqual([FALLBACK]);
  });

  it("tak ada satu pun URL terkonfigurasi -> galat jelas", async () => {
    const { webSearch } = await load({});
    await expect(webSearch("q")).rejects.toThrow(/belum dikonfigurasi/);
  });

  it("mode ilmiah juga memakai cadangan (kategori science diteruskan)", async () => {
    fetchMock.mockImplementation(async (u: string) => json(String(u).startsWith(PRIMARY) ? { results: [] } : hits("s", 3)));
    const { webSearch } = await load({ primary: PRIMARY, fallback: FALLBACK });
    const r = await webSearch("q", 5, { science: true });
    expect(r).toHaveLength(3);
    expect(String(fetchMock.mock.calls[1][0])).toContain("categories=science");
  });

  describe("relevansi, bukan sekadar jumlah", () => {
    const junk = (n: number) => ({
      results: Array.from({ length: n }, (_, i) => ({ title: `Fitz and The Tantrums ${i}`, url: `https://junk${i}.test/`, content: "lagu populer" })),
    });
    const good = (n: number) => ({
      results: Array.from({ length: n }, (_, i) => ({ title: `Determinan stunting Sulawesi ${i}`, url: `https://good${i}.test/`, content: "jurnal stunting" })),
    });
    const Q = "referensi jurnal tentang stunting di Sulawesi";

    it("utama menjawab 10 hasil SAMPAH (mesin diblokir) -> cadangan tetap dipakai & hasil relevan didahulukan", async () => {
      fetchMock.mockImplementation(async (u: string) => json(String(u).startsWith(PRIMARY) ? junk(10) : good(4)));
      const { webSearch } = await load({ primary: PRIMARY, fallback: FALLBACK });
      const r = await webSearch(Q, 6);
      expect(urlsCalled()).toEqual([PRIMARY, FALLBACK]);
      expect(r.slice(0, 4).every((h) => h.url.includes("good"))).toBe(true);
      expect(r).toHaveLength(6);
    });

    it("utama punya >=2 hasil relevan -> cadangan TIDAK dipanggil", async () => {
      fetchMock.mockResolvedValue(json(good(5)));
      const { webSearch } = await load({ primary: PRIMARY, fallback: FALLBACK });
      await webSearch(Q, 5);
      expect(urlsCalled()).toEqual([PRIMARY]);
    });

    it("utama hanya 1 relevan di antara sampah -> cadangan dipakai", async () => {
      const mix = { results: [...good(1).results, ...junk(6).results] };
      fetchMock.mockImplementation(async (u: string) => json(String(u).startsWith(PRIMARY) ? mix : good(3)));
      const { webSearch } = await load({ primary: PRIMARY, fallback: FALLBACK });
      const r = await webSearch(Q, 5);
      expect(urlsCalled()).toEqual([PRIMARY, FALLBACK]);
      expect(r.filter((h) => h.url.includes("good")).length).toBeGreaterThanOrEqual(3);
    });

    it("utama sampah & cadangan gagal -> tetap kembalikan hasil utama (lebih baik daripada kosong)", async () => {
      fetchMock.mockImplementation(async (u: string) => (String(u).startsWith(PRIMARY) ? json(junk(4)) : json({}, 502)));
      const { webSearch } = await load({ primary: PRIMARY, fallback: FALLBACK });
      expect(await webSearch(Q, 5)).toHaveLength(4);
    });

    it("tanpa cadangan: hasil utama tetap diurutkan menurut kecocokan topik, tak ada yang dibuang", async () => {
      fetchMock.mockResolvedValue(json({ results: [...junk(2).results, ...good(2).results] }));
      const { webSearch } = await load({ primary: PRIMARY });
      const r = await webSearch(Q, 5);
      expect(r).toHaveLength(4);
      expect(r.slice(0, 2).every((h) => h.url.includes("good"))).toBe(true);
    });
  });
});
