import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { applyAccessPolicy, type SessionUser } from "@/server/auth";

/**
 * API key untuk gateway OpenAI-compatible (/v1). Format: sk-calyzr-<48 hex>.
 * DB hanya menyimpan sha256-nya; raw ditampilkan sekali saat dibuat.
 * Akses via key TETAP tunduk allowedModels + kredit + limit harian user.
 */
const PREFIX = "sk-calyzr-";

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export type ApiUser = SessionUser & { apiKeyId: string };

/** Buat key baru; kembalikan raw (TAMPIL SEKALI) + metadata. */
export async function createApiKey(userId: string, name: string) {
  const raw = PREFIX + randomBytes(24).toString("hex");
  const rec = await db.apiKey.create({
    data: {
      userId,
      name: name.trim().slice(0, 60) || "API key",
      keyHash: sha256(raw),
      prefix: raw.slice(0, PREFIX.length + 6),
    },
    select: { id: true, name: true, prefix: true, createdAt: true },
  });
  return { raw, ...rec };
}

export async function listApiKeys(userId: string) {
  return db.apiKey.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, prefix: true, lastUsedAt: true, createdAt: true },
  });
}

export async function revokeApiKey(userId: string, id: string): Promise<boolean> {
  const r = await db.apiKey.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return r.count > 0;
}

/** Autentikasi request via header `Authorization: Bearer sk-calyzr-...`. */
export async function userFromApiKey(req: Request): Promise<ApiUser | null> {
  const auth = req.headers.get("authorization") ?? "";
  const raw = /^Bearer\s+(.+)$/i.exec(auth.trim())?.[1]?.trim();
  if (!raw || !raw.startsWith(PREFIX)) return null;
  const key = await db.apiKey.findUnique({
    where: { keyHash: sha256(raw) },
    select: {
      id: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          status: true,
          creditBalance: true,
          creditUsed: true,
          allowedModels: true,
          plan: true,
          dailyMsgLimit: true,
          customInstructions: true,
          creditsExpireAt: true,
        },
      },
    },
  });
  if (!key || key.revokedAt || key.user.status !== "active") return null;
  void db.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
  return { ...applyAccessPolicy(key.user), apiKeyId: key.id };
}
