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

// Web Push: tampilkan notifikasi saat pesan push tiba (app boleh tertutup).
self.addEventListener("push", (event) => {
  let data = { title: "calyzr.ai", body: "Notifikasi", url: "/chat", tag: "calyzr" };
  try {
    if (event.data) data = Object.assign(data, event.data.json());
  } catch (e) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/logo-192.png",
      badge: "/logo-192.png",
      tag: data.tag,
      data: { url: data.url || "/chat" },
    }),
  );
});

// Klik notifikasi: fokuskan tab yang sudah ada atau buka jendela baru.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/chat";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) {
          if ("navigate" in c) c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
