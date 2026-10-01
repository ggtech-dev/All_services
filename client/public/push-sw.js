/* Phone notifications (loaded into the app's service worker). Shows the alert even when the app is closed,
   and opens the right screen when it is tapped. */
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'All Services', body: event.data ? event.data.text() : '' };
  }
  const urgent = data.kind === 'new_order' || data.kind === 'assigned';
  event.waitUntil((async () => {
    // tell open app windows too (they play the in-app sound)
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    wins.forEach((w) => w.postMessage({ type: 'push', data }));
    await self.registration.showNotification(data.title || 'All Services', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/favicon-48.png',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      requireInteraction: urgent, // new orders stay on screen until the agent taps them
      vibrate: urgent ? [300, 120, 300, 120, 600] : [150],
      data: { url: data.url || '/' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = wins.find((w) => w.url.startsWith(self.location.origin));
    if (same) {
      await same.focus();
      if ('navigate' in same) return same.navigate(url).catch(() => {});
      return undefined;
    }
    return self.clients.openWindow(url);
  })());
});
