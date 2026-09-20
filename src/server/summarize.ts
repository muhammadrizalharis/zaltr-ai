import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { dispatch } from "@/server/providers";

/**
 * Peringkas MAP-REDUCE untuk merangkum SELURUH sumber/folder (bukan cuma potongan
 * relevan seperti retrieval). Map: ringkas tiap batch potongan; Reduce: gabung jadi
 * satu ringkasan menyeluruh. Memakai model GRATIS lokal (Ollama via zaltr-core)
 * agar tak memotong kredit. Dibatasi MAX_CHUNKS demi waktu & biaya.
 */

const SUMMARIZE_MODEL = process.env.ZALTR_SUMMARIZE_MODEL || "zaltr-core";
const MAX_CHUNKS = 60;
const MAP_BATCH = 5;
const MAP_CONCURRENCY = 3;

async function complete(prompt: string): Promise<string> {
  const ac = new AbortController();
  let out = "";
  for await (const part of dispatch(SUMMARIZE_MODEL, {
    history: [{ role: "user", content: prompt }],
    conversationId: `sum-${randomUUID()}`,
    signal: ac.signal,
  })) {
    if (part.kind === "text") out += part.text;
  }
  return out.trim();
}

export type SummarizeTarget =
  | { sourceId: string }
  | { folder: string; projectId: string | null; assistantId: string | null };

type Row = { content: string; name: string };

export async function summarizeTarget(
  userId: string,
  t: SummarizeTarget,
): Promise<{ summary: string; chunkCount: number; sourceCount: number; capped: boolean }> {
  let rows: Row[];
  if ("sourceId" in t) {
    rows = await db.$queryRaw<Row[]>`
      SELECT c."content" AS content, s."name" AS name
      FROM "KnowledgeChunk" c
      JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
      WHERE c."userId" = ${userId} AND c."sourceId" = ${t.sourceId}
      ORDER BY c."idx" ASC
      LIMIT ${MAX_CHUNKS + 1}
    `;
  } else {
    const pid = t.projectId ?? null;
    const aid = t.assistantId ?? null;
    const like = `${t.folder.replace(/[%_\\]/g, "\\$&")}/%`;
    rows = await db.$queryRaw<Row[]>`
      SELECT c."content" AS content, s."name" AS name
      FROM "KnowledgeChunk" c
      JOIN "KnowledgeSource" s ON s."id" = c."sourceId"
      WHERE c."userId" = ${userId}
        AND s."status" = 'indexed'
        AND s."name" LIKE ${like} ESCAPE '\'
        AND (
          (s."projectId" IS NULL AND s."assistantId" IS NULL)
          OR (${pid}::text IS NOT NULL AND s."projectId" = ${pid})
          OR (${aid}::text IS NOT NULL AND s."assistantId" = ${aid})
        )
      ORDER BY s."name" ASC, c."idx" ASC
      LIMIT ${MAX_CHUNKS + 1}
    `;
  }

  if (rows.length === 0) throw new Error("Tidak ada isi untuk dirangkum.");
  const capped = rows.length > MAX_CHUNKS;
  if (capped) rows = rows.slice(0, MAX_CHUNKS);
  const sourceCount = new Set(rows.map((r) => r.name)).size;

  // MAP: ringkas tiap batch potongan (konkuren, model gratis).
  const batches: Row[][] = [];
  for (let i = 0; i < rows.length; i += MAP_BATCH) batches.push(rows.slice(i, i + MAP_BATCH));
  const partials: string[] = new Array(batches.length).fill("");
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(MAP_CONCURRENCY, batches.length) }, async () => {
      while (next < batches.length) {
        const bi = next++;
        const text = batches[bi].map((r) => `## ${r.name}\n${r.content}`).join("\n\n").slice(0, 6000);
        partials[bi] = await complete(
          "Ringkas poin-poin PENTING dari potongan dokumen berikut dalam 3-6 butir singkat " +
            "(bahasa Indonesia). Fokus fakta & ide utama; sebutkan nama berkas bila relevan.\n\n" +
            text,
        );
      }
    }),
  );

  // REDUCE: gabung ringkasan parsial jadi satu ringkasan menyeluruh.
  const combined = partials
    .filter(Boolean)
    .map((p, i) => `Bagian ${i + 1}:\n${p}`)
    .join("\n\n")
    .slice(0, 9000);
  if (!combined) throw new Error("Model tidak menghasilkan ringkasan.");
  const summary = await complete(
    "Di bawah ini ringkasan beberapa BAGIAN dari sekumpulan dokumen. Gabungkan menjadi SATU " +
      "ringkasan menyeluruh & terstruktur (bahasa Indonesia): (1) 2-3 kalimat gambaran umum, " +
      "(2) poin-poin utama yang dikelompokkan, (3) sebutkan berkas kunci bila ada. Hindari " +
      "pengulangan.\n\n" +
      combined,
  );

  return { summary: summary || combined, chunkCount: rows.length, sourceCount, capped };
}
