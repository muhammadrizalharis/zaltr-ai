import { z } from "zod";
import { db } from "@/lib/db";
import { guarded, requireUser } from "@/server/auth";
import { getObjectBuffer } from "@/lib/storage";
import { extractText, fileExt, IMAGE_EXT, needsFullDownload, isBinarySkip } from "@/server/extract";
import {
  parseDriveLinks,
  listFolderTree,
  fetchDriveFile,
  driveMeta,
  driveConfigured,
  type DriveNode,
} from "@/server/drive";
import { ingestSource, listSources } from "@/server/knowledge";

export const runtime = "nodejs";

const MAX_INGEST_CHARS = 2_000_000;
const MAX_DRIVE_FILES = 50;

/** GET: daftar sumber knowledge milik user (opsional filter ?projectId=). */
export const GET = guarded(async (req: Request) => {
  const me = await requireUser();
  const pid = new URL(req.url).searchParams.get("projectId");
  const sources = await listSources(me.id, pid ?? undefined);
  return Response.json({ sources });
});

const schema = z.object({
  kind: z.enum(["text", "upload", "drive"]),
  projectId: z.string().min(1).nullable().optional(),
  name: z.string().trim().max(200).optional(),
  content: z.string().optional(),
  key: z.string().optional(),
  link: z.string().optional(),
});

/** POST: indeks dokumen ke basis pengetahuan (teks / berkas unggahan / Drive). */
export const POST = guarded(async (req: Request) => {
  const me = await requireUser();
  const body = schema.safeParse(await req.json().catch(() => ({})));
  if (!body.success) return Response.json({ error: "Payload tidak valid" }, { status: 400 });
  const { kind, projectId } = body.data;

  if (projectId) {
    const p = await db.project.findFirst({ where: { id: projectId, userId: me.id }, select: { id: true } });
    if (!p) return Response.json({ error: "Project tidak ditemukan" }, { status: 404 });
  }

  if (kind === "text") {
    const text = (body.data.content ?? "").slice(0, MAX_INGEST_CHARS);
    if (!text.trim()) return Response.json({ error: "Teks kosong" }, { status: 400 });
    const r = await ingestSource({ userId: me.id, projectId, kind: "text", name: body.data.name || "Catatan", text });
    return Response.json({ sources: [{ name: body.data.name || "Catatan", chunkCount: r.chunkCount }] }, { status: 201 });
  }

  if (kind === "upload") {
    const key = body.data.key ?? "";
    if (!key.startsWith(`uploads/${me.id}/`)) return Response.json({ error: "Berkas tidak valid" }, { status: 400 });
    const name = key.split("/").pop() ?? key;
    const buf = await getObjectBuffer(key);
    const text = await extractText(buf, name, MAX_INGEST_CHARS);
    if (!text) return Response.json({ error: "Berkas tidak bisa dibaca sebagai teks" }, { status: 422 });
    const r = await ingestSource({ userId: me.id, projectId, kind: "upload", name, ref: key, text, bytes: buf.length });
    return Response.json({ sources: [{ name, chunkCount: r.chunkCount }] }, { status: 201 });
  }

  // kind === "drive"
  if (!driveConfigured()) return Response.json({ error: "Baca Google Drive belum aktif (API key)" }, { status: 400 });
  const refs = parseDriveLinks(body.data.link ?? "");
  if (refs.length === 0) return Response.json({ error: "Bukan link Google Drive yang valid" }, { status: 400 });

  const nodes: DriveNode[] = [];
  for (const ref of refs) {
    if (ref.kind === "folder") {
      const { files } = await listFolderTree(ref.id, { maxFiles: 300 });
      nodes.push(...files);
    } else {
      try {
        nodes.push(await driveMeta(ref.id));
      } catch {
        /* lewati berkas yang gagal metadata */
      }
    }
  }

  const results: Array<{ name: string; chunkCount: number }> = [];
  for (const node of nodes) {
    if (results.length >= MAX_DRIVE_FILES) break;
    const ext = fileExt(node.name);
    if (isBinarySkip(node.name) || IMAGE_EXT.has(ext)) continue;
    const fullOnly = needsFullDownload(node.name);
    if (fullOnly && node.size && node.size > 50 * 1024 * 1024) continue;
    try {
      const { buf, name, partial } = await fetchDriveFile(node, fullOnly ? undefined : 4 * 1024 * 1024);
      const text = await extractText(buf, name, MAX_INGEST_CHARS, { partial, sourceBytes: node.size });
      if (!text) continue;
      const r = await ingestSource({ userId: me.id, projectId, kind: "drive", name: node.path, ref: node.id, text, bytes: node.size });
      results.push({ name: node.path, chunkCount: r.chunkCount });
    } catch {
      /* lewati berkas yang gagal diindeks */
    }
  }
  if (results.length === 0) return Response.json({ error: "Tak ada berkas teks yang bisa diindeks" }, { status: 422 });
  return Response.json(
    { sources: results, totalChunks: results.reduce((a, b) => a + b.chunkCount, 0) },
    { status: 201 },
  );
});
