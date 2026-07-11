/**
 * Web Push Notification Manager
 * Handles service worker registration and push subscriptions
 */

class WebPushNotificationManager {
  constructor() {
    this.serviceWorkerRegistration = null;
    this.vapidPublicKey = null;
    this.isSupported = this.checkSupport();
  }

  /**
   * Check if browser supports service workers and push notifications
   */
  checkSupport() {
    if (!('serviceWorker' in navigator)) {
      console.warn('[WebPush] Service Workers not supported');
      return false;
    }
    if (!('PushManager' in window)) {
      console.warn('[WebPush] Push API not supported');
      return false;
    }
    if (!('Notification' in window)) {
      console.warn('[WebPush] Notifications not supported');
      return false;
    }
    return true;
  }

  /**
   * Initialize the Web Push system
   */
  async initialize() {
    if (!this.isSupported) {
      console.log('[WebPush] Web Push not supported, falling back to basic notifications');
      return false;
    }

    try {
      // Fetch VAPID public key from server
      const response = await fetch('/employee/notifications/vapid-public-key');
      const data = await response.json();
      this.vapidPublicKey = data.publicKey;

      console.log('[WebPush] VAPID public key fetched');

      // Register service worker
      await this.registerServiceWorker();

      // Check existing subscription
      const existingSubscription = await this.getSubscription();
      if (existingSubscription) {
        console.log('[WebPush] Already subscribed');
        localStorage.setItem('webPushEnabled', 'true');
      } else {
        const enabled = localStorage.getItem('webPushEnabled');
        if (enabled === 'true') {
          // Was enabled before but subscription lost, re-subscribe
          await this.subscribe();
        }
      }

      return true;
    } catch (error) {
      console.error('[WebPush] Initialization error:', error);
      return false;
    }
  }

  /**
   * Register the service worker
   */
  async registerServiceWorker() {
    try {
      this.serviceWorkerRegistration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });

      console.log('[WebPush] Service Worker registered:', this.serviceWorkerRegistration.scope);

      // Send VAPID key to service worker
      if (this.serviceWorkerRegistration.active) {
        this.serviceWorkerRegistration.active.postMessage({
          type: 'SET_VAPID_KEY',
          key: this.vapidPublicKey
        });
      }

      // Wait for service worker to be ready
      await navigator.serviceWorker.ready;
      console.log('[WebPush] Service Worker ready');

      return this.serviceWorkerRegistration;
    } catch (error) {
      console.error('[WebPush] Service Worker registration failed:', error);
      throw error;
    }
  }

  /**
   * Get current push subscription
   */
  async getSubscription() {
    if (!this.serviceWorkerRegistration) {
      await this.registerServiceWorker();
    }

    return await this.serviceWorkerRegistration.pushManager.getSubscription();
  }

  /**
   * Convert VAPID key from base64 to Uint8Array
   */
  urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
      .replace(/\-/g, '+')
      .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  /**
   * Subscribe to push notifications
   */
  async subscribe() {
    try {
      // Request notification permission first
      const permission = await Notification.requestPermission();
      
      if (permission !== 'granted') {
        console.log('[WebPush] Notification permission denied');
        return { success: false, error: 'Permission denied' };
      }

      if (!this.serviceWorkerRegistration) {
        await this.registerServiceWorker();
      }

      // Convert VAPID public key
      const convertedKey = this.urlBase64ToUint8Array(this.vapidPublicKey);

      // Subscribe to push
      const subscription = await this.serviceWorkerRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedKey
      });

      console.log('[WebPush] Push subscription successful:', subscription.endpoint);

      // Send subscription to server
      const response = await fetch('/employee/notifications/webpush-subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ subscription: subscription.toJSON() })
      });

      if (response.ok) {
        console.log('[WebPush] Subscription saved to server');
        localStorage.setItem('webPushEnabled', 'true');
        
        // Show success notification
        this.showLocalNotification(
          '🎉 Notifications Enabled!',
          'You\'ll now receive shift reminders even when the browser is closed.'
        );
        
        return { success: true, subscription };
      } else {
        throw new Error('Failed to save subscription to server');
      }
    } catch (error) {
      console.error('[WebPush] Subscribe error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Unsubscribe from push notifications
   */
  async unsubscribe() {
    try {
      const subscription = await this.getSubscription();
      
      if (subscription) {
        // Unsubscribe from push
        await subscription.unsubscribe();
        console.log('[WebPush] Unsubscribed from push');

        // Notify server
        await fetch('/employee/notifications/webpush-unsubscribe', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ endpoint: subscription.endpoint })
        });
      }

      localStorage.setItem('webPushEnabled', 'false');
      console.log('[WebPush] Unsubscribed successfully');
      
      return { success: true };
    } catch (error) {
      console.error('[WebPush] Unsubscribe error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Show a local notification (for testing/feedback)
   */
  showLocalNotification(title, body) {
    if (Notification.permission === 'granted' && this.serviceWorkerRegistration) {
      this.serviceWorkerRegistration.showNotification(title, {
        body,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        vibrate: [200, 100, 200],
        tag: 'local-notification',
        requireInteraction: false,
        data: { url: '/employee/shifts' }
      });
    }
  }

  /**
   * Test push notification (request server to send a test)
   */
  async testPushNotification() {
    try {
      const response = await fetch('/employee/notifications/test-push', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await response.json();
      console.log('[WebPush] Test notification result:', data);
      
      return data;
    } catch (error) {
      console.error('[WebPush] Test notification error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Show opt-in banner
   */
  showOptInBanner() {
    const now = new Date();
    const currentDay = now.getDay();

    // Only show during booking window
    if (currentDay < 3 || currentDay > 6) {
      return;
    }

    // Don't show if already dismissed today
    const dismissed = localStorage.getItem('webPushBannerDismissed');
    if (dismissed === new Date().toDateString()) {
      return;
    }

    const banner = document.createElement('div');
    banner.id = 'webpush-banner';
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 1rem;
      text-align: center;
      z-index: 1000;
      box-shadow: 0 2px 10px rgba(0,0,0,0.2);
      animation: slideDown 0.3s ease-out;
    `;

    banner.innerHTML = `
      <style>
        @keyframes slideDown {
          from { transform: translateY(-100%); }
          to { transform: translateY(0); }
        }
        #webpush-banner button {
          margin: 0 0.5rem;
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
          transition: transform 0.2s;
        }
        #webpush-banner button:hover {
          transform: scale(1.05);
        }
        #webpush-banner .enable-btn {
          background: white;
          color: #667eea;
        }
        #webpush-banner .dismiss-btn {
          background: rgba(255,255,255,0.2);
          color: white;
        }
      </style>
      <div>
        <strong>🔔 Get Shift Reminders!</strong> Enable push notifications to never miss booking your shifts.
        <br>
        <button class="enable-btn" onclick="window.webPushManager.enableNotifications()">Enable Notifications</button>
        <button class="dismiss-btn" onclick="window.webPushManager.dismissBanner()">Maybe Later</button>
      </div>
    `;

    document.body.insertBefore(banner, document.body.firstChild);
  }

  /**
   * Enable notifications (called from banner button)
   */
  async enableNotifications() {
    const result = await this.subscribe();
    
    if (result.success) {
      this.dismissBanner();
    } else {
      alert('Unable to enable notifications. Please check your browser settings.');
    }
  }

  /**
   * Dismiss the opt-in banner
   */
  dismissBanner() {
    const banner = document.getElementById('webpush-banner');
    if (banner) {
      banner.style.animation = 'slideUp 0.3s ease-out';
      setTimeout(() => banner.remove(), 300);
    }
    localStorage.setItem('webPushBannerDismissed', new Date().toDateString());
  }

  /**
   * Get subscription status
   */
  async getStatus() {
    const subscription = await this.getSubscription();
    return {
      supported: this.isSupported,
      permission: Notification.permission,
      subscribed: !!subscription,
      serviceWorkerActive: !!this.serviceWorkerRegistration?.active
    };
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', async () => {
  window.webPushManager = new WebPushNotificationManager();
  
  const initialized = await window.webPushManager.initialize();
  
  if (initialized) {
    console.log('[WebPush] System initialized successfully');
    
    // Show opt-in banner if not yet subscribed
    const status = await window.webPushManager.getStatus();
    if (!status.subscribed && localStorage.getItem('webPushEnabled') !== 'false') {
      window.webPushManager.showOptInBanner();
    }
  } else {
    console.log('[WebPush] Initialization failed or not supported');
  }
});
