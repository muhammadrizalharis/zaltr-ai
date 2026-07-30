import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";

export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/** DELETE: hapus satu memori milik user sendiri. */
export const DELETE = guarded(async (_req: Request, { params }: Params) => {
  const me = await requireUser();
  const { id } = await params;
  const deleted = await db.memory.deleteMany({ where: { id, userId: me.id } });
  if (deleted.count === 0) {
    return Response.json({ error: "Memori tidak ditemukan" }, { status: 404 });
  }
  return new Response(null, { status: 204 });
});
