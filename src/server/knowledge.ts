/**
 * Basis pengetahuan (RAG): potong dokumen -> embedding -> simpan di pgvector,
 * lalu ambil potongan paling relevan untuk disuntik ke prompt (ber-sitasi).
 * Sumber bisa global (milik user) atau terikat sebuah Project.
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { embed, embedOne, EMBED_MODEL } from "@/server/embeddings";

/** Potong teks jadi bagian ~1200 karakter dengan tumpang-tindih 200. */
export function chunkText(text: string, size = 1200, overlap = 200): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    if (end < clean.length) {
      // Coba potong di batas baris/kalimat terdekat agar tidak putus di tengah.
      const slice = clean.slice(i, end);
      const cut = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(". "));
      if (cut > size * 0.5) end = i + cut + 1;
    }
    const piece = clean.slice(i, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    i = Math.max(0, end - overlap);
  }
  return chunks;
}

export type IngestInput = {
  userId: string;
  projectId?: string | null;
  assistantId?: string | null;
  kind: "upload" | "drive" | "text";
  name: string;
  ref?: string | null;
  text: string;
  bytes?: number;
};

/** Simpan sumber + embedding semua potongannya. Return jumlah chunk. */
export async function ingestSource(input: IngestInput): Promise<{ sourceId: string; chunkCount: number }> {
  const source = await db.knowledgeSource.create({
    data: {
      userId: input.userId,
      projectId: input.projectId ?? null,
      assistantId: input.assistantId ?? null,
      kind: input.kind,
      name: input.name.slice(0, 200),
      ref: input.ref ?? null,
      bytes: input.bytes ?? Buffer.byteLength(input.text, "utf8"),
      status: "pending",
      embedModel: EMBED_MODEL,
    },
    select: { id: true },
  });
  try {
    const chunks = chunkText(input.text);
    let idx = 0;
    const BATCH = 32;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const vecs = await embed(batch);
      for (let j = 0; j < batch.length; j++) {
        const vecStr = `[${vecs[j].join(",")}]`;
        await db.$executeRaw`
          INSERT INTO "KnowledgeChunk" ("id", "sourceId", "userId", "projectId", "assistantId", "idx", "content", "embedding", "createdAt")
          VALUES (${randomUUID()}, ${source.id}, ${input.userId}, ${input.projectId ?? null}, ${input.assistantId ?? null}, ${idx}, ${batch[j]}, ${vecStr}::vector, now())
        `;
        idx++;
      }
    }
    await db.knowledgeSource.update({
      where: { id: source.id },
      data: { status: "indexed", chunkCount: idx },
    });
    return { sourceId: source.id, chunkCount: idx };
  } catch (e) {
    await db.knowledgeSource.update({
      where: { id: source.id },
      data: { status: "failed", error: String((e as Error).message).slice(0, 300) },
    });
    throw e;
  }
}

export type KnowledgeHit = { content: string; name: string; sourceId: string; dist: number };

/**
 * Ambil potongan paling relevan. Cakupan: sumber GLOBAL milik user selalu ikut;
 * sumber terikat Project ikut HANYA bila projectId cocok (tak bocor antar-project).
 */
export async function retrieve(opts: {
  userId: string;
  projectId?: string | null;
  assistantId?: string | null;
  query: string;
  topK?: number;
}): Promise<KnowledgeHit[]> {
  const topK = opts.topK ?? 6;
  const q = opts.query.trim();
  if (!q) return [];
  const vec = await embedOne(q.slice(0, 2_000));
  const vecStr = `[${vec.join(",")}]`;
  const pid = opts.projectId ?? null;
  const aid = opts.assistantId ?? null;
  const rows = await db.$queryRaw<KnowledgeHit[]>`
    SELECT c."content" AS content, s."name" AS name, c."sourceId" AS "sourceId",
           (c."embedding" <=> ${vecStr}::vector) AS dist
    FROM "KnowledgeChunk" c
    JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
    WHERE c."userId" = ${opts.userId}
      AND s."status" = 'indexed'
      AND (
        (c."projectId" IS NULL AND c."assistantId" IS NULL)
        OR (${pid}::text IS NOT NULL AND c."projectId" = ${pid})
        OR (${aid}::text IS NOT NULL AND c."assistantId" = ${aid})
      )
    ORDER BY dist ASC
    LIMIT ${topK}
  `;
  // Buang yang terlalu jauh (cosine distance > 0.75 = nyaris tak relevan).
  return rows.filter((r) => r.dist <= 0.75);
}

/** Format hasil retrieval jadi blok konteks ber-sitasi untuk prompt. */
export function formatKnowledge(hits: KnowledgeHit[]): string {
  if (hits.length === 0) return "";
  const rows = hits.map((h, i) => `[K${i + 1}] (sumber: ${h.name})\n${h.content}`).join("\n\n");
  return (
    `=== Basis pengetahuan (dokumen milik pengguna) ===\n${rows}\n` +
    `=== Akhir basis pengetahuan ===\n` +
    `Jawab berdasarkan potongan di atas bila relevan, dan sebutkan sumbernya sebagai [K#]. ` +
    `Bila tidak ada yang relevan, jawab dari pengetahuanmu dan katakan itu.`
  );
}

export async function countIndexed(
  userId: string,
  projectId?: string | null,
  assistantId?: string | null,
): Promise<number> {
  const pid = projectId ?? null;
  const aid = assistantId ?? null;
  return db.knowledgeSource.count({
    where: {
      userId,
      status: "indexed",
      OR: [
        { projectId: null, assistantId: null },
        ...(pid ? [{ projectId: pid }] : []),
        ...(aid ? [{ assistantId: aid }] : []),
      ],
    },
  });
}

export async function listSources(userId: string, opts?: { projectId?: string | null; assistantId?: string | null }) {
  return db.knowledgeSource.findMany({
    where: {
      userId,
      ...(opts?.projectId !== undefined ? { projectId: opts.projectId } : {}),
      ...(opts?.assistantId !== undefined ? { assistantId: opts.assistantId } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      kind: true,
      status: true,
      chunkCount: true,
      bytes: true,
      projectId: true,
      assistantId: true,
      error: true,
      createdAt: true,
    },
  });
}

export async function deleteSource(userId: string, id: string): Promise<boolean> {
  const res = await db.knowledgeSource.deleteMany({ where: { id, userId } });
  return res.count > 0;
}
