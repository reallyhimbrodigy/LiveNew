const CACHE_NAME = "livenew-v1";
const CORE_ASSETS = [
  "/day",
  "/progress",
  "/assets/app.css",
  "/manifest.json",
  "/assets/icon-192.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(e.request))
  );
});

self.addEventListener("message", (e) => {
  if (e.data?.type === "schedule-notifications") {
    const { schedule } = e.data;
    scheduleNotification(schedule.midday, "Your midday plan is ready", "Take 5 minutes to bring your stress down.");
    scheduleNotification(schedule.evening, "Your evening plan is ready", "Your evening plan is ready.");
  }
});

function scheduleNotification(targetHour, title, body) {
  const now = new Date();
  const target = new Date();
  target.setHours(targetHour, 0, 0, 0);

  if (target <= now) return;

  const delay = target.getTime() - now.getTime();

  setTimeout(() => {
    self.registration.showNotification(title, {
      body,
      icon: "/assets/icon-192.png",
      badge: "/assets/icon-192.png",
      tag: `livenew-${targetHour}`,
      data: { url: "/day" },
    });
  }, delay);
}

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: "window" }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes("/day") && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow("/day");
      return null;
    })
  );
});
