import { pushEnabled, vapidPublicKey } from "@/server/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Kunci publik VAPID untuk klien berlangganan Web Push. */
export async function GET() {
  return Response.json(
    { publicKey: vapidPublicKey(), enabled: pushEnabled() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
