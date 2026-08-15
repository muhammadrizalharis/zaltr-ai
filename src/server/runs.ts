/**
 * Registry generasi chat yang sedang berjalan.
 *
 * Tujuannya memisahkan "klien menutup koneksi" (pindah halaman/tab, jaringan
 * putus) dari "pengguna menekan Stop". Provider hanya mendengarkan signal di
 * registry ini, sehingga jawaban tetap diselesaikan dan tersimpan meski
 * browser meninggalkan halaman.
 */
const runs = new Map<string, { userId: string; controller: AbortController }>();

export function startRun(userId: string): { runId: string; signal: AbortSignal } {
  const runId = crypto.randomUUID();
  const controller = new AbortController();
  runs.set(runId, { userId, controller });
  return { runId, signal: controller.signal };
}

/** Batalkan generasi milik user tsb; false bila run tidak ada / bukan miliknya. */
export function abortRun(runId: string, userId: string): boolean {
  const run = runs.get(runId);
  if (!run || run.userId !== userId) return false;
  run.controller.abort();
  runs.delete(runId);
  return true;
}

export function endRun(runId: string): void {
  runs.delete(runId);
}
