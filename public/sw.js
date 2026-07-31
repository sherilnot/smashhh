/**
 * Service Worker — PWA + Web Push Notifications
 * Provides offline caching and handles push events
 */

const VERSION = 'v5.0.0';
const CACHE_NAME = `rizins-cache-${VERSION}`;

// Assets to pre-cache on install (app shell)
const APP_SHELL = [
  '/css/theme.css',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/manifest.json'
];

console.log(`[ServiceWorker ${VERSION}] Loading...`);

// ─── Install: pre-cache app shell ───────────────────────────────────────────
self.addEventListener('install', event => {
  console.log(`[ServiceWorker ${VERSION}] Installing...`);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate: clean old caches ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  console.log(`[ServiceWorker ${VERSION}] Activating...`);
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch: network-first with cache fallback ───────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;

  // Skip non-GET and cross-origin requests
  if (request.method !== 'GET' || !request.url.startsWith(self.location.origin)) {
    return;
  }

  // For navigation requests, try network first, fall back to offline page
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          // Cache successful page responses
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('/offline.html')))
    );
    return;
  }

  // For static assets (css, js, images), cache-first
  if (request.url.match(/\.(css|js|png|jpg|jpeg|svg|ico|woff2?)$/)) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return response;
        });
      })
    );
    return;
  }

  // Everything else: network first, cache fallback
  event.respondWith(
    fetch(request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        return response;
      })
      .catch(() => caches.match(request))
  );
});

// ─── Push Notifications ─────────────────────────────────────────────────────
self.addEventListener('push', event => {
  let notificationData = {
    title: 'Book Your Shifts',
    body: "Don't forget to book your shifts for next week!",
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: 'shift-booking-reminder',
    requireInteraction: false,
    vibrate: [200, 100, 200],
    data: {
      url: '/employee/shifts',
      timestamp: Date.now()
    }
  };

  if (event.data) {
    try {
      const serverData = event.data.json();
      notificationData = {
        ...notificationData,
        title: serverData.title || notificationData.title,
        body: serverData.message || serverData.body || notificationData.body,
        data: { ...notificationData.data, ...serverData.data }
      };
    } catch (e) {
      try {
        const text = event.data.text();
        notificationData.body = text || notificationData.body;
      } catch (_) {}
    }
  }

  event.waitUntil(
    self.registration.showNotification(notificationData.title, {
      body: notificationData.body,
      icon: notificationData.icon,
      badge: notificationData.badge,
      tag: notificationData.tag,
      requireInteraction: notificationData.requireInteraction,
      vibrate: notificationData.vibrate,
      data: notificationData.data
    })
  );
});

// ─── Notification Click ─────────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const urlToOpen = event.notification.data?.url || '/employee/shifts';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url.includes(self.registration.scope) && 'focus' in client) {
          return client.focus().then(c => ('navigate' in c) ? c.navigate(urlToOpen) : c);
        }
      }
      return clients.openWindow ? clients.openWindow(urlToOpen) : null;
    })
  );
});

// ─── Push Subscription Change ───────────────────────────────────────────────
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: self.vapidPublicKey
    }).then(subscription =>
      fetch('/employee/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription })
      })
    )
  );
});

// ─── Message handler ────────────────────────────────────────────────────────
self.addEventListener('message', event => {
  if (event.data.type === 'CHECK_UPDATE') self.registration.update();
  if (event.data.type === 'SET_VAPID_KEY') self.vapidPublicKey = event.data.key;
});

console.log(`[ServiceWorker ${VERSION}] Loaded successfully`);
