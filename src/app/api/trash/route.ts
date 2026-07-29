import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";

/** Isi trash milik user: chat yang di-soft-delete. Tetap tersimpan selamanya
 *  sampai dihapus permanen secara eksplisit (kontrak persistensi README). */
export const GET = guarded(async () => {
  const me = await requireUser();
  const conversations = await db.conversation.findMany({
    where: { userId: me.id, trashedAt: { not: null } },
    orderBy: { trashedAt: "desc" },
    select: { id: true, title: true, trashedAt: true, updatedAt: true },
    take: 500,
  });
  return NextResponse.json({ conversations });
});
