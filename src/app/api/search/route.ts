import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";
import { semanticSearch } from "@/server/msgsearch";

export const runtime = "nodejs";

/** Potong cuplikan ~140 char di sekitar kecocokan pertama. */
function snippet(text: string, q: string): string {
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return text.slice(0, 140);
  const start = Math.max(0, i - 50);
  const end = Math.min(text.length, i + q.length + 90);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

type Result = { id: string; title: string; snippet: string };

/** Pencarian keyword (judul + isi pesan) — juga menjangkau pesan lama tanpa embedding. */
async function keywordSearch(userId: string, q: string): Promise<Result[]> {
  const convos = await db.conversation.findMany({
    where: {
      userId,
      trashedAt: null,
      OR: [
        { title: { contains: q, mode: "insensitive" } },
        { messages: { some: { content: { contains: q, mode: "insensitive" } } } },
      ],
    },
    select: {
      id: true,
      title: true,
      messages: {
        where: { content: { contains: q, mode: "insensitive" } },
        select: { content: true },
        take: 1,
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 30,
  });
  return convos.map((c) => ({
    id: c.id,
    title: c.title,
    snippet: c.messages[0] ? snippet(c.messages[0].content, q) : "",
  }));
}

/** GET /api/search?q= : HYBRID — semantik (embedding) lalu keyword, dedupe. */
export const GET = guarded(async (req: Request) => {
  const me = await requireUser();
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) return Response.json({ results: [] });

  const [sem, kw] = await Promise.all([
    semanticSearch(me.id, q).catch(() => []),
    keywordSearch(me.id, q),
  ]);

  const seen = new Set<string>();
  const results: Result[] = [];
  for (const s of sem) {
    if (seen.has(s.conversationId)) continue;
    seen.add(s.conversationId);
    results.push({ id: s.conversationId, title: s.title, snippet: s.snippet });
  }
  for (const k of kw) {
    if (seen.has(k.id)) continue;
    seen.add(k.id);
    results.push(k);
  }
  return Response.json({ results: results.slice(0, 30) });
});
