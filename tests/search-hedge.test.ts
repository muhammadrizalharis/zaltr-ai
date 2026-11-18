import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const PRIMARY = "http://primary.test";
const FALLBACK = "http://fallback.test";
const GOOD = (prefix: string, n = 4) => ({
  results: Array.from({ length: n }, (_, i) => ({ title: `Stunting Sulawesi ${prefix}${i}`, url: `https://${prefix}${i}.test/`, content: "stunting Sulawesi" })),
});
const JUNK = (n = 5) => ({
  results: Array.from({ length: n }, (_, i) => ({ title: `Lagu populer ${i}`, url: `https://junk${i}.test/`, content: "musik" })),
});
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });
const Q = "referensi jurnal tentang stunting di Sulawesi";

/** Permintaan yang menggantung sampai dibatalkan (meniru mesin yang tersendat). */
const hang = (init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });

async function load(env: { cacheSec?: string } = {}) {
  vi.resetModules();
  process.env.ZALTR_SEARXNG_URL = PRIMARY;
  process.env.ZALTR_SEARXNG_FALLBACK_URL = FALLBACK;
  if (env.cacheSec !== undefined) process.env.ZALTR_SEARCH_CACHE_SEC = env.cacheSec;
  else delete process.env.ZALTR_SEARCH_CACHE_SEC;
  return import("@/server/search");
}

let fetchMock: ReturnType<typeof vi.fn>;
const callsTo = (base: string) => fetchMock.mock.calls.filter((c) => String(c[0]).startsWith(base)).length;

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env.ZALTR_SEARXNG_URL;
  delete process.env.ZALTR_SEARXNG_FALLBACK_URL;
  delete process.env.ZALTR_SEARCH_CACHE_SEC;
});

describe("pencarian hedged: cadangan ikut jalan bila utama tersendat", () => {
  it("utama menggantung -> cadangan mulai setelah ~1,5 dtk dan menang; utama dibatalkan", async () => {
    let primarySignal: AbortSignal | undefined;
    fetchMock.mockImplementation((u: string, init: RequestInit) => {
      if (String(u).startsWith(PRIMARY)) {
        primarySignal = init.signal as AbortSignal;
        return hang(init);
      }
      return Promise.resolve(json(GOOD("f")));
    });
    const { webSearch } = await load();
    let result: Array<{ url: string }> | undefined;
    const p = webSearch(Q, 5).then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(callsTo(FALLBACK)).toBe(0); // belum waktunya
    await vi.advanceTimersByTimeAsync(600);
    await p;
    expect(callsTo(FALLBACK)).toBe(1);
    expect(result!.map((h) => h.url)).toContain("https://f0.test/");
    expect(primarySignal?.aborted).toBe(true); // yang kalah tidak dibiarkan berjalan
  });

  it("utama cepat & cukup (<1,5 dtk) -> cadangan TIDAK PERNAH dipanggil", async () => {
    fetchMock.mockImplementation(async () => json(GOOD("p")));
    const { webSearch } = await load();
    await webSearch(Q, 5);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(callsTo(FALLBACK)).toBe(0);
  });

  it("utama cepat tapi SAMPAH -> cadangan dimulai segera, tanpa menunggu jeda hedge", async () => {
    fetchMock.mockImplementation(async (u: string) => json(String(u).startsWith(PRIMARY) ? JUNK() : GOOD("f")));
    const { webSearch } = await load();
    const r = await webSearch(Q, 5); // tak ada kemajuan timer: harus selesai tanpa menunggu 1,5 dtk
    expect(callsTo(FALLBACK)).toBe(1);
    expect(r[0].url).toContain("f0");
  });

  it("utama lambat tapi menang sebelum cadangan selesai -> hasil utama dipakai", async () => {
    fetchMock.mockImplementation((u: string, init: RequestInit) =>
      String(u).startsWith(PRIMARY)
        ? new Promise<Response>((res) => setTimeout(() => res(json(GOOD("p"))), 2_000))
        : hang(init),
    );
    const { webSearch } = await load();
    const p = webSearch(Q, 5);
    await vi.advanceTimersByTimeAsync(2_100);
    const r = await p;
    expect(r.every((h) => h.url.includes("p"))).toBe(true);
    expect(callsTo(FALLBACK)).toBe(1); // sempat dimulai oleh hedge, lalu dibatalkan
  });

  it("keduanya sampah -> digabung & diurutkan, tak ada yang melempar galat", async () => {
    fetchMock.mockImplementation(async () => json(JUNK(3)));
    const { webSearch } = await load();
    const r = await webSearch(Q, 6);
    expect(r.length).toBeGreaterThan(0);
  });

  it("utama kehabisan waktu & cadangan error -> melempar galat utama setelah keduanya selesai", async () => {
    // AbortSignal.timeout memakai timer asli, jadi timeout utama ditiru dengan setTimeout (yang dipalsukan).
    fetchMock.mockImplementation((u: string) =>
      String(u).startsWith(PRIMARY)
        ? new Promise<Response>((_, rej) => setTimeout(() => rej(new Error("timeout utama")), 10_000))
        : Promise.resolve(json({}, 502)),
    );
    const { webSearch } = await load();
    const p = webSearch(Q, 5).then(
      () => "ok",
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(11_000);
    expect(await p).toBe("timeout utama");
  });
});

describe("cache hasil pencarian", () => {
  it("kueri sama dua kali -> hanya satu panggilan ke mesin", async () => {
    fetchMock.mockImplementation(async () => json(GOOD("p")));
    const { webSearch } = await load();
    const a = await webSearch(Q, 5);
    const b = await webSearch(Q, 5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });

  it("kunci cache dinormalisasi: huruf besar/spasi ganda sama, tetapi max & mode ilmiah berbeda", async () => {
    fetchMock.mockImplementation(async () => json(GOOD("p", 8)));
    const { webSearch } = await load();
    await webSearch(Q, 5);
    await webSearch("  " + Q.toUpperCase().replace(/ /g, "  ") + " ", 5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await webSearch(Q, 3); // max berbeda
    await webSearch(Q, 5, { science: true }); // mode berbeda
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("kedaluwarsa setelah TTL (10 menit) -> ambil ulang", async () => {
    fetchMock.mockImplementation(async () => json(GOOD("p")));
    const { webSearch } = await load();
    await webSearch(Q, 5);
    await vi.advanceTimersByTimeAsync(9 * 60_000);
    await webSearch(Q, 5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    await webSearch(Q, 5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("hasil KOSONG dan GALAT tidak di-cache (bisa saja sementara)", async () => {
    fetchMock.mockImplementation(async (u: string) => json(String(u).startsWith(PRIMARY) ? { results: [] } : { results: [] }));
    const { webSearch } = await load();
    expect(await webSearch(Q, 5)).toEqual([]);
    await webSearch(Q, 5);
    expect(callsTo(PRIMARY)).toBe(2);

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => json({}, 500));
    const m2 = await load();
    await expect(m2.webSearch(Q, 5)).rejects.toThrow();
    fetchMock.mockImplementation(async () => json(GOOD("p")));
    expect((await m2.webSearch(Q, 5)).length).toBeGreaterThan(0); // pulih tanpa terhalang cache galat
  });

  it("permintaan identik yang bersamaan berbagi SATU panggilan", async () => {
    let release!: () => void;
    fetchMock.mockImplementation(() => new Promise<Response>((res) => (release = () => res(json(GOOD("p"))))));
    const { webSearch } = await load();
    const [p1, p2, p3] = [webSearch(Q, 5), webSearch(Q, 5), webSearch(Q, 5)];
    await vi.advanceTimersByTimeAsync(10);
    release();
    const all = await Promise.all([p1, p2, p3]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(all[1]).toEqual(all[0]);
  });

  it("hasil yang dikembalikan adalah salinan: mengubahnya tak merusak cache", async () => {
    fetchMock.mockImplementation(async () => json(GOOD("p")));
    const { webSearch } = await load();
    const a = await webSearch(Q, 5);
    a[0].title = "DIRUSAK";
    a.pop();
    const b = await webSearch(Q, 5);
    expect(b[0].title).not.toBe("DIRUSAK");
    expect(b.length).toBeGreaterThan(a.length);
  });

  it("ZALTR_SEARCH_CACHE_SEC=0 menonaktifkan cache", async () => {
    fetchMock.mockImplementation(async () => json(GOOD("p")));
    const { webSearch } = await load({ cacheSec: "0" });
    await webSearch(Q, 5);
    await webSearch(Q, 5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("jumlah entri dibatasi (tak tumbuh tanpa batas)", async () => {
    fetchMock.mockImplementation(async () => json(GOOD("p")));
    const { webSearch } = await load();
    for (let i = 0; i < 230; i++) await webSearch(`kueri unik nomor ${i} stunting`, 5);
    expect(fetchMock).toHaveBeenCalledTimes(230);
    fetchMock.mockClear();
    await webSearch("kueri unik nomor 0 stunting", 5); // sudah tergusur (paling lama)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockClear();
    await webSearch("kueri unik nomor 229 stunting", 5); // terbaru masih ada
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
