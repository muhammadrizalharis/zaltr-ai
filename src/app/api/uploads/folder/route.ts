import { guarded, requireUser } from "@/server/auth";
import { extractText, isBinarySkip } from "@/server/extract";
import { ingestSource } from "@/server/knowledge";
import { rateLimit } from "@/server/ratelimit";
import { bumpFolderJob, createFolderJob, finishFolderJob, getFolderJob } from "@/server/folderjobs";

export const runtime = "nodejs";

/**
 * Unggah SATU FOLDER untuk dianalisa. Tiap file diekstrak teksnya lalu di-embed
 * ke basis pengetahuan (RAG/pgvector) sebagai satu sumber bernama "<folder>/<path>".
 * Pengindeksan berjalan di LATAR: POST mengembalikan { jobId } segera, klien
 * polling GET ?job=<id> untuk bar progres. Model lalu bisa menganalisa lintas
 * seluruh folder di chat, dengan sitasi menunjukkan path file.
 */

const MAX_FILES = 800;
const MAX_TOTAL_BYTES = 300 * 1024 * 1024; // 300 MB total per folder
const MAX_FILE_BYTES = 25 * 1024 * 1024; // lewati file tunggal > 25 MB
const PER_FILE_TEXT_CHARS = 120_000; // batas karakter teks yang di-embed per file
const CONCURRENCY = 4;

export const POST = guarded(async (req: Request) => {
  const me = await requireUser();
  const rl = rateLimit(`upf:${me.id}`, 6, 60_000);
  if (!rl.ok) {
    return Response.json(
      { error: `Terlalu banyak pengindeksan folder — coba lagi dalam ${rl.retryAfter} detik.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
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

  // Saring murah (urut) -> daftar file yang akan diproses + hitung yang dilewati.
  const toProcess: { file: File; rel: string }[] = [];
  let totalBytes = 0;
  let preSkipped = 0;
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const rel = (paths[i] || file.name).replace(/^[/\\]+/, "").slice(0, 300);
    if (totalBytes + file.size > MAX_TOTAL_BYTES) {
      preSkipped++;
      continue;
    }
    totalBytes += file.size;
    if (file.size === 0 || isBinarySkip(rel) || file.size > MAX_FILE_BYTES) {
      preSkipped++;
      continue;
    }
    toProcess.push({ file, rel });
  }
  if (toProcess.length === 0) {
    return Response.json(
      { error: "Tidak ada berkas teks yang bisa diindeks dari folder ini." },
      { status: 422 },
    );
  }

  const jobId = createFolderJob(me.id, folderName, toProcess.length, preSkipped);
  // Proses di LATAR (Node standalone: promise tetap jalan setelah respons).
  void processFolder(jobId, me.id, folderName, toProcess, projectId, assistantId);
  return Response.json(
    { jobId, folder: folderName, total: toProcess.length, preSkipped },
    { status: 202 },
  );
});

async function processFolder(
  jobId: string,
  userId: string,
  folderName: string,
  items: { file: File; rel: string }[],
  projectId: string | null,
  assistantId: string | null,
): Promise<void> {
  const ingestOne = async ({ file, rel }: { file: File; rel: string }) => {
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      const text = await extractText(buf, rel, PER_FILE_TEXT_CHARS);
      if (!text || text.trim().length < 3) {
        bumpFolderJob(jobId, { done: 1, skipped: 1 });
        return;
      }
      const { chunkCount } = await ingestSource({
        userId,
        projectId,
        assistantId,
        kind: "upload",
        name: `${folderName}/${rel}`,
        ref: null,
        text,
        bytes: file.size,
      });
      bumpFolderJob(jobId, { done: 1, indexed: 1, chunks: chunkCount });
    } catch {
      bumpFolderJob(jobId, { done: 1, skipped: 1 });
    }
  };

  try {
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
        while (next < items.length) await ingestOne(items[next++]);
      }),
    );
    finishFolderJob(jobId, "done");
  } catch (e) {
    finishFolderJob(jobId, "error", (e as Error).message);
  }
}

export const GET = guarded(async (req: Request) => {
  const me = await requireUser();
  const id = new URL(req.url).searchParams.get("job");
  if (!id) return Response.json({ error: "parameter job diperlukan" }, { status: 400 });
  const j = getFolderJob(id, me.id);
  if (!j) return Response.json({ error: "job tak ditemukan" }, { status: 404 });
  return Response.json({
    folder: j.folder,
    total: j.total,
    done: j.done,
    indexedCount: j.indexedCount,
    skippedCount: j.skippedCount,
    totalChunks: j.totalChunks,
    status: j.status,
    error: j.error ?? null,
  });
});
