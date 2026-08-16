import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";

export const runtime = "nodejs";

/** GET: daftar assistant milik user. */
export const GET = guarded(async () => {
  const me = await requireUser();
  const assistants = await db.assistant.findMany({
    where: { userId: me.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      instructions: true,
      model: true,
      _count: { select: { conversations: { where: { trashedAt: null } } } },
    },
  });
  return Response.json({ assistants });
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300).nullable().optional(),
  instructions: z.string().max(8000).nullable().optional(),
  model: z.string().max(120).nullable().optional(),
});

/** POST: buat assistant baru. */
export const POST = guarded(async (req: Request) => {
  const me = await requireUser();
  const body = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return Response.json({ error: "Data assistant tidak valid" }, { status: 400 });
  const assistant = await db.assistant.create({
    data: {
      userId: me.id,
      name: body.data.name,
      description: body.data.description ?? null,
      instructions: body.data.instructions ?? null,
      model: body.data.model ?? null,
    },
    select: { id: true, name: true, description: true, instructions: true, model: true },
  });
  return Response.json({ assistant }, { status: 201 });
});
