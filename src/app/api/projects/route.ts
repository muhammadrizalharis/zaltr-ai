import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";

export const GET = guarded(async () => {
  const me = await requireUser();
  const projects = await db.project.findMany({
    where: { userId: me.id },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      instructions: true,
      _count: { select: { conversations: { where: { trashedAt: null } } } },
    },
  });
  return NextResponse.json({
    projects: projects.map((p) => ({ id: p.id, name: p.name, count: p._count.conversations })),
  });
});

const createSchema = z.object({ name: z.string().trim().min(1).max(80) });

export const POST = guarded(async (req: Request) => {
  const me = await requireUser();
  const body = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Nama project tidak valid" }, { status: 400 });
  }
  const project = await db.project.create({
    data: { name: body.data.name, userId: me.id },
    select: { id: true, name: true },
  });
  return NextResponse.json({ project: { ...project, count: 0 } }, { status: 201 });
});
