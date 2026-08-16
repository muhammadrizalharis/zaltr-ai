import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";

export const runtime = "nodejs";

/** GET: daftar tugas terjadwal milik user. */
export const GET = guarded(async () => {
  const me = await requireUser();
  const tasks = await db.scheduledTask.findMany({
    where: { userId: me.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      prompt: true,
      model: true,
      intervalMinutes: true,
      active: true,
      nextRunAt: true,
      lastRunAt: true,
      lastResult: true,
    },
  });
  return Response.json({ tasks });
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(8000),
  model: z.string().min(1).max(120),
  intervalMinutes: z.number().int().min(15).max(43200), // 15 menit .. 30 hari
});

/** POST: buat tugas baru (nextRunAt = sekarang + jeda). */
export const POST = guarded(async (req: Request) => {
  const me = await requireUser();
  const body = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return Response.json({ error: "Data tugas tidak valid (jeda minimal 15 menit)" }, { status: 400 });
  }
  const task = await db.scheduledTask.create({
    data: {
      userId: me.id,
      title: body.data.title,
      prompt: body.data.prompt,
      model: body.data.model,
      intervalMinutes: body.data.intervalMinutes,
      nextRunAt: new Date(Date.now() + body.data.intervalMinutes * 60_000),
    },
    select: { id: true, title: true, model: true, intervalMinutes: true, active: true, nextRunAt: true },
  });
  return Response.json({ task }, { status: 201 });
});
