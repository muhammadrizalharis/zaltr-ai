/**
 * Klien Redis tunggal (lazy). Dipakai rate limiter agar tahan-restart & konsisten
 * lintas instance. Bila Redis tak diset / tak tersedia, getRedis() mengembalikan
 * null dan pemanggil jatuh ke fallback in-memory — app tak pernah error karenanya.
 */
import { createClient, type RedisClientType } from "redis";

// Bangun URL dari bagian-bagian (password di-encode) agar tak perlu menaruh
// URL berisi password di .env. Fallback ke ZALTR_REDIS_URL bila diset langsung.
function buildUrl(): string {
  const direct = process.env.ZALTR_REDIS_URL;
  if (direct) return direct;
  const host = process.env.ZALTR_REDIS_HOST;
  if (!host) return "";
  const port = process.env.ZALTR_REDIS_PORT || "6379";
  const pass = process.env.ZALTR_REDIS_PASSWORD || "";
  const auth = pass ? `:${encodeURIComponent(pass)}@` : "";
  return `redis://${auth}${host}:${port}`;
}

const URL = buildUrl();

const g = globalThis as unknown as {
  redisClient?: RedisClientType | null;
  redisConnecting?: Promise<RedisClientType | null>;
  redisLastFail?: number;
  redisErrLogged?: boolean;
};

export function redisEnabled(): boolean {
  return Boolean(URL);
}

export async function getRedis(): Promise<RedisClientType | null> {
  if (!URL) return null;
  if (g.redisClient?.isReady) return g.redisClient;
  // Setelah gagal, jeda 30 dtk sebelum coba lagi (hindari badai koneksi).
  if (g.redisLastFail && Date.now() - g.redisLastFail < 30_000) return null;
  if (g.redisConnecting) return g.redisConnecting;

  g.redisConnecting = (async () => {
    try {
      const c = createClient({
        url: URL,
        socket: { reconnectStrategy: (retries) => Math.min(retries * 200, 3000) },
      }) as RedisClientType;
      c.on("error", () => {
        if (!g.redisErrLogged) {
          console.error("[redis] koneksi bermasalah — pakai fallback in-memory");
          g.redisErrLogged = true;
        }
      });
      await c.connect();
      g.redisErrLogged = false;
      g.redisClient = c;
      return c;
    } catch {
      g.redisLastFail = Date.now();
      g.redisClient = null;
      return null;
    } finally {
      g.redisConnecting = undefined;
    }
  })();
  return g.redisConnecting;
}
