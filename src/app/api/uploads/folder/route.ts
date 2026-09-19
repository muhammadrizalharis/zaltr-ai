import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";
import { extractText, isBinarySkip } from "@/server/extract";
import { ingestSource } from "@/server/knowledge";

export const runtime = "nodejs";

/**
 * Unggah SATU FOLDER untuk dianalisa. Tiap file diekstrak teksnya lalu di-embed
 * ke basis pengetahuan (RAG/pgvector) sebagai satu sumber bernama "<folder>/<path>".
 * Setelah itu model bisa mencari & menganalisa lintas seluruh folder di chat,
 * tanpa batas jumlah file (retrieval semantik), dengan sitasi menunjukkan path file.
 *
 * Catatan: folder di-INGEST untuk analisa (teks disimpan sebagai potongan ber-embedding),
 * bukan disimpan sebagai berkas yang bisa diunduh ulang. Kelola/hapus di panel Pengetahuan.
 */

const MAX_FILES = 800;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024; // 300 MB total per folder
const MAX_FILE_BYTES = 25 * 1024 * 1024; // lewati file tunggal > 25 MB
const PER_FILE_TEXT_CHARS = 120_000; // batas karakter teks yang di-embed per file

type FileResult = { path: string; chunks: number };
type SkipResult = { path: string; reason: string };

export const POST = guarded(async (req: Request) => {
  const me = await requireUser();
  const form = await req.formData().catch(() => null);
  if (!form) {
    return Response.json({ error: "Kirim sebagai multipart/form-data" }, { status: 400 });
  }

  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  const paths = form.getAll("path").map((p) => String(p));
  const folderName = (String(form.get("folder") || "folder").trim() || "folder").slice(0, 120);
  const projectId = form.get("projectId") ? String(form.get("projectId")) : null;
  const assistantId = form.get("assistantId") ? String(form.get("assistantId")) : null;

  if (files.length === 0) {
    return Response.json({ error: "Folder tidak berisi file" }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return Response.json(
      { error: `Terlalu banyak file (${files.length}). Maksimal ${MAX_FILES} per folder.` },
      { status: 400 },
    );
  }

  const indexed: FileResult[] = [];
  const skipped: SkipResult[] = [];
  let totalBytes = 0;
  let totalChunks = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const rel = (paths[i] || file.name).replace(/^[/\\]+/, "").slice(0, 300);
    if (totalBytes + file.size > MAX_TOTAL_BYTES) {
      skipped.push({ path: rel, reason: "melebihi total folder (300 MB)" });
      continue;
    }
    totalBytes += file.size;
    if (file.size === 0 || isBinarySkip(rel)) {
      skipped.push({ path: rel, reason: "biner/kosong" });
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      skipped.push({ path: rel, reason: "file > 25 MB" });
      continue;
    }
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const text = await extractText(buf, rel, PER_FILE_TEXT_CHARS);
      if (!text || text.trim().length < 3) {
        skipped.push({ path: rel, reason: "tak ada teks terbaca" });
        continue;
      }
      const { chunkCount } = await ingestSource({
        userId: me.id,
        projectId,
        assistantId,
        kind: "upload",
        name: `${folderName}/${rel}`,
        ref: null,
        text,
        bytes: file.size,
      });
      indexed.push({ path: rel, chunks: chunkCount });
      totalChunks += chunkCount;
    } catch {
      skipped.push({ path: rel, reason: "gagal diproses" });
    }
  }

  if (indexed.length === 0) {
    return Response.json(
      { error: "Tidak ada file berisi teks yang bisa diindeks dari folder ini." },
      { status: 422 },
    );
  }

  const totalIndexed = await db.knowledgeSource.count({
    where: { userId: me.id, status: "indexed" },
  });

  return Response.json({
    folder: folderName,
    fileCount: files.length,
    indexedCount: indexed.length,
    skippedCount: skipped.length,
    totalChunks,
    totalSourcesIndexed: totalIndexed,
    indexed: indexed.slice(0, 300),
    skipped: skipped.slice(0, 60),
  });
});
