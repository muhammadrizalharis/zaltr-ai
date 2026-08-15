/*
 * Service worker calyzr.ai — sengaja MINIMAL.
 *
 * Isi chat bersifat pribadi, jadi SW ini TIDAK PERNAH menyimpan HTML, respons
 * API, atau berkas lampiran ke cache. Tugasnya hanya dua: memenuhi syarat
 * "installable" dan menampilkan halaman offline saat jaringan mati.
 */
const CACHE = "calyzr-shell-v1";
const SHELL = ["/offline.html", "/logo-192.png", "/logo-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.mode !== "navigate") return;
  event.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
});
