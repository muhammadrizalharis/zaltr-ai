import { currentSessionId, guarded, requireUser } from "@/server/auth";
import { touchSessionUploads } from "@/server/uploads";

export const runtime = "nodejs";

/**
 * Denyut (heartbeat) dari klien selama aplikasi terbuka: perbarui lastActiveAt
 * lampiran sementara milik sesi agar tidak dihapus pembersih TTL. Saat aplikasi
 * ditutup, denyut berhenti → file dibersihkan setelah masa tenggang.
 */
export const POST = guarded(async () => {
  await requireUser();
  const sid = await currentSessionId();
  if (sid) await touchSessionUploads(sid);
  return Response.json({ ok: true });
});
