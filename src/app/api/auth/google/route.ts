import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STATE_COOKIE } from "@/server/oauth";

/**
 * Mulai alur "Masuk dengan Google" (OAuth 2.0 authorization code, server-side).
 * Wajib env: ZALTR_GOOGLE_CLIENT_ID, ZALTR_GOOGLE_CLIENT_SECRET,
 * ZALTR_PUBLIC_URL (mis. http://localhost:46300).
 */
export async function GET(req: Request) {
  const clientId = process.env.ZALTR_GOOGLE_CLIENT_ID;
  const publicUrl = process.env.ZALTR_PUBLIC_URL ?? new URL(req.url).origin;
  if (!clientId || !process.env.ZALTR_GOOGLE_CLIENT_SECRET) {
    return NextResponse.redirect(
      new URL("/login?error=" + encodeURIComponent("Login Google belum dikonfigurasi admin"), publicUrl),
    );
  }

  const state = randomBytes(24).toString("hex");
  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${publicUrl}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}
