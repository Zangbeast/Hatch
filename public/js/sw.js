self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch (e) {
    payload = { title: 'Meds Reminder', body: event.data.text() };
  }
  const options = {
    body: payload.body || '',
    tag: payload.tag || 'meds',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: payload,
    renotify: true,
  };
  event.waitUntil(self.registration.showNotification(payload.title || 'Meds Reminder', options));
});

// Tapping a notification only ever opens/focuses the app — there are no
// action buttons, so "meds taken" can only be confirmed from inside the
// app itself (see the reminder prompt in app.js).
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/');
    })
  );
});
