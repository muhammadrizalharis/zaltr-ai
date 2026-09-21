/**
 * WORKSPACE per percakapan untuk agen: kumpulan berkas (lampiran pengguna +
 * hasil kerja agen) yang dihidrasi ke runner terisolasi saat eksekusi, lalu
 * berkas BARU/BERUBAH disimpan kembali ke MinIO (uploads/<uid>/ws/<conv>/...)
 * + baris Upload agar bisa diunduh via /api/files dan ikut backup.
 *
 * Keamanan: runner sudah tanpa internet & tanpa akses service lain; path relatif
 * disanitasi; semua berkas hanya milik user pemilik percakapan.
 */
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getObjectBuffer, putObject } from "@/lib/storage";

const RUNNER_URL = (process.env.ZALTR_RUNNER_URL ?? "").replace(/\/$/, "");
const MAX_HYDRATE_BYTES = 40 * 1024 * 1024;

export type RunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timeMs: number;
  /** Berkas yang dihasilkan/diubah: nama relatif -> URL unduh. */
  outputs: Array<{ path: string; url: string; size: number }>;
  listing: string[];
};

export function wsPrefix(userId: string, conversationId: string): string {
  return `uploads/${userId}/ws/${conversationId}/`;
}

function safeRel(p: string): string | null {
  const s = p.replace(/^\/+/, "").replace(/\/{2,}/g, "/").trim();
  if (!s || s.includes("..") || s.includes("\\") || s.includes("\0") || !/^[\w][\w.\- \/()]*$/.test(s)) return null;
  return s;
}

/** Ekstensi yang boleh ditulis sebagai TEKS via AKSI: tulis (biner harus lewat kode). */
export const TEXT_WRITE_EXT = new Set([
  "txt", "md", "py", "js", "ts", "json", "csv", "tsv", "html", "css", "xml", "yaml", "yml",
  "sh", "sql", "toml", "ini", "cfg", "env", "tex", "bib", "rst", "svg", "ipynb", "r", "java", "c", "cpp", "h", "go", "rs",
]);

function guessType(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    csv: "text/csv",
    txt: "text/plain",
    md: "text/markdown",
    json: "application/json",
    html: "text/html",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    svg: "image/svg+xml",
    py: "text/x-python",
    zip: "application/zip",
  };
  return map[ext] ?? "application/octet-stream";
}

/** Berkas workspace saat ini (hasil agen sebelumnya) — dari tabel Upload. */
export async function listWorkspace(userId: string, conversationId: string) {
  const prefix = wsPrefix(userId, conversationId);
  const rows = await db.upload.findMany({
    where: { userId, key: { startsWith: prefix } },
    select: { key: true, name: true, size: true },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    path: r.key.slice(prefix.length),
    key: r.key,
    size: r.size,
    url: `/api/files/${r.key}`,
  }));
}

/**
 * Kumpulkan berkas masuk: lampiran percakapan (keys /api/files/uploads/...)
 * ke folder `input/`, plus seluruh workspace hasil sebelumnya.
 */
async function hydrate(
  userId: string,
  conversationId: string,
  attachmentKeys: string[],
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  let total = 0;
  const add = async (rel: string, key: string) => {
    if (total > MAX_HYDRATE_BYTES) return;
    try {
      const buf = await getObjectBuffer(key);
      total += buf.length;
      if (total > MAX_HYDRATE_BYTES) return;
      files[rel] = buf.toString("base64");
    } catch (e) {
      console.error(`[workspace] gagal hidrasi ${key}: ${(e as Error).message}`);
    }
  };
  // Workspace lama dulu (hasil agen), lalu lampiran ke input/.
  for (const w of await listWorkspace(userId, conversationId)) {
    await add(w.path, w.key);
  }
  const seen = new Set<string>();
  for (const key of attachmentKeys) {
    if (!key.startsWith(`uploads/${userId}/`) || key.startsWith(wsPrefix(userId, conversationId))) continue;
    const name = key.split("/").pop() ?? key;
    // Nama asli tanpa prefix timestamp-uuid (uploads memakai `<ts>-<8hex>-<nama>`).
    const clean = name.replace(/^\d{10,}-[0-9a-f]{8}-/, "");
    let rel = `input/${clean}`;
    if (seen.has(rel)) rel = `input/${name}`;
    seen.add(rel);
    await add(rel, key);
  }
  return files;
}

/** Simpan berkas keluaran runner ke MinIO + Upload row (upsert by key). */
async function persistOutputs(
  userId: string,
  conversationId: string,
  sessionId: string | null,
  outFiles: Record<string, string>,
): Promise<RunResult["outputs"]> {
  const prefix = wsPrefix(userId, conversationId);
  const outputs: RunResult["outputs"] = [];
  for (const [rel, b64] of Object.entries(outFiles)) {
    const s = safeRel(rel);
    if (!s) continue;
    const buf = Buffer.from(b64, "base64");
    const key = prefix + s;
    const type = guessType(s);
    try {
      await putObject(key, buf, type);
      await db.upload.upsert({
        where: { key },
        create: {
          userId,
          key,
          name: s.split("/").pop() ?? s,
          contentType: type,
          size: buf.length,
          ephemeral: false,
          sessionId,
        },
        update: { size: buf.length, contentType: type, lastActiveAt: new Date() },
      });
      outputs.push({ path: s, url: `/api/files/${key}?v=${Date.now()}`, size: buf.length });
    } catch (e) {
      console.error(`[workspace] gagal simpan ${key}: ${(e as Error).message}`);
    }
  }
  return outputs;
}

/**
 * Jalankan kode (python|sh) di runner dengan workspace percakapan terhidrasi.
 * Berkas baru/berubah otomatis dipersistenkan & dikembalikan sebagai link.
 */
export async function runInWorkspace(opts: {
  userId: string;
  conversationId: string;
  attachmentKeys: string[];
  lang: "python" | "sh";
  code: string;
  timeoutS?: number;
  sessionId?: string | null;
}): Promise<RunResult> {
  if (!RUNNER_URL) {
    return { stdout: "", stderr: "runner tidak tersedia", exitCode: 1, timeMs: 0, outputs: [], listing: [] };
  }
  const files = await hydrate(opts.userId, opts.conversationId, opts.attachmentKeys);
  const res = await fetch(`${RUNNER_URL}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: opts.code.slice(0, 60_000), lang: opts.lang, files, timeout: opts.timeoutS ?? 60 }),
    signal: AbortSignal.timeout(((opts.timeoutS ?? 60) + 30) * 1000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { stdout: "", stderr: `runner error ${res.status}: ${t.slice(0, 300)}`, exitCode: 1, timeMs: 0, outputs: [], listing: [] };
  }
  const d = (await res.json()) as {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    timeMs?: number;
    files?: Record<string, string>;
    listing?: string[];
  };
  const outputs = await persistOutputs(opts.userId, opts.conversationId, opts.sessionId ?? null, d.files ?? {});
  return {
    stdout: d.stdout ?? "",
    stderr: d.stderr ?? "",
    exitCode: d.exitCode ?? 0,
    timeMs: d.timeMs ?? 0,
    outputs,
    listing: d.listing ?? [],
  };
}

/** Tulis satu berkas teks langsung ke workspace (tanpa runner). */
export async function writeWorkspaceFile(opts: {
  userId: string;
  conversationId: string;
  path: string;
  content: string;
  sessionId?: string | null;
}): Promise<{ path: string; url: string } | null> {
  const s = safeRel(opts.path);
  if (!s) return null;
  const buf = Buffer.from(opts.content, "utf8");
  const key = wsPrefix(opts.userId, opts.conversationId) + s;
  const type = guessType(s);
  await putObject(key, buf, type);
  await db.upload.upsert({
    where: { key },
    create: {
      userId: opts.userId,
      key,
      name: s.split("/").pop() ?? s,
      contentType: type,
      size: buf.length,
      ephemeral: false,
      sessionId: opts.sessionId ?? null,
    },
    update: { size: buf.length, lastActiveAt: new Date() },
  });
  return { path: s, url: `/api/files/${key}?v=${Date.now()}` };
}

/** Baca berkas teks dari workspace atau lampiran (input/<nama>). */
export async function readWorkspaceFile(opts: {
  userId: string;
  conversationId: string;
  attachmentKeys: string[];
  path: string;
  limit?: number;
}): Promise<string | null> {
  const s = safeRel(opts.path);
  if (!s) return null;
  let key: string | null = null;
  if (s.startsWith("input/")) {
    const want = s.slice(6);
    key =
      opts.attachmentKeys.find((k) => {
        const name = k.split("/").pop() ?? "";
        return name === want || name.replace(/^\d{10,}-[0-9a-f]{8}-/, "") === want;
      }) ?? null;
  } else {
    key = wsPrefix(opts.userId, opts.conversationId) + s;
  }
  if (!key) return null;
  try {
    const buf = await getObjectBuffer(key);
    const { extractText } = await import("@/server/extract");
    const text = await extractText(buf, s.split("/").pop() ?? s, opts.limit ?? 60_000);
    return text ?? buf.toString("utf8").slice(0, opts.limit ?? 60_000);
  } catch {
    return null;
  }
}

export function newRunId(): string {
  return randomUUID();
}

/** Hapus SELURUH workspace percakapan (objek MinIO + baris Upload). */
export async function deleteWorkspace(userId: string, conversationId: string): Promise<number> {
  const prefix = wsPrefix(userId, conversationId);
  const rows = await db.upload.findMany({ where: { userId, key: { startsWith: prefix } }, select: { key: true } });
  if (rows.length === 0) return 0;
  const { removeObjects } = await import("@/lib/storage");
  await removeObjects(rows.map((r) => r.key)).catch(() => {});
  await db.upload.deleteMany({ where: { userId, key: { startsWith: prefix } } });
  return rows.length;
}

/**
 * Sweep: hapus workspace yang percakapannya sudah TIDAK ADA (hard-deleted) atau
 * di-trash lebih dari `trashDays` hari. Dipanggil scheduler harian.
 */
export async function sweepOrphanWorkspaces(trashDays = 30): Promise<number> {
  const rows = await db.upload.findMany({
    where: { key: { contains: "/ws/" } },
    select: { userId: true, key: true },
    take: 5000,
  });
  const byConv = new Map<string, { userId: string; convId: string }>();
  for (const r of rows) {
    const m = r.key.match(/^uploads\/([^/]+)\/ws\/([^/]+)\//);
    if (m) byConv.set(`${m[1]}:${m[2]}`, { userId: m[1], convId: m[2] });
  }
  if (byConv.size === 0) return 0;
  const convIds = [...byConv.values()].map((v) => v.convId);
  const alive = await db.conversation.findMany({
    where: { id: { in: convIds } },
    select: { id: true, trashedAt: true },
  });
  const cutoff = Date.now() - trashDays * 86_400_000;
  const keep = new Set(
    alive.filter((c) => !c.trashedAt || c.trashedAt.getTime() > cutoff).map((c) => c.id),
  );
  let removed = 0;
  for (const v of byConv.values()) {
    if (keep.has(v.convId)) continue;
    removed += await deleteWorkspace(v.userId, v.convId).catch(() => 0);
  }
  return removed;
}
