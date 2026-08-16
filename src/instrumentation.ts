/**
 * Next.js instrumentation: dijalankan sekali saat server start.
 * Memulai penjadwal tugas terjadwal (hanya di runtime Node, bukan edge).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("@/server/tasks");
  startScheduler();
}
