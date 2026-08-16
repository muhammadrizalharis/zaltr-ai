import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

function shareUrl(token: string): string {
  const base = (process.env.ZALTR_PUBLIC_URL ?? "").replace(/\/$/, "");
  return `${base}/share/${token}`;
}

/** POST: aktifkan berbagi read-only (buat token bila belum ada). */
export const POST = guarded(async (_req: Request, { params }: Params) => {
  const me = await requireUser();
  const { id } = await params;
  const convo = await db.conversation.findFirst({
    where: { id, userId: me.id },
    select: { id: true, shareToken: true },
  });
  if (!convo) return Response.json({ error: "Tidak ditemukan" }, { status: 404 });
  let token = convo.shareToken;
  if (!token) {
    token = randomUUID().replace(/-/g, "");
    await db.conversation.update({ where: { id }, data: { shareToken: token } });
  }
  return Response.json({ token, url: shareUrl(token) });
});

/** DELETE: matikan berbagi (hapus token). */
export const DELETE = guarded(async (_req: Request, { params }: Params) => {
  const me = await requireUser();
  const { id } = await params;
  const convo = await db.conversation.findFirst({ where: { id, userId: me.id }, select: { id: true } });
  if (!convo) return Response.json({ error: "Tidak ditemukan" }, { status: 404 });
  await db.conversation.update({ where: { id }, data: { shareToken: null } });
  return new Response(null, { status: 204 });
});
