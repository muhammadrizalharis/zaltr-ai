import { db } from "@/lib/db";
import { removeObjects } from "@/lib/storage";

/** Batas ukuran per berkas (default 500 MB). */
export const MAX_UPLOAD_BYTES =
  (Number(process.env.ZALTR_MAX_UPLOAD_MB) || 500) * 1024 * 1024;

/** Kuota penyimpanan permanen per user (default 5 GB). */
export const UPLOAD_QUOTA_BYTES =
  (Number(process.env.ZALTR_UPLOAD_QUOTA_GB) || 5) * 1024 * 1024 * 1024;

/** Jaring pengaman: hapus lampiran sementara yang menganggur lebih lama dari ini. */
const STALE_HOURS = Number(process.env.ZALTR_EPHEMERAL_TTL_HOURS) || 12;

/** Total byte lampiran PERMANEN milik user (dasar perhitungan kuota). */
export async function permanentUsage(userId: string): Promise<number> {
  const r = await db.upload.aggregate({
    _sum: { size: true },
    where: { userId, ephemeral: false },
  });
  return r._sum.size ?? 0;
}

/** Hapus objek MinIO + baris untuk daftar upload tertentu. */
async function purge(rows: Array<{ id: string; key: string }>): Promise<number> {
  if (!rows.length) return 0;
  await removeObjects(rows.map((r) => r.key)).catch(() => {});
  await db.upload.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  return rows.length;
}

/** Hapus semua lampiran sementara milik satu sesi (dipanggil saat logout/tutup). */
export async function deleteEphemeralForSession(sessionId: string): Promise<number> {
  const rows = await db.upload.findMany({
    where: { sessionId, ephemeral: true },
    select: { id: true, key: true },
  });
  return purge(rows);
}

/** Perbarui denyut (heartbeat) lampiran sementara sesi agar tak kena TTL. */
export async function touchSessionUploads(sessionId: string): Promise<void> {
  await db.upload.updateMany({
    where: { sessionId, ephemeral: true },
    data: { lastActiveAt: new Date() },
  });
}

/** Pembersih terjadwal: buang lampiran sementara yang menganggur > STALE_HOURS. */
export async function cleanupStaleEphemeral(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_HOURS * 3_600_000);
  const rows = await db.upload.findMany({
    where: { ephemeral: true, lastActiveAt: { lt: cutoff } },
    select: { id: true, key: true },
  });
  return purge(rows);
}
