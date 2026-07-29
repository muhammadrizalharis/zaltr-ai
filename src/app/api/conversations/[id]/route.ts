import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const conversation = await db.conversation.findFirst({
    where: { id, trashedAt: null },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
  }
  return NextResponse.json({ conversation });
}

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  pinned: z.boolean().optional(),
  projectId: z.string().min(1).nullable().optional(),
  /** false = restore dari trash */
  trashed: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const body = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }
  if (body.data.projectId) {
    const project = await db.project.findUnique({ where: { id: body.data.projectId } });
    if (!project) {
      return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
    }
  }
  const { trashed, ...rest } = body.data;
  const data: Record<string, unknown> = { ...rest };
  if (trashed === false) data.trashedAt = null;
  if (trashed === true) data.trashedAt = new Date();
  const conversation = await db.conversation
    .update({
      where: { id },
      data,
      select: { id: true, title: true, pinned: true, projectId: true, updatedAt: true },
    })
    .catch(() => null);
  if (!conversation) {
    return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
  }
  return NextResponse.json({ conversation });
}

/**
 * DELETE default: soft delete (pindah ke trash) — kontrak persistensi README.
 * DELETE ?permanent=1: HARD DELETE — satu dari dua jalur destruktif yang
 * diizinkan kontrak; hanya boleh dari halaman Trash dengan konfirmasi.
 */
export async function DELETE(req: Request, { params }: Params) {
  const { id } = await params;
  const permanent = new URL(req.url).searchParams.get("permanent") === "1";
  if (permanent) {
    const deleted = await db.conversation.delete({ where: { id } }).catch(() => null);
    if (!deleted) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
    return NextResponse.json({ ok: true, permanent: true });
  }
  const conversation = await db.conversation
    .update({ where: { id }, data: { trashedAt: new Date() }, select: { id: true } })
    .catch(() => null);
  if (!conversation) {
    return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
