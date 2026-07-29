import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";

export async function GET() {
  const conversations = await db.conversation.findMany({
    where: { trashedAt: null, archived: false },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    select: { id: true, title: true, pinned: true, updatedAt: true },
    take: 200,
  });
  return NextResponse.json({ conversations });
}

const createSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export async function POST(req: Request) {
  const body = createSchema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: "Payload tidak valid" }, { status: 400 });
  }
  const conversation = await db.conversation.create({
    data: { title: body.data.title ?? "Chat baru" },
    select: { id: true, title: true, pinned: true, updatedAt: true },
  });
  return NextResponse.json({ conversation }, { status: 201 });
}
