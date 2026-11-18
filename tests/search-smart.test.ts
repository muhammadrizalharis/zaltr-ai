import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const WEB = { results: [{ title: "T", url: "https://web.test/1", content: "c" }] };
const SCI = { results: [{ title: "S", url: "https://arxiv.test/1", content: "c" }] };

describe("webSearchSmart: batas tunggu mesin ilmiah", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ZALTR_SEARXNG_URL = "http://searx.test";
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.ZALTR_SEARXNG_URL;
  });

  const isScience = (url: unknown) => String(url).includes("categories=science");
  const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });

  it("mesin ilmiah menggantung -> hasil web biasa kembali setelah ~9 dtk (bukan 20)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (isScience(url) ? new Promise(() => {}) : json(WEB))));
    const { webSearchSmart } = await import("@/server/search");
    let result: Array<{ url: string }> | undefined;
    const p = webSearchSmart("cari jurnal tentang stunting").then((r) => (result = r));
    await vi.advanceTimersByTimeAsync(8_000);
    expect(result).toBeUndefined(); // masih menunggu mesin ilmiah
    await vi.advanceTimersByTimeAsync(1_500);
    await p;
    expect(result?.map((r) => r.url)).toEqual(["https://web.test/1"]);
  });

  it("mesin ilmiah cepat -> digabung tanpa menunggu batas 9 dtk, hasil ilmiah di depan", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => json(isScience(url) ? SCI : WEB)));
    const { webSearchSmart } = await import("@/server/search");
    const r = await webSearchSmart("cari jurnal tentang stunting");
    expect(r.map((x) => x.url)).toEqual(["https://arxiv.test/1", "https://web.test/1"]);
    expect(vi.getTimerCount()).toBe(0); // timer batas tunggu dibersihkan (tak bocor)
  });

  it("query non-akademik -> hanya pencarian web, mesin ilmiah tak dipanggil", async () => {
    const f = vi.fn(async () => json(WEB));
    vi.stubGlobal("fetch", f);
    const { webSearchSmart } = await import("@/server/search");
    await webSearchSmart("resep nasi goreng");
    expect(f).toHaveBeenCalledTimes(1);
    expect(String(f.mock.calls[0])).not.toContain("categories=science");
  });

  it("mesin ilmiah error -> tetap kembalikan hasil web", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (isScience(url) ? new Response("x", { status: 500 }) : json(WEB))));
    const { webSearchSmart } = await import("@/server/search");
    expect((await webSearchSmart("cari jurnal tentang stunting")).map((x) => x.url)).toEqual(["https://web.test/1"]);
  });
});
