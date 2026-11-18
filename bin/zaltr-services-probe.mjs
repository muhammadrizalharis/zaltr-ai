// Probe layanan dari SUDUT PANDANG aplikasi (dijalankan di dalam container web):
//   docker exec -i -w /app zaltr-web node --input-type=module < bin/zaltr-services-probe.mjs
// Keluaran: satu baris per layanan "nama<TAB>ok|fail<TAB>detail". Tidak pernah mencetak token.
const out = (name, ok, detail = "") => console.log(`${name}\t${ok ? "ok" : "fail"}\t${String(detail).replace(/\s+/g, " ").slice(0, 120)}`);
const timeout = (ms) => AbortSignal.timeout(ms);

async function check(name, fn) {
  try {
    const detail = await fn();
    out(name, true, detail);
  } catch (e) {
    out(name, false, e?.message ?? e);
  }
}

const searx = (process.env.ZALTR_SEARXNG_URL ?? "").replace(/\/$/, "");
const searxFallback = (process.env.ZALTR_SEARXNG_FALLBACK_URL ?? "").replace(/\/$/, "");
const crawl = (process.env.ZALTR_CRAWL4AI_URL ?? "").replace(/\/$/, "");
const docling = (process.env.ZALTR_DOCLING_URL ?? "").replace(/\/$/, "");

await Promise.all([
  searx &&
    check("searxng", async () => {
      // Sehat bila instance utama ATAU cadangan memberi hasil (aplikasi otomatis beralih ke cadangan).
      const count = async (base) => {
        const r = await fetch(`${base}/search?q=test&format=json`, { signal: timeout(20_000), headers: { "User-Agent": "zaltr-web" } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return ((await r.json()).results ?? []).length;
      };
      const primary = await count(searx).catch(() => 0);
      if (primary > 0) return `utama ${primary} hasil`;
      if (searxFallback) {
        const fb = await count(searxFallback).catch(() => 0);
        if (fb > 0) return `utama kosong/diblokir, memakai cadangan (${fb} hasil)`;
      }
      throw new Error("0 hasil di utama" + (searxFallback ? " dan cadangan" : "") + " (mesin diblokir?)");
    }),
  crawl &&
    check("crawl4ai", async () => {
      const r = await fetch(`${crawl}/health`, { signal: timeout(10_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return "health ok";
    }),
  docling &&
    check("docling", async () => {
      const r = await fetch(`${docling}/health`, { signal: timeout(10_000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return "health ok";
    }),
  check("copilot", async () => {
    const { CopilotClient, RuntimeConnection } = await import("@github/copilot-sdk");
    const token = process.env.ZALTR_COPILOT_CONNECTION_TOKEN;
    const client = new CopilotClient({
      connection: RuntimeConnection.forUri(process.env.ZALTR_COPILOT_URL, token ? { connectionToken: token } : undefined),
      mode: "empty",
    });
    try {
      await Promise.race([
        (async () => {
          await client.start();
          await client.ping();
        })(),
        new Promise((_, rej) => setTimeout(() => rej(new Error("timeout 15s")), 15_000)),
      ]);
      return "start+ping ok";
    } finally {
      await client.stop().catch(() => {});
    }
  }),
]);
process.exit(0);
