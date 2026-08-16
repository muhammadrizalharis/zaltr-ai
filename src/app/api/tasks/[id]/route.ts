import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  prompt: z.string().trim().min(1).max(8000).optional(),
  model: z.string().min(1).max(120).optional(),
  intervalMinutes: z.number().int().min(15).max(43200).optional(),
  active: z.boolean().optional(),
});

/** PATCH: ubah tugas / aktif-nonaktif. Aktif kembali / ubah jeda -> jadwalkan ulang. */
export const PATCH = guarded(async (req: Request, { params }: Params) => {
  const me = await requireUser();
  const { id } = await params;
  const body = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return Response.json({ error: "Data tidak valid" }, { status: 400 });
  const owned = await db.scheduledTask.findFirst({
    where: { id, userId: me.id },
    select: { id: true, intervalMinutes: true },
  });
  if (!owned) return Response.json({ error: "Tidak ditemukan" }, { status: 404 });
  const d = body.data;
  const interval = d.intervalMinutes ?? owned.intervalMinutes;
  const reschedule = d.intervalMinutes !== undefined || d.active === true;
  const task = await db.scheduledTask.update({
    where: { id },
    data: {
      ...(d.title !== undefined ? { title: d.title } : {}),
      ...(d.prompt !== undefined ? { prompt: d.prompt } : {}),
      ...(d.model !== undefined ? { model: d.model } : {}),
      ...(d.intervalMinutes !== undefined ? { intervalMinutes: d.intervalMinutes } : {}),
      ...(d.active !== undefined ? { active: d.active } : {}),
      ...(reschedule ? { nextRunAt: new Date(Date.now() + interval * 60_000) } : {}),
    },
    select: { id: true, active: true, intervalMinutes: true, nextRunAt: true },
  });
  return Response.json({ task });
});

/** DELETE: hapus tugas. */
export const DELETE = guarded(async (_req: Request, { params }: Params) => {
  const me = await requireUser();
  const { id } = await params;
  const owned = await db.scheduledTask.findFirst({ where: { id, userId: me.id }, select: { id: true } });
  if (!owned) return Response.json({ error: "Tidak ditemukan" }, { status: 404 });
  await db.scheduledTask.delete({ where: { id } });
  return new Response(null, { status: 204 });
});
