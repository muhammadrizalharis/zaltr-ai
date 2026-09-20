import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Postgres menolak byte NUL (0x00) di kolom text (error 22021). Bersihkan dari
// semua input tulis (create/update/upsert) agar teks user/model yang mengandung
// \u0000 tak menggagalkan transaksi. Query mentah ($executeRaw) tak lewat sini —
// jalur itu (mis. ingest KnowledgeChunk) disanitasi di sumbernya.
function stripNul(v: unknown): unknown {
  if (typeof v === "string") return v.includes("\u0000") ? v.replace(/\u0000/g, "") : v;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = stripNul(v[i]);
    return v;
  }
  if (v && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) {
    const o = v as Record<string, unknown>;
    for (const k in o) o[k] = stripNul(o[k]);
    return o;
  }
  return v;
}

const WRITE_OPS = new Set(["create", "createMany", "update", "updateMany", "upsert"]);

function createClient() {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter }).$extends({
    query: {
      $allModels: {
        async $allOperations({ operation, args, query }) {
          if (WRITE_OPS.has(operation) && args && typeof args === "object") {
            const a = args as Record<string, unknown>;
            if (a.data) stripNul(a.data);
            if (a.create) stripNul(a.create);
            if (a.update) stripNul(a.update);
          }
          return query(args);
        },
      },
    },
  });
}

type DbClient = ReturnType<typeof createClient>;
const globalForPrisma = globalThis as unknown as { prisma?: DbClient };

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
