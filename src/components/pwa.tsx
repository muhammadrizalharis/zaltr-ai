"use client";

import { useEffect } from "react";

/** Mendaftarkan service worker agar aplikasi bisa dipasang di layar utama HP. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  return null;
}
