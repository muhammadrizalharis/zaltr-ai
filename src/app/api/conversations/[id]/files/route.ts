import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";
import { listWorkspace, wsPrefix } from "@/server/workspace";
import { removeObject } from "@/lib/storage";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** GET: daftar berkas hasil agen (workspace) milik percakapan ini. */
export const GET = guarded(async (_req: Request, { params }: Params) => {
  const me = await requireUser();
  const { id } = await params;
  const owned = await db.conversation.findFirst({ where: { id, userId: me.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
  const files = await listWorkspace(me.id, id);
  return NextResponse.json({ files });
});

/** DELETE ?path=<rel>: hapus satu berkas workspace (MinIO + baris Upload). */
export const DELETE = guarded(async (req: Request, { params }: Params) => {
  const me = await requireUser();
  const { id } = await params;
  const owned = await db.conversation.findFirst({ where: { id, userId: me.id }, select: { id: true } });
  if (!owned) return NextResponse.json({ error: "Tidak ditemukan" }, { status: 404 });
  const rel = new URL(req.url).searchParams.get("path") ?? "";
  if (!rel || rel.includes("..") || rel.startsWith("/")) {
    return NextResponse.json({ error: "Path tidak valid" }, { status: 400 });
  }
  const key = wsPrefix(me.id, id) + rel;
  const row = await db.upload.findFirst({ where: { key, userId: me.id }, select: { id: true } });
  if (!row) return NextResponse.json({ error: "Berkas tidak ditemukan" }, { status: 404 });
  await removeObject(key).catch(() => {});
  await db.upload.delete({ where: { id: row.id } });
  return NextResponse.json({ ok: true });
});
