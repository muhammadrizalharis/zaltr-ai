import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  instructions: z.string().max(4000).nullable().optional(),
});

export const PATCH = guarded(async (req: Request, { params }: Params) => {
  const me = await requireUser();
  const { id } = await params;
  const body = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success || (body.data.name === undefined && body.data.instructions === undefined)) {
    return NextResponse.json({ error: "Data project tidak valid" }, { status: 400 });
  }
  const owned = await db.project.findFirst({ where: { id, userId: me.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
  const project = await db.project.update({
    where: { id },
    data: {
      ...(body.data.name !== undefined ? { name: body.data.name } : {}),
      ...(body.data.instructions !== undefined ? { instructions: body.data.instructions } : {}),
    },
    select: { id: true, name: true, instructions: true },
  });
  return NextResponse.json({ project });
});

/**
 * Hapus project: chat di dalamnya TIDAK dihapus — dikeluarkan dari project
 * (projectId=null, sesuai kontrak persistensi README).
 */
export const DELETE = guarded(async (_req: Request, { params }: Params) => {
  const me = await requireUser();
  const { id } = await params;
  const owned = await db.project.findFirst({ where: { id, userId: me.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
  await db.$transaction([
    db.conversation.updateMany({ where: { projectId: id }, data: { projectId: null } }),
    db.project.delete({ where: { id } }),
  ]);
  return NextResponse.json({ ok: true });
});
