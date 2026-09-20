"use client";

import { useEffect, useState } from "react";

/** Event beforeinstallprompt (Chrome/Android) — belum ada di lib DOM standar. */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Ajakan memasang calyzr sebagai aplikasi: tombol "Install App" (PWA, Android/
 * Chrome & desktop), unduh APK Android, dan petunjuk "Add to Home Screen" untuk
 * iPhone. Tersembunyi otomatis bila sudah berjalan sebagai aplikasi terpasang.
 */
export function InstallApp() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);

    const ua = navigator.userAgent || "";
    setIsIOS(/iphone|ipad|ipod/i.test(ua));
    const nav = navigator as Navigator & { standalone?: boolean };
    const standalone =
      window.matchMedia?.("(display-mode: standalone)")?.matches || nav.standalone === true;
    if (standalone) setInstalled(true);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice.catch(() => {});
    setDeferred(null);
  }

  if (installed) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">Pasang aplikasi</h2>
      <p className="text-xs text-muted">
        Pakai calyzr seperti aplikasi: ikon di layar utama, buka layar penuh tanpa bar browser.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {deferred && (
          <button
            onClick={() => void install()}
            className="rounded-xl bg-gradient-to-r from-accent-a to-accent-b px-3 py-2 text-sm font-semibold text-black"
          >
            Install App
          </button>
        )}
        <a
          href="/calyzr.apk"
          download
          className="rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm hover:text-ink"
        >
          Unduh APK Android
        </a>
      </div>
      {isIOS ? (
        <p className="text-xs text-muted">
          iPhone: ketuk tombol <b>Bagikan</b> (kotak dengan panah) → <b>Add to Home Screen</b>.
        </p>
      ) : (
        !deferred && (
          <p className="text-xs text-muted">
            Android/Chrome: menu ⋮ → <b>Install app / Tambahkan ke Layar Utama</b>, atau unduh APK di atas.
          </p>
        )
      )}
    </section>
  );
}

/**
 * Versi RINGKAS untuk ditaruh di sidebar: satu tombol pintar. Android/desktop →
 * pasang PWA (bila tersedia) atau unduh APK; iPhone → petunjuk Add to Home Screen.
 * Tersembunyi otomatis bila sudah berjalan sebagai aplikasi terpasang.
 */
export function InstallAppButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);
    window.addEventListener("beforeinstallprompt", onBIP);
    window.addEventListener("appinstalled", onInstalled);
    const ua = navigator.userAgent || "";
    setIsIOS(/iphone|ipad|ipod/i.test(ua));
    const nav = navigator as Navigator & { standalone?: boolean };
    if (window.matchMedia?.("(display-mode: standalone)")?.matches || nav.standalone === true) {
      setInstalled(true);
    }
    return () => {
      window.removeEventListener("beforeinstallprompt", onBIP);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  async function onClick() {
    if (deferred) {
      await deferred.prompt();
      await deferred.userChoice.catch(() => {});
      setDeferred(null);
      return;
    }
    if (isIOS) {
      setShowHint((v) => !v);
      return;
    }
    window.location.href = "/calyzr.apk"; // Android/desktop: unduh APK
  }

  return (
    <div className="mt-2">
      <button
        onClick={() => void onClick()}
        className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-accent-a/40 bg-accent-a/10 px-3 py-2 text-xs font-semibold text-accent-a hover:bg-accent-a/20"
      >
        📥 {deferred ? "Pasang Aplikasi" : isIOS ? "Pasang di iPhone" : "Unduh Aplikasi"}
      </button>
      {showHint && isIOS && (
        <p className="mt-1 text-[10px] leading-relaxed text-muted">
          Di Safari: ketuk <b>Bagikan</b> (kotak panah) → <b>Add to Home Screen</b>.
        </p>
      )}
    </div>
  );
}
