import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";

export const runtime = "nodejs";

/** Potong cuplikan ~140 char di sekitar kecocokan pertama. */
function snippet(text: string, q: string): string {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, 140);
  const start = Math.max(0, i - 50);
  const end = Math.min(text.length, i + q.length + 90);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

/** GET /api/search?q= : cari percakapan milik user berdasarkan judul + isi pesan. */
export const GET = guarded(async (req: Request) => {
  const me = await requireUser();
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return Response.json({ results: [] });

  const convos = await db.conversation.findMany({
    where: {
      userId: me.id,
      trashedAt: null,
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { messages: { some: { content: { contains: q, mode: "insensitive" } } } },
      ],
    },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      messages: {
        where: { content: { contains: q, mode: "insensitive" } },
        select: { content: true, role: true },
        take: 1,
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });

  const results = convos.map((c) => ({
    id: c.id,
    title: c.title,
    updatedAt: c.updatedAt,
    snippet: c.messages[0] ? snippet(c.messages[0].content, q) : "",
  }));
  return Response.json({ results });
});
