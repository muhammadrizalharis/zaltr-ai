import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({ name: z.string().trim().min(1).max(80) });

export const PATCH = guarded(async (req: Request, { params }: Params) => {
  const me = await requireUser();
  const { id } = await params;
  const body = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Nama project tidak valid" }, { status: 400 });
  }
  const owned = await db.project.findFirst({ where: { id, userId: me.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
  const project = await db.project.update({
    where: { id },
    data: { name: body.data.name },
    select: { id: true, name: true },
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
