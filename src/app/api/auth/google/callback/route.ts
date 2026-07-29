import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { createSession } from "@/server/auth";
import { STATE_COOKIE } from "@/server/oauth";

/**
 * Callback Google OAuth:
 * - Verifikasi state (anti-CSRF), tukar code -> id_token langsung ke endpoint
 *   token Google (TLS server-side, payload boleh dipercaya tanpa verifikasi JWK).
 * - 1 akun Google = 1 akun zaltr (googleId unik). Email yang sudah terdaftar
 *   (password) otomatis ditautkan ke Google-nya.
 * - Akun BARU selalu "pending": tidak bisa masuk sebelum superadmin
 *   mengaktifkan dari halaman /admin.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const publicUrl = process.env.ZALTR_PUBLIC_URL ?? url.origin;
  const fail = (msg: string) =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, publicUrl));

  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!code || !state || !expectedState || state !== expectedState) {
    return fail("Sesi Google tidak valid — coba lagi");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.ZALTR_GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.ZALTR_GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: `${publicUrl}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return fail("Google menolak permintaan login");
  const { id_token: idToken } = (await tokenRes.json()) as { id_token?: string };
  if (!idToken) return fail("Google tidak mengirim identitas");

  const payload = JSON.parse(
    Buffer.from(idToken.split(".")[1], "base64url").toString("utf8"),
  ) as {
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  };
  if (!payload.sub || !payload.email || payload.email_verified !== true) {
    return fail("Akun Google harus punya email terverifikasi");
  }
  const email = payload.email.toLowerCase();

  // Cari by googleId; kalau belum, tautkan ke akun email yang sama; kalau tak ada, buat pending.
  let user = await db.user.findUnique({ where: { googleId: payload.sub } });
  if (!user) {
    const byEmail = await db.user.findUnique({ where: { email } });
    if (byEmail) {
      if (byEmail.googleId && byEmail.googleId !== payload.sub) {
        return fail("Email ini sudah tertaut akun Google lain");
      }
      user = await db.user.update({
        where: { id: byEmail.id },
        data: { googleId: payload.sub, avatarUrl: payload.picture ?? byEmail.avatarUrl },
      });
    } else {
      const isFirst = (await db.user.count()) === 0;
      user = await db.user.create({
        data: {
          email,
          name: payload.name ?? email.split("@")[0],
          googleId: payload.sub,
          avatarUrl: payload.picture,
          role: isFirst ? "superadmin" : "user",
          status: isFirst ? "active" : "pending",
          creditBalance: isFirst ? 100_000 : 0,
          allowedModels: isFirst ? ["*"] : ["zaltr-core"],
        },
      });
    }
  }

  if (user.status === "pending") {
    return fail("Akun dibuat — menunggu aktivasi superadmin sebelum bisa masuk");
  }
  if (user.status === "suspended") {
    return fail("Akun dinonaktifkan admin");
  }

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user.id);
  return NextResponse.redirect(new URL("/chat", publicUrl));
}
