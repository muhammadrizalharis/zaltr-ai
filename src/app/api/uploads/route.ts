import { randomUUID } from "node:crypto";
import { putObject } from "@/lib/storage";
import { guarded, requireUser } from "@/server/auth";

export const runtime = "nodejs";

const MAX_FILES = 5;
const MAX_SIZE = 25 * 1024 * 1024; // 25 MB per file

/**
 * Upload lampiran chat (semua jenis file) ke MinIO.
 * Key: uploads/<userId>/<ts>-<rand>-<nama-aman> — dilayani balik oleh
 * /api/files/[...key] (auth wajib). File ikut backup harian MinIO.
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

  const saved = [];
  for (const file of files) {
    if (file.size > MAX_SIZE) {
      return Response.json(
        { error: `${file.name} melebihi batas 25 MB` },
        { status: 413 },
      );
    }
    const safeName =
      file.name
        .normalize("NFKD")
        .replace(/[^\w.-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-.]+|[-.]+$/g, "")
        .slice(-80) || "file";
    const key = `uploads/${me.id}/${Date.now()}-${randomUUID().slice(0, 8)}-${safeName}`;
    const buf = Buffer.from(await file.arrayBuffer());
    await putObject(key, buf, file.type || "application/octet-stream");
    saved.push({
      key,
      url: `/api/files/${key}`,
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
    });
  }
  return Response.json({ files: saved });
});
