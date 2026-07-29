import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/** Isi trash: chat yang di-soft-delete. Tetap tersimpan selamanya sampai
 *  dihapus permanen secara eksplisit (kontrak persistensi README). */
export async function GET() {
  const conversations = await db.conversation.findMany({
    where: { trashedAt: { not: null } },
    orderBy: { trashedAt: "desc" },
    select: { id: true, title: true, trashedAt: true, updatedAt: true },
    take: 500,
  });
  return NextResponse.json({ conversations });
}
