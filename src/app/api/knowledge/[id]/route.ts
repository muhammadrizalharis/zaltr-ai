import { guarded, requireUser } from "@/server/auth";
import { deleteSource } from "@/server/knowledge";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** DELETE: hapus satu sumber knowledge milik user (chunk ikut terhapus cascade). */
export const DELETE = guarded(async (_req: Request, { params }: Params) => {
  const me = await requireUser();
  const { id } = await params;
  const ok = await deleteSource(me.id, id);
  if (!ok) return Response.json({ error: "Sumber tidak ditemukan" }, { status: 404 });
  return new Response(null, { status: 204 });
});
