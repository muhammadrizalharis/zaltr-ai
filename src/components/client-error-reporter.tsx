"use client";

import { useEffect } from "react";

/**
 * Pelapor error klien: menangkap window.onerror & unhandledrejection lalu
 * mengirim ringkasannya ke /api/client-log (best-effort). Dibatasi agar tak
 * membanjiri: dedupe per-pesan + maksimum beberapa laporan per sesi tab.
 */
export function ClientErrorReporter() {
  useEffect(() => {
    const seen = new Set<string>();
    let sent = 0;
    const MAX = 8;

    function report(kind: string, message: string, url?: string, stack?: string) {
      if (!message) return;
      // Abaikan noise dari ekstensi browser (di luar kendali kita).
      if (/chrome-extension:\/\/|moz-extension:\/\//.test(message + (stack || ""))) return;
      const sig = kind + "|" + message.slice(0, 120);
      if (seen.has(sig) || sent >= MAX) return;
      seen.add(sig);
      sent += 1;
      try {
        const payload = JSON.stringify({
          kind,
          message,
          url: url || location.pathname,
          stack,
        });
        fetch("/api/client-log", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      } catch {
        // JSON/serialisasi gagal -> lewati
      }
    }

    function onError(e: ErrorEvent) {
      report("error", e.message || String(e.error || ""), e.filename, e.error?.stack);
    }
    function onRejection(e: PromiseRejectionEvent) {
      const r = e.reason;
      const msg = r instanceof Error ? r.message : typeof r === "string" ? r : JSON.stringify(r);
      report("unhandledrejection", msg, undefined, r instanceof Error ? r.stack : undefined);
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
