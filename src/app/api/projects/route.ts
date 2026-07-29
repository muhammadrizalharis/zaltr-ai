import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export async function GET() {
  const projects = await db.project.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      _count: { select: { conversations: { where: { trashedAt: null } } } },
    },
  });
  return NextResponse.json({
    projects: projects.map((p) => ({ id: p.id, name: p.name, count: p._count.conversations })),
  });
}

const createSchema = z.object({ name: z.string().trim().min(1).max(80) });

export async function POST(req: Request) {
  const body = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Nama project tidak valid" }, { status: 400 });
  }
  const project = await db.project.create({
    data: { name: body.data.name },
    select: { id: true, name: true },
  });
  return NextResponse.json({ project: { ...project, count: 0 } }, { status: 201 });
}
