import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export async function GET() {
  const conversations = await db.conversation.findMany({
    where: { trashedAt: null, archived: false },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    select: { id: true, title: true, pinned: true, projectId: true, updatedAt: true },
    take: 200,
  });
  return NextResponse.json({ conversations });
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  projectId: z.string().min(1).nullable().optional(),
});

export async function POST(req: Request) {
  const body = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }
  if (body.data.projectId) {
    const project = await db.project.findUnique({ where: { id: body.data.projectId } });
    if (!project) {
      return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
    }
  }
  const conversation = await db.conversation.create({
    data: { title: body.data.title ?? "Chat baru", projectId: body.data.projectId ?? null },
    select: { id: true, title: true, pinned: true, projectId: true, updatedAt: true },
  });
  return NextResponse.json({ conversation }, { status: 201 });
}
