import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { createSession, hashPassword } from "@/server/auth";

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email().max(160),
  password: z.string().min(8).max(200),
});

/**
 * Registrasi (freemium):
 * - User PERTAMA otomatis superadmin + akses semua model, dan mengklaim
 *   data preview lama (conversation/project tanpa pemilik).
 * - User berikutnya LANGSUNG AKTIF dengan mode Free (zaltr-core saja);
 *   model premium terlihat tapi terkunci sampai membeli kredit/upgrade.
 */
export async function POST(req: Request) {
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json(
      { error: "Data tidak valid (nama ≥2, email benar, password ≥8 karakter)" },
      { status: 400 },
    );
  }
  const { name, email, password } = body.data;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "Email sudah terdaftar" }, { status: 409 });
  }

  const isFirst = (await db.user.count()) === 0;
  const passwordHash = await hashPassword(password);

  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: isFirst ? "superadmin" : "user",
        status: "active",
        creditBalance: isFirst ? 100_000 : 0,
        allowedModels: isFirst ? ["*"] : ["zaltr-core"],
        lastLoginAt: new Date(),
      },
      select: { id: true, role: true, status: true },
    });
    if (isFirst) {
      // Klaim data fase preview yang belum punya pemilik.
      await tx.conversation.updateMany({
        where: { userId: null },
        data: { userId: created.id },
      });
      await tx.project.updateMany({ where: { userId: null }, data: { userId: created.id } });
    }
    return created;
  });

  await createSession(user.id);
  return NextResponse.json({ ok: true, active: true }, { status: 201 });
}
