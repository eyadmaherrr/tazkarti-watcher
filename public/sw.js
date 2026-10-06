self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Server-sent Web Push: arrives even when no Tazkarti Watch tab is open.
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { body: event.data && event.data.text() };
  }
  event.waitUntil(
    self.registration.showNotification(d.title || "Tazkarti Watch", {
      body: d.body || "",
      icon: "/icon.svg",
      badge: "/icon.svg",
      tag: "tazkarti-watch",
      renotify: true,
      requireInteraction: true,
      vibrate: [500, 200, 500, 200, 500],
      data: { url: d.url || "/" },
    }),
  );
});

// Tapping a notification counts as "I've seen it": stop the server re-sending reminders to this browser.
async function ack() {
  try {
    const sub = await self.registration.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "web", endpoint: sub.endpoint }),
      });
    }
  } catch {}
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    Promise.all([
      ack(),
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
        for (const c of list) if ("focus" in c) return c.focus();
        return self.clients.openWindow(url);
      }),
    ]),
  );
});
