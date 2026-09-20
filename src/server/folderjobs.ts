import { randomUUID } from "node:crypto";

/**
 * Penyimpan progres pengindeksan folder (in-memory; web single-instance).
 * Folder route mengembalikan jobId segera lalu memproses di latar; klien polling
 * GET /api/uploads/folder?job=<id> untuk bar progres.
 */
export type FolderJob = {
  userId: string;
  folder: string;
  total: number;
  done: number;
  indexedCount: number;
  skippedCount: number;
  totalChunks: number;
  status: "running" | "done" | "error";
  error?: string;
  startedAt: number;
};

const jobs = new Map<string, FolderJob>();

export function createFolderJob(userId: string, folder: string, total: number, preSkipped = 0): string {
  const id = randomUUID();
  jobs.set(id, {
    userId,
    folder,
    total,
    done: 0,
    indexedCount: 0,
    skippedCount: preSkipped,
    totalChunks: 0,
    status: "running",
    startedAt: Date.now(),
  });
  return id;
}

export function getFolderJob(id: string, userId: string): FolderJob | null {
  const j = jobs.get(id);
  return j && j.userId === userId ? j : null;
}

export function bumpFolderJob(
  id: string,
  d: { done?: number; indexed?: number; skipped?: number; chunks?: number },
): void {
  const j = jobs.get(id);
  if (!j) return;
  if (d.done) j.done += d.done;
  if (d.indexed) j.indexedCount += d.indexed;
  if (d.skipped) j.skippedCount += d.skipped;
  if (d.chunks) j.totalChunks += d.chunks;
}

export function finishFolderJob(id: string, status: "done" | "error", error?: string): void {
  const j = jobs.get(id);
  if (!j) return;
  j.status = status;
  if (error) j.error = error;
}

// Bersihkan job lama (>1 jam) berkala agar map tak tumbuh tak terbatas.
const sweep = setInterval(
  () => {
    const now = Date.now();
    for (const [k, j] of jobs) if (now - j.startedAt > 3_600_000) jobs.delete(k);
  },
  300_000,
);
(sweep as unknown as { unref?: () => void }).unref?.();
