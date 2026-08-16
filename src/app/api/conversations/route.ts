import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";

export const GET = guarded(async () => {
  const me = await requireUser();
  const conversations = await db.conversation.findMany({
    where: { userId: me.id, trashedAt: null, archived: false },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    select: { id: true, title: true, pinned: true, projectId: true, updatedAt: true },
    take: 200,
  });
  return NextResponse.json({ conversations });
});

const createSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  projectId: z.string().min(1).nullable().optional(),
  assistantId: z.string().min(1).nullable().optional(),
});

export const POST = guarded(async (req: Request) => {
  const me = await requireUser();
  const body = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }
  if (body.data.projectId) {
    const project = await db.project.findFirst({
      where: { id: body.data.projectId, userId: me.id },
    });
    if (!project) {
      return NextResponse.json({ error: "Project tidak ditemukan" }, { status: 404 });
    }
  }
  if (body.data.assistantId) {
    const assistant = await db.assistant.findFirst({
      where: { id: body.data.assistantId, userId: me.id },
      select: { id: true },
    });
    if (!assistant) {
      return NextResponse.json({ error: "Assistant tidak ditemukan" }, { status: 404 });
    }
  }
  const conversation = await db.conversation.create({
    data: {
      title: body.data.title ?? "Chat baru",
      projectId: body.data.projectId ?? null,
      assistantId: body.data.assistantId ?? null,
      userId: me.id,
    },
    select: { id: true, title: true, pinned: true, projectId: true, updatedAt: true },
  });
  return NextResponse.json({ conversation }, { status: 201 });
});
