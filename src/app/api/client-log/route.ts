import { headers } from "next/headers";
import { rateLimit } from "@/server/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Penerima laporan error dari browser (window.onerror / unhandledrejection).
 * Tujuannya sekadar visibilitas: dicatat ke log server (Docker logs) supaya
 * bug di HP/desktop yang tak pernah kita lihat bisa terdeteksi. Tanpa DB, tanpa
 * PII. Rate-limit per IP agar tak jadi kanal spam.
 */

function clip(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  const s = v.replace(/\s+/g, " ").trim();
  return s.length > max ? s.slice(0, max) + "…" : s;
}

export async function POST(req: Request) {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  const rl = rateLimit(`clog:${ip}`, 10, 60_000);
  if (!rl.ok) return new Response(null, { status: 204 });

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const message = clip(body.message, 500);
    if (!message) return new Response(null, { status: 204 });
    const url = clip(body.url, 300);
    const stack = clip(body.stack, 1000);
    const kind = clip(body.kind, 40) || "error";
    const ua = clip(h.get("user-agent"), 200);
    console.error(
      `[client-error] kind=${kind} ip=${ip} url=${url} ua="${ua}" msg="${message}"` +
        (stack ? ` stack="${stack}"` : ""),
    );
  } catch {
    // body tak valid -> abaikan diam-diam
  }
  return new Response(null, { status: 204 });
}
