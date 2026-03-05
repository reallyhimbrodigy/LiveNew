self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(clients.claim());
});

self.addEventListener("message", (e) => {
  if (e.data?.type === "schedule-notifications") {
    const { schedule } = e.data;
    scheduleNotification(schedule.midday, "Your midday reset is ready", "Take 5 minutes to bring your stress down.");
    scheduleNotification(schedule.evening, "Time to wind down", "Your evening wind-down is ready.");
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
