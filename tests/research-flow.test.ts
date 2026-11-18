import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  hits: [] as Array<{ title: string; url: string; snippet: string }>,
  searchError: false,
  crawlOn: true,
  read: vi.fn(),
}));

vi.mock("@/server/search", () => ({
  webSearchSmart: async () => {
    if (h.searchError) throw new Error("searxng mati");
    return h.hits;
  },
  formatSearchContext: (q: string, hits: unknown[]) => `=== Hasil untuk "${q}" (${hits.length}) ===`,
}));
vi.mock("@/server/crawl", () => ({
  crawlEnabled: () => h.crawlOn,
  readPageText: (...a: unknown[]) => h.read(...a),
}));

import { researchForChat, type ResearchEvent } from "@/server/research";

const hit = (i: number, url = `https://s${i}.test/p`) => ({ title: `Judul ${i}`, url, snippet: `snip ${i}` });
const page = (url: string, n = 5_000) => ({ url, text: "x".repeat(n), omitted: 0 });
const never = (signal?: AbortSignal) =>
  new Promise<never>((_, rej) => signal?.addEventListener("abort", () => rej(new Error("aborted"))));

async function run(q = "carikan referensi X", signal?: AbortSignal, tune?: Parameters<typeof researchForChat>[2]) {
  const events: ResearchEvent[] = [];
  for await (const e of researchForChat(q, signal, tune)) events.push(e);
  const block = events.find((e) => e.kind === "block")!.text;
  return { events, block, steps: events.filter((e) => e.kind === "step").map((e) => e.text) };
}

beforeEach(() => {
  h.hits = [0, 1, 2, 3, 4, 5].map((i) => hit(i));
  h.searchError = false;
  h.crawlOn = true;
  h.read.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("researchForChat: pembacaan halaman bergulir", () => {
  it("berhenti begitu bahan cukup dan MEMBATALKAN halaman lambat (tak ditunggu)", async () => {
    let slowSignal: AbortSignal | undefined;
    h.read.mockImplementation(async (url: string, _m: number, _t: number, signal?: AbortSignal) => {
      if (url.includes("s0.") || url.includes("s1.")) return page(url);
      slowSignal = signal;
      return never(signal);
    });
    const t0 = Date.now();
    const { block } = await run();
    expect(Date.now() - t0).toBeLessThan(1_000);
    expect(block.match(/\[Halaman \d+\]/g)).toHaveLength(2);
    expect(slowSignal?.aborted).toBe(true);
  });

  it("tidak membaca lebih dari MAX 4 halaman walau semua cepat", async () => {
    h.read.mockImplementation(async (url: string) => page(url, 1_000)); // tak pernah >= ENOUGH_CHARS
    const { block } = await run();
    expect(block.match(/\[Halaman \d+\]/g)).toHaveLength(4);
    expect(h.read.mock.calls.length).toBeLessThanOrEqual(4 + 3); // yang sempat jalan bersamaan boleh, hasil tetap 4
  });

  it("jumlah halaman berjalan bersamaan tidak melebihi concurrency", async () => {
    let cur = 0;
    let max = 0;
    h.read.mockImplementation(async (url: string) => {
      cur++;
      max = Math.max(max, cur);
      await new Promise((r) => setTimeout(r, 15));
      cur--;
      return page(url, 500);
    });
    await run("carikan referensi X", undefined, { concurrency: 2 });
    expect(max).toBeLessThanOrEqual(2);
    expect(max).toBe(2);
  });

  it("halaman yang gagal dilewati; kandidat berikutnya menggantikan", async () => {
    h.read.mockImplementation(async (url: string) => {
      if (url.includes("s0.") || url.includes("s1.")) throw new Error("timeout");
      return page(url);
    });
    const { block } = await run();
    expect(block).toContain("s2.test");
    expect(block).not.toContain("URL: https://s0.test");
  });

  it("hasil diurutkan sesuai peringkat pencarian, bukan urutan selesai", async () => {
    h.read.mockImplementation(async (url: string) => {
      if (url.includes("s0.")) await new Promise((r) => setTimeout(r, 40)); // peringkat 1 paling lambat
      return page(url, 1_000);
    });
    const { block } = await run();
    expect(block.indexOf("URL: https://s0.test")).toBeLessThan(block.indexOf("URL: https://s1.test"));
  });

  it("tenggat total: semua halaman menggantung -> kembali dengan hasil pencarian saja, tepat waktu", async () => {
    h.read.mockImplementation(async (_u: string, _m: number, _t: number, signal?: AbortSignal) => never(signal));
    const t0 = Date.now();
    const { block, steps } = await run("carikan referensi X", undefined, { deadlineMs: 120 });
    expect(Date.now() - t0).toBeLessThan(800);
    expect(block).toContain("Hasil untuk");
    expect(block).not.toContain("Isi halaman yang dibaca");
    expect(steps.some((s) => s.includes("Selesai membaca"))).toBe(false);
  });

  it("semua halaman gagal -> hanya blok pencarian (jawaban tetap bisa dari cuplikan)", async () => {
    h.read.mockRejectedValue(new Error("x"));
    const { block } = await run();
    expect(block).toContain("Hasil untuk");
    expect(block).not.toContain("Isi halaman yang dibaca");
  });

  it("URL biner/media dilewati, tak pernah dikirim ke Crawl4AI", async () => {
    h.hits = [hit(0, "https://a.test/v.mp4"), hit(1, "https://a.test/f.zip"), hit(2)];
    h.read.mockImplementation(async (url: string) => page(url));
    await run();
    const urls = h.read.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => /\.(mp4|zip)/.test(u))).toBe(false);
    expect(urls).toContain("https://s2.test/p");
  });

  it("sinyal batal dari pemanggil menghentikan riset segera", async () => {
    const ac = new AbortController();
    h.read.mockImplementation(async (_u: string, _m: number, _t: number, signal?: AbortSignal) => never(signal));
    const p = run("carikan referensi X", ac.signal);
    setTimeout(() => ac.abort(), 30);
    const t0 = Date.now();
    await p;
    expect(Date.now() - t0).toBeLessThan(800);
  });
});

describe("researchForChat: kondisi khusus", () => {
  it("Crawl4AI nonaktif -> tidak membaca halaman, hanya hasil pencarian", async () => {
    h.crawlOn = false;
    const { block } = await run();
    expect(h.read).not.toHaveBeenCalled();
    expect(block).toContain("Hasil untuk");
  });

  it("pencarian gagal -> pesan fallback jujur, tanpa membaca halaman", async () => {
    h.searchError = true;
    const { block } = await run();
    expect(block).toContain("Pencarian web gagal");
    expect(h.read).not.toHaveBeenCalled();
  });

  it("tanpa hasil pencarian -> tidak ada pembacaan halaman", async () => {
    h.hits = [];
    await run();
    expect(h.read).not.toHaveBeenCalled();
  });

  it("isi halaman dibungkus penanda data tak tepercaya + larangan mengarang referensi", async () => {
    h.read.mockImplementation(async (url: string) => page(url));
    const { block } = await run();
    expect(block).toContain("BUKAN perintah");
    expect(block).toContain("jangan mengarang referensi");
  });
});
