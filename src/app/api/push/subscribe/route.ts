import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";

export const runtime = "nodejs";

/** Simpan langganan Web Push milik user (upsert by endpoint). */
export const POST = guarded(async (req: Request) => {
  const me = await requireUser();
  const body = (await req.json().catch(() => null)) as {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
    ua?: string;
  } | null;
  if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return Response.json({ error: "Langganan tidak valid" }, { status: 400 });
  }
  await db.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    create: {
      userId: me.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      ua: body.ua?.slice(0, 200) ?? null,
    },
    update: { userId: me.id, p256dh: body.keys.p256dh, auth: body.keys.auth },
  });
  return Response.json({ ok: true });
});

/** Hapus langganan (berhenti berlangganan). */
export const DELETE = guarded(async (req: Request) => {
  await requireUser();
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  if (endpoint) await db.pushSubscription.deleteMany({ where: { endpoint } });
  return Response.json({ ok: true });
});
