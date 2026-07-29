import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guarded, requireAdmin } from "@/server/auth";

/** Daftar pengguna + statistik ringkas untuk halaman admin. */
export const GET = guarded(async () => {
  await requireAdmin();
  const users = await db.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      creditBalance: true,
      creditUsed: true,
      allowedModels: true,
      dailyMsgLimit: true,
      notes: true,
      lastLoginAt: true,
      createdAt: true,
      _count: { select: { conversations: true } },
    },
  });
  return NextResponse.json({
    users: users.map(({ _count, ...u }) => ({ ...u, conversationCount: _count.conversations })),
  });
});
