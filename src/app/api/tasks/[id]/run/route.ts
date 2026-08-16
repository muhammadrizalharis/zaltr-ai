import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";
import { runTask } from "@/server/tasks";

export const runtime = "nodejs";
export const maxDuration = 200;

type Params = { params: Promise<{ id: string }> };

/** POST: jalankan tugas SEKARANG (juga dipakai untuk uji). */
export const POST = guarded(async (_req: Request, { params }: Params) => {
  const me = await requireUser();
  const { id } = await params;
  const owned = await db.scheduledTask.findFirst({ where: { id, userId: me.id }, select: { id: true } });
  if (!owned) return Response.json({ error: "Tidak ditemukan" }, { status: 404 });
  const res = await runTask(id);
  return Response.json(res, { status: res.ok ? 200 : 422 });
});
