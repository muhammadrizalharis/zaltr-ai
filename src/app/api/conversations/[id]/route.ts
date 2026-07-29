import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";

type Params = { params: Promise<{ id: string }> };

export const GET = guarded(async (_req: Request, { params }: Params) => {
  const me = await requireUser();
  const { id } = await params;
  const conversation = await db.conversation.findFirst({
    where: { id, userId: me.id, trashedAt: null },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!conversation) {
    return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
  }
  return NextResponse.json({ conversation });
});

const patchSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  pinned: z.boolean().optional(),
  projectId: z.string().min(1).nullable().optional(),
  /** false = restore dari trash */
  trashed: z.boolean().optional(),
});

export const PATCH = guarded(async (req: Request, { params }: Params) => {
  const me = await requireUser();
  const { id } = await params;
  const body = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }
  const owned = await db.conversation.findFirst({ where: { id, userId: me.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });

  if (body.data.projectId) {
    const project = await db.project.findFirst({
      where: { id: body.data.projectId, userId: me.id },
    });
    if (!project) {
      return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
    }
  }
  const { trashed, ...rest } = body.data;
  const data: Record<string, unknown> = { ...rest };
  if (trashed === false) data.trashedAt = null;
  if (trashed === true) data.trashedAt = new Date();
  const conversation = await db.conversation.update({
    where: { id },
    data,
    select: { id: true, title: true, pinned: true, projectId: true, updatedAt: true },
  });
  return NextResponse.json({ conversation });
});

/**
 * DELETE default: soft delete (pindah ke trash) — kontrak persistensi README.
 * DELETE ?permanent=1: HARD DELETE — satu dari dua jalur destruktif yang
 * diizinkan kontrak; hanya boleh dari halaman Trash dengan konfirmasi.
 */
export const DELETE = guarded(async (req: Request, { params }: Params) => {
  const me = await requireUser();
  const { id } = await params;
  const owned = await db.conversation.findFirst({ where: { id, userId: me.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });

  const permanent = new URL(req.url).searchParams.get("permanent") === "1";
  if (permanent) {
    await db.conversation.delete({ where: { id } });
    return NextResponse.json({ ok: true, permanent: true });
  }
  await db.conversation.update({ where: { id }, data: { trashedAt: new Date() } });
  return NextResponse.json({ ok: true });
});
