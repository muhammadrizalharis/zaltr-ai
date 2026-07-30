import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";

export const runtime = "nodejs";

/** GET: daftar memori milik user (terbaru dulu). */
export const GET = guarded(async () => {
  const me = await requireUser();
  const memories = await db.memory.findMany({
    where: { userId: me.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, content: true, createdAt: true },
  });
  return Response.json({ memories });
});
