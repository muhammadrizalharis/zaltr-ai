import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { cookies, headers } from "next/headers";
import { db } from "@/lib/db";

const scrypt = promisify(scryptCb);

export const SESSION_COOKIE = "zaltr_session";
const SESSION_DAYS = 30;

/**
 * Cookie Secure per-request: ikuti protokol yang dipakai pengunjung
 * (x-forwarded-proto dari tunnel/proxy HTTPS), fallback ZALTR_PUBLIC_URL.
 * Dengan ini login jalan BAIK via HTTPS (ngrok/domain) MAUPUN HTTP intranet.
 */
export async function cookieSecure(): Promise<boolean> {
  try {
    const h = await headers();
    const proto = h.get("x-forwarded-proto");
    if (proto) return proto.split(",")[0].trim() === "https";
  } catch {
    // di luar konteks request (mis. script) -> pakai fallback env
  }
  return (process.env.ZALTR_PUBLIC_URL ?? "").startsWith("https://");
}

// ---------- Password (scrypt, tanpa dependency eksternal) ----------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, expected] = stored.split(":");
  if (!salt || !expected) return false;
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  const expectedBuf = Buffer.from(expected, "hex");
  return hash.length === expectedBuf.length && timingSafeEqual(hash, expectedBuf);
}

// ---------- Session (token acak; DB hanya menyimpan sha256-nya) ----------

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await cookieSecure(),
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  jar.delete(SESSION_COOKIE);
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  status: string;
  creditBalance: number;
  creditUsed: number;
  allowedModels: string[];
  plan: string;
  dailyMsgLimit: number | null;
  customInstructions: string | null;
}

/** Ambil user dari cookie session; null bila tidak login/kedaluwarsa. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      expiresAt: true,
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
        },
      },
    },
  });
  if (!session) return null;
  if (session.expiresAt < new Date()) {
    await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
    return null;
  }
  if (session.user.status !== "active") return null;
  return session.user;
}

/** Guard API: user login aktif; lempar Response 401 bila tidak. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new Response(JSON.stringify({ error: "Harus login" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return user;
}

/** Guard API: role admin/superadmin. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin" && user.role !== "superadmin") {
    throw new Response(JSON.stringify({ error: "Khusus admin" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return user;
}

/** Bungkus handler agar throw Response dari guard menjadi respons rapi. */
export function guarded<T extends unknown[]>(
  handler: (...args: T) => Promise<Response>,
): (...args: T) => Promise<Response> {
  return async (...args: T) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof Response) return err;
      throw err;
    }
  };
}

// ---------- Allowlist model per user ----------

/** Pola: "*" (semua), "copilot:*" (satu provider), atau id model persis. */
export function modelAllowed(patterns: string[], modelId: string): boolean {
  return patterns.some(
    (p) =>
      p === "*" ||
      p === modelId ||
      (p.endsWith(":*") && modelId.startsWith(p.slice(0, -1))),
  );
}
