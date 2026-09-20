"use client";

import { useEffect, useState } from "react";

/** VAPID public key (base64url) -> Uint8Array untuk applicationServerKey. */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/**
 * Aktifkan/matikan notifikasi Web Push. Minta izin, berlangganan via service
 * worker + kunci VAPID server, lalu kirim langganan ke server. Tombol "Kirim tes".
 */
export function PushToggle() {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const ok =
      "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    setSupported(ok);
    if (ok) {
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => setEnabled(Boolean(sub)))
        .catch(() => {});
    }
  }, []);

  async function enable() {
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error("Izin notifikasi ditolak.");
      const info = (await fetch("/api/push/vapid").then((r) => r.json())) as {
        publicKey?: string;
        enabled?: boolean;
      };
      if (!info.enabled || !info.publicKey) throw new Error("Push belum dikonfigurasi di server.");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(info.publicKey) as BufferSource,
      });
      const j = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: j.endpoint, keys: j.keys, ua: navigator.userAgent }),
      });
      if (!res.ok) throw new Error("Gagal menyimpan langganan.");
      setEnabled(true);
      setMsg("Notifikasi aktif ✅");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Gagal mengaktifkan notifikasi.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch(`/api/push/subscribe?endpoint=${encodeURIComponent(sub.endpoint)}`, {
          method: "DELETE",
        });
        await sub.unsubscribe();
      }
      setEnabled(false);
      setMsg("Notifikasi dimatikan.");
    } catch {
      setMsg("Gagal mematikan.");
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    const r = (await fetch("/api/push/test", { method: "POST" })
      .then((x) => x.json())
      .catch(() => ({ sent: 0 }))) as { sent?: number };
    setMsg((r.sent ?? 0) > 0 ? "Notifikasi tes dikirim 📲" : "Belum ada perangkat aktif.");
    setBusy(false);
  }

  if (!supported) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Notifikasi</h2>
      <p className="text-xs text-muted">
        Dapatkan notifikasi di HP/desktop saat <b>tugas terjadwal</b> selesai — meski app ditutup.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {!enabled ? (
          <button
            onClick={() => void enable()}
            disabled={busy}
            className="rounded-xl bg-gradient-to-r from-accent-a to-accent-b px-3 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {busy ? "…" : "Aktifkan notifikasi"}
          </button>
        ) : (
          <>
            <button
              onClick={() => void test()}
              disabled={busy}
              className="rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm hover:text-ink disabled:opacity-40"
            >
              Kirim tes
            </button>
            <button
              onClick={() => void disable()}
              disabled={busy}
              className="rounded-xl border border-line px-3 py-2 text-sm text-muted hover:text-red-400 disabled:opacity-40"
            >
              Matikan
            </button>
          </>
        )}
        {msg && <span className="text-xs text-muted">{msg}</span>}
      </div>
    </section>
  );
}
