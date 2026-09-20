/**
 * Next.js instrumentation: dijalankan sekali saat server start.
 * Memulai penjadwal tugas terjadwal (hanya di runtime Node, bukan edge).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("@/server/tasks");
  startScheduler();
}

/**
 * Hook error server global (route handler, RSC, dll). Dicatat ke log + alert
 * Telegram (di-throttle). Best-effort: kegagalan alert tak boleh melempar.
 */
export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
  context: { routePath?: string; routerKind?: string; routeType?: string },
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const e = error as { message?: string; stack?: string };
    const msg = (e?.message || String(error)).slice(0, 300);
    const path = request?.path || context?.routePath || "?";
    console.error(`[server-error] ${request?.method || ""} ${path} (${context?.routeType || context?.routerKind || ""}): ${msg}`);
    const { notifyTelegram } = await import("@/server/notify");
    await notifyTelegram(`\u{1f534} Error server\n${request?.method || ""} ${path}\n${msg}`, {
      key: `srverr:${path}:${msg.slice(0, 60)}`,
      cooldownMs: 300_000,
    });
  } catch {
    // jangan pernah melempar dari hook error
  }
}
