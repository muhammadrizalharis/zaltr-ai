import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({ name: z.string().trim().min(1).max(80) });

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const body = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Nama project tidak valid" }, { status: 400 });
  }
  const project = await db.project
    .update({ where: { id }, data: { name: body.data.name }, select: { id: true, name: true } })
    .catch(() => null);
  if (!project) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
  return NextResponse.json({ project });
}

/**
 * Hapus project: chat di dalamnya TIDAK dihapus — dikeluarkan dari project
 * (projectId=null, sesuai kontrak persistensi README).
 */
export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const deleted = await db
    .$transaction([
      db.conversation.updateMany({ where: { projectId: id }, data: { projectId: null } }),
      db.project.delete({ where: { id } }),
    ])
    .catch(() => null);
  if (!deleted) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
