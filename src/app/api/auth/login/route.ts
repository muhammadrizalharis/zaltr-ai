import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, verifyPassword } from "@/server/auth";

const schema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Email/password tidak valid" }, { status: 400 });
  }
  const user = await db.user.findUnique({ where: { email: body.data.email } });
  // Pesan seragam agar tidak membocorkan email mana yang terdaftar.
  const gagal = NextResponse.json({ error: "Email atau password salah" }, { status: 401 });
  if (!user) return gagal;
  if (!user.passwordHash) {
    return NextResponse.json(
      { error: "Akun ini masuk lewat Google — pakai tombol “Masuk dengan Google”" },
      { status: 400 },
    );
  }
  if (!(await verifyPassword(body.data.password, user.passwordHash))) return gagal;

  if (user.status === "pending") {
    return NextResponse.json(
      { error: "Akun masih menunggu aktivasi superadmin" },
      { status: 403 },
    );
  }
  if (user.status === "suspended") {
    return NextResponse.json({ error: "Akun dinonaktifkan admin" }, { status: 403 });
  }

  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await createSession(user.id);
  return NextResponse.json({ ok: true });
}
