/**
 * Service Worker for Web Push Notifications
 * Handles push events and notification clicks even when browser is closed
 */

// Service Worker version - increment when updating
const VERSION = 'v1.0.1';

console.log(`[ServiceWorker ${VERSION}] Loading...`);

// Install event - cache resources if needed
self.addEventListener('install', event => {
  console.log(`[ServiceWorker ${VERSION}] Installing...`);
  self.skipWaiting(); // Activate immediately
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  console.log(`[ServiceWorker ${VERSION}] Activating...`);
  event.waitUntil(self.clients.claim()); // Take control immediately
});

// Push event - received when server sends a push notification
self.addEventListener('push', event => {
  console.log('[ServiceWorker] Push received:', event);
  console.log('[ServiceWorker] Has data:', !!event.data);
  
  let notificationData = {
    title: 'Book Your Shifts',
    body: 'Don\'t forget to book your shifts for next week!',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: 'shift-booking-reminder',
    requireInteraction: false,
    vibrate: [200, 100, 200],
    data: {
      url: '/employee/shifts',
      timestamp: Date.now()
    }
  };

  // Parse notification data from server if provided
  if (event.data) {
    try {
      console.log('[ServiceWorker] Parsing push data...');
      const serverData = event.data.json();
      console.log('[ServiceWorker] Server data:', serverData);
      
      notificationData = {
        ...notificationData,
        title: serverData.title || notificationData.title,
        body: serverData.message || serverData.body || notificationData.body,
        data: {
          ...notificationData.data,
          ...serverData.data
        }
      };
    } catch (e) {
      console.error('[ServiceWorker] Error parsing push data:', e);
      // Use notification text as body if JSON parsing fails
      try {
        const text = event.data.text();
        console.log('[ServiceWorker] Using text data:', text);
        notificationData.body = text || notificationData.body;
      } catch (textError) {
        console.error('[ServiceWorker] Error reading text:', textError);
      }
    }
  }

  console.log('[ServiceWorker] Showing notification:', notificationData.title);

  // Show the notification
  const notificationPromise = self.registration.showNotification(notificationData.title, {
    body: notificationData.body,
    icon: notificationData.icon,
    badge: notificationData.badge,
    tag: notificationData.tag,
    requireInteraction: notificationData.requireInteraction,
    vibrate: notificationData.vibrate,
    data: notificationData.data
  });

  notificationPromise.then(() => {
    console.log('[ServiceWorker] ✅ Notification shown successfully');
  }).catch(err => {
    console.error('[ServiceWorker] ❌ Failed to show notification:', err);
  });

  event.waitUntil(notificationPromise);
});

// Notification click event - handle when user clicks the notification
self.addEventListener('notificationclick', event => {
  console.log('[ServiceWorker] Notification clicked:', event);
  
  event.notification.close(); // Close the notification

  // Get the URL from notification data
  const urlToOpen = event.notification.data?.url || '/employee/shifts';

  // Open or focus the app window
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        // Check if there's already a window open to the app
        for (let client of windowClients) {
          if (client.url.includes(self.registration.scope) && 'focus' in client) {
            // Focus existing window and navigate to URL
            return client.focus().then(client => {
              if ('navigate' in client) {
                return client.navigate(urlToOpen);
              }
            });
          }
        }
        // No window open, open a new one
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// Handle push subscription change (e.g., token refresh)
self.addEventListener('pushsubscriptionchange', event => {
  console.log('[ServiceWorker] Push subscription changed');
  
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: self.vapidPublicKey
    })
    .then(subscription => {
      console.log('[ServiceWorker] Re-subscribed:', subscription);
      
      // Send new subscription to server
      return fetch('/employee/notifications/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ subscription })
      });
    })
  );
});

// Message event - handle messages from main app
self.addEventListener('message', event => {
  console.log('[ServiceWorker] Message received:', event.data);
  
  if (event.data.type === 'CHECK_UPDATE') {
    // Check for service worker updates
    self.registration.update();
  }
  
  if (event.data.type === 'SET_VAPID_KEY') {
    // Store VAPID public key
    self.vapidPublicKey = event.data.key;
  }
});

console.log(`[ServiceWorker ${VERSION}] Loaded successfully`);
