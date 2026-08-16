/**
 * Pencarian SEMANTIK riwayat chat: embed isi pesan (async pasca-simpan) lalu
 * cari percakapan paling mirip makna via pgvector. Dipakai berbarengan dengan
 * pencarian keyword (hybrid) di /api/search.
 */

import { db } from "@/lib/db";
import { embed, embedOne } from "@/server/embeddings";

/** Embed & simpan vektor sebuah pesan (dipanggil fire-and-forget dari route). */
export async function embedMessage(messageId: string, content: string): Promise<void> {
  const text = content.trim();
  if (text.length < 8) return;
  try {
    const [vec] = await embed([text.slice(0, 2_000)]);
    if (!vec) return;
    const vecStr = `[${vec.join(",")}]`;
    await db.$executeRaw`UPDATE "Message" SET "embedding" = ${vecStr}::vector WHERE "id" = ${messageId}`;
  } catch {
    /* pencarian semantik opsional — jangan ganggu alur chat */
  }
}

export type SemHit = { conversationId: string; title: string; snippet: string; dist: number };

/** Cari percakapan user secara semantik (pesan paling dekat makna per percakapan). */
export async function semanticSearch(userId: string, query: string, topK = 12): Promise<SemHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const vec = await embedOne(q.slice(0, 500));
  const vecStr = `[${vec.join(",")}]`;
  const rows = await db.$queryRaw<
    Array<{ conversationId: string; title: string; content: string; dist: number }>
  >`
    SELECT DISTINCT ON (c."id") c."id" AS "conversationId", c."title" AS title,
           m."content" AS content, (m."embedding" <=> ${vecStr}::vector) AS dist
    FROM "Message" m
    JOIN "Conversation" c ON c."id" = m."conversationId"
    WHERE c."userId" = ${userId} AND c."trashedAt" IS NULL AND m."embedding" IS NOT NULL
    ORDER BY c."id", dist ASC
  `;
  return rows
    .filter((r) => r.dist <= 0.6)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, topK)
    .map((r) => ({
      conversationId: r.conversationId,
      title: r.title,
      snippet: r.content.replace(/\s+/g, " ").slice(0, 140),
      dist: r.dist,
    }));
}
