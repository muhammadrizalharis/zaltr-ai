import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, hashPassword, requireAdmin } from "@/server/auth";

type Params = { params: Promise<{ id: string }> };

const patchSchema = z.object({
  role: z.enum(["superadmin", "admin", "user"]).optional(),
  status: z.enum(["pending", "active", "suspended"]).optional(),
  creditBalance: z.number().int().min(0).max(100_000_000).optional(),
  allowedModels: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
  dailyMsgLimit: z.number().int().min(1).max(100_000).nullable().optional(),
  notes: z.string().max(2_000).nullable().optional(),
  newPassword: z.string().min(8).max(200).optional(),
});

/**
 * Aturan wewenang:
 * - superadmin: bebas mengatur siapa pun (kecuali menurunkan dirinya sendiri
 *   bila ia superadmin terakhir).
 * - admin: hanya boleh mengatur user biasa; tidak boleh mengubah role.
 */
export const PATCH = guarded(async (req: Request, { params }: Params) => {
  const actor = await requireAdmin();
  const { id } = await params;
  const body = patchSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }

  const target = await db.user.findUnique({
    where: { id },
    select: { id: true, role: true },
  });
  if (!target) return NextResponse.json({ error: "User tidak ditemukan" }, { status: 404 });

  if (actor.role === "admin") {
    if (target.role !== "user" && target.id !== actor.id) {
      return NextResponse.json({ error: "Admin tidak bisa mengatur admin lain" }, { status: 403 });
    }
    if (body.data.role) {
      return NextResponse.json({ error: "Hanya superadmin yang bisa mengubah role" }, { status: 403 });
    }
  }

  // Lindungi superadmin terakhir dari penurunan role/penonaktifan.
  if (
    target.role === "superadmin" &&
    (body.data.role && body.data.role !== "superadmin" || body.data.status === "suspended")
  ) {
    const supers = await db.user.count({ where: { role: "superadmin", status: "active" } });
    if (supers <= 1) {
      return NextResponse.json({ error: "Tidak bisa: dia superadmin aktif terakhir" }, { status: 400 });
    }
  }

  const { newPassword, ...rest } = body.data;
  const data: Record<string, unknown> = { ...rest };
  if (newPassword) data.passwordHash = await hashPassword(newPassword);

  const user = await db.user.update({
    where: { id },
    data,
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
    },
  });
  // Paksa logout target bila di-suspend.
  if (body.data.status === "suspended") {
    await db.session.deleteMany({ where: { userId: id } });
  }
  return NextResponse.json({ user });
});

/** Hapus akun (superadmin saja) — destruktif: seluruh chat user ikut terhapus. */
export const DELETE = guarded(async (_req: Request, { params }: Params) => {
  const actor = await requireAdmin();
  if (actor.role !== "superadmin") {
    return NextResponse.json({ error: "Hanya superadmin yang bisa menghapus akun" }, { status: 403 });
  }
  const { id } = await params;
  if (id === actor.id) {
    return NextResponse.json({ error: "Tidak bisa menghapus akun sendiri dari sini" }, { status: 400 });
  }
  const target = await db.user.findUnique({ where: { id }, select: { role: true } });
  if (!target) return NextResponse.json({ error: "User tidak ditemukan" }, { status: 404 });
  if (target.role === "superadmin") {
    const supers = await db.user.count({ where: { role: "superadmin" } });
    if (supers <= 1) {
      return NextResponse.json({ error: "Tidak bisa menghapus superadmin terakhir" }, { status: 400 });
    }
  }
  await db.user.delete({ where: { id } }); // cascade: session, project, conversation, message
  return NextResponse.json({ ok: true });
});
