import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(300).nullable().optional(),
  instructions: z.string().max(8000).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
});

/** PATCH: ubah assistant milik user. */
export const PATCH = guarded(async (req: Request, { params }: Params) => {
  const me = await requireUser();
  const { id } = await params;
  const body = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return Response.json({ error: "Data tidak valid" }, { status: 400 });
  const owned = await db.assistant.findFirst({ where: { id, userId: me.id }, select: { id: true } });
  if (!owned) return Response.json({ error: "Tidak ditemukan" }, { status: 404 });
  const assistant = await db.assistant.update({
    where: { id },
    data: {
      ...(body.data.name !== undefined ? { name: body.data.name } : {}),
      ...(body.data.description !== undefined ? { description: body.data.description } : {}),
      ...(body.data.instructions !== undefined ? { instructions: body.data.instructions } : {}),
      ...(body.data.model !== undefined ? { model: body.data.model } : {}),
    },
    select: { id: true, name: true, description: true, instructions: true, model: true },
  });
  return Response.json({ assistant });
});

/** DELETE: hapus assistant (percakapan tetap ada, assistantId jadi null). */
export const DELETE = guarded(async (_req: Request, { params }: Params) => {
  const me = await requireUser();
  const { id } = await params;
  const owned = await db.assistant.findFirst({ where: { id, userId: me.id }, select: { id: true } });
  if (!owned) return Response.json({ error: "Tidak ditemukan" }, { status: 404 });
  await db.assistant.delete({ where: { id } });
  return new Response(null, { status: 204 });
});
