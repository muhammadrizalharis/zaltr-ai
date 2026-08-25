import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { db } from "@/lib/db";
import { putObjectStream, removeObjects } from "@/lib/storage";
import { currentSessionId, guarded, requireUser } from "@/server/auth";
import { MAX_UPLOAD_BYTES, UPLOAD_QUOTA_BYTES, permanentUsage } from "@/server/uploads";

export const runtime = "nodejs";

const MAX_FILES = 5;
const MAX_MB = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);

/**
 * Upload lampiran chat (semua jenis file) ke MinIO.
 * - Total permanen <= UPLOAD_QUOTA_BYTES: disimpan permanen (uploads/<id>/…),
 *   ikut backup harian.
 * - Kuota penuh: berkas jadi "sementara" (uploads/<id>/tmp/…) — tetap bisa
 *   dibaca AI selama sesi, TIDAK dihitung kuota / tidak di-backup, dan dihapus
 *   saat logout / tab ditutup / TTL menganggur. Klien menerima flag `ephemeral`.
 * Dilayani balik oleh /api/files/[...key] (auth wajib).
 */
export const POST = guarded(async (req: Request) => {
  const me = await requireUser();
  const form = await req.formData().catch(() => null);
  if (!form) {
    return Response.json({ error: "Kirim sebagai multipart/form-data" }, { status: 400 });
  }
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return Response.json({ error: "Tidak ada file" }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return Response.json({ error: `Maksimal ${MAX_FILES} file per pesan` }, { status: 400 });
  }

  const sessionId = await currentSessionId();
  let usage = await permanentUsage(me.id);
  const written: string[] = [];
  const saved: Array<{
    url: string;
    name: string;
    size: number;
    type: string;
    ephemeral: boolean;
  }> = [];

  const rollback = async () => {
    if (written.length) {
      await removeObjects(written).catch(() => {});
      await db.upload.deleteMany({ where: { key: { in: written } } }).catch(() => {});
    }
  };

  try {
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        await rollback();
        return Response.json(
          { error: `${file.name} melebihi batas ${MAX_MB} MB` },
          { status: 413 },
        );
      }
      const ephemeral = usage + file.size > UPLOAD_QUOTA_BYTES;
      const safeName =
        file.name
          .normalize("NFKD")
          .replace(/[^\w.-]+/g, "-")
          .replace(/-+/g, "-")
          .replace(/^[-.]+|[-.]+$/g, "")
          .slice(-80) || "file";
      const base = `uploads/${me.id}`;
      const key = `${ephemeral ? `${base}/tmp` : base}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
      const type = file.type || "application/octet-stream";
      const body = Readable.fromWeb(
        file.stream() as unknown as Parameters<typeof Readable.fromWeb>[0],
      );
      await putObjectStream(key, body, file.size, type);
      written.push(key);
      await db.upload.create({
        data: {
          userId: me.id,
          key,
          name: file.name,
          contentType: type,
          size: file.size,
          ephemeral,
          sessionId: ephemeral ? sessionId : null,
        },
      });
      if (!ephemeral) usage += file.size;
      saved.push({ url: `/api/files/${key}`, name: file.name, size: file.size, type, ephemeral });
    }
  } catch {
    await rollback();
    return Response.json({ error: "Upload gagal" }, { status: 500 });
  }

  return Response.json({
    files: saved,
    quota: { usedBytes: usage, limitBytes: UPLOAD_QUOTA_BYTES },
    ephemeralCount: saved.filter((s) => s.ephemeral).length,
  });
});
