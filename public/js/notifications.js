/**
 * Browser Notification Handler
 * Manages notification permissions, subscriptions, and displaying notifications
 */

class NotificationManager {
  constructor() {
    this.permission = Notification.permission;
    this.checkSupport();
  }

  /**
   * Check if browser supports notifications
   */
  checkSupport() {
    if (!('Notification' in window)) {
      console.warn('This browser does not support notifications');
      return false;
    }
    return true;
  }

  /**
   * Request notification permission from user
   * @returns {Promise<string>} Permission status: 'granted', 'denied', or 'default'
   */
  async requestPermission() {
    if (!this.checkSupport()) {
      return 'denied';
    }

    try {
      const permission = await Notification.requestPermission();
      this.permission = permission;
      
      if (permission === 'granted') {
        console.log('Notification permission granted');
        // Send subscription to server
        await this.subscribeToNotifications();
      } else if (permission === 'denied') {
        console.log('Notification permission denied');
      }
      
      return permission;
    } catch (error) {
      console.error('Error requesting notification permission:', error);
      return 'denied';
    }
  }

  /**
   * Subscribe to notifications (save to server)
   */
  async subscribeToNotifications() {
    try {
      // For now, we'll use a simple subscription marker
      // In production, you'd use Web Push API with service workers
      const response = await fetch('/employee/notifications/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          subscription: {
            endpoint: 'browser-notification',
            enabled: true,
            timestamp: new Date().toISOString()
          }
        })
      });

      if (response.ok) {
        console.log('Successfully subscribed to notifications');
        localStorage.setItem('notificationsEnabled', 'true');
      }
    } catch (error) {
      console.error('Error subscribing to notifications:', error);
    }
  }

  /**
   * Unsubscribe from notifications
   */
  async unsubscribeFromNotifications() {
    try {
      const response = await fetch('/employee/notifications/unsubscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        console.log('Successfully unsubscribed from notifications');
        localStorage.setItem('notificationsEnabled', 'false');
      }
    } catch (error) {
      console.error('Error unsubscribing from notifications:', error);
    }
  }

  /**
   * Show a notification
   * @param {string} title - Notification title
   * @param {object} options - Notification options
   */
  showNotification(title, options = {}) {
    if (this.permission !== 'granted') {
      console.warn('Cannot show notification - permission not granted');
      return null;
    }

    const defaultOptions = {
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      vibrate: [200, 100, 200],
      requireInteraction: false,
      ...options
    };

    const notification = new Notification(title, defaultOptions);

    // Auto-close after 10 seconds
    setTimeout(() => {
      notification.close();
    }, 10000);

    // Handle click - navigate to shifts page
    notification.onclick = function(event) {
      event.preventDefault();
      window.focus();
      window.location.href = '/employee/shifts';
      notification.close();
    };

    return notification;
  }

  /**
   * Check if it's booking time (Wed-Sat) and show reminder if needed
   */
  async checkAndNotify() {
    try {
      console.log('[Notifications] Checking if reminder needed...');
      const response = await fetch('/employee/notifications/check');
      const data = await response.json();
      
      console.log('[Notifications] Server response:', data);
      console.log('[Notifications] Permission status:', this.permission);

      if (data.needsReminder && this.permission === 'granted') {
        console.log('[Notifications] Showing notification:', data.title);
        this.showNotification(data.title || 'Shift Reminder', {
          body: data.message,
          tag: 'shift-booking-reminder',
          renotify: false
        });
      } else if (data.needsReminder && this.permission !== 'granted') {
        console.log('[Notifications] Reminder needed but permission not granted');
      } else {
        console.log('[Notifications] No reminder needed:', data.message);
      }

      return data;
    } catch (error) {
      console.error('[Notifications] Error checking notification:', error);
      return null;
    }
  }

  /**
   * Schedule periodic checks (every hour during booking window)
   */
  startPeriodicChecks() {
    const now = new Date();
    const currentDay = now.getDay();

    // Only run during Wed-Sat (3-6)
    if (currentDay >= 3 && currentDay <= 6) {
      // Check immediately
      this.checkAndNotify();

      // Then check every hour
      const intervalId = setInterval(() => {
        const day = new Date().getDay();
        if (day >= 3 && day <= 6) {
          this.checkAndNotify();
        } else {
          // Stop checking if outside window
          clearInterval(intervalId);
        }
      }, 60 * 60 * 1000); // Every hour

      return intervalId;
    }

    return null;
  }

  /**
   * Initialize notification system
   */
  async initialize() {
    const enabled = localStorage.getItem('notificationsEnabled');
    
    if (enabled === 'true' && this.permission === 'granted') {
      this.startPeriodicChecks();
    } else if (enabled === null) {
      // First time - show opt-in UI
      this.showOptInBanner();
    }
  }

  /**
   * Show a banner asking user to enable notifications
   */
  showOptInBanner() {
    const now = new Date();
    const currentDay = now.getDay();

    // Only show during booking window
    if (currentDay < 3 || currentDay > 6) {
      return;
    }

    const banner = document.createElement('div');
    banner.id = 'notification-banner';
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
        #notification-banner button {
          margin: 0 0.5rem;
          padding: 0.5rem 1rem;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
          transition: transform 0.2s;
        }
        #notification-banner button:hover {
          transform: scale(1.05);
        }
        #notification-banner .enable-btn {
          background: white;
          color: #667eea;
        }
        #notification-banner .dismiss-btn {
          background: rgba(255,255,255,0.2);
          color: white;
        }
      </style>
      <div>
        <strong>🔔 Stay Updated!</strong> Enable notifications to get reminders about booking your shifts.
        <br>
        <button class="enable-btn" onclick="window.notificationManager.enableNotifications()">Enable Notifications</button>
        <button class="dismiss-btn" onclick="window.notificationManager.dismissBanner()">Maybe Later</button>
      </div>
    `;

    document.body.insertBefore(banner, document.body.firstChild);
  }

  /**
   * Enable notifications (called from banner button)
   */
  async enableNotifications() {
    const permission = await this.requestPermission();
    
    if (permission === 'granted') {
      this.dismissBanner();
      this.startPeriodicChecks();
      this.showNotification('Notifications Enabled! 🎉', {
        body: 'You\'ll now receive reminders to book your shifts during Wednesday-Saturday.',
        requireInteraction: false
      });
    } else {
      alert('Please allow notifications in your browser settings to receive shift reminders.');
    }
  }

  /**
   * Dismiss the opt-in banner
   */
  dismissBanner() {
    const banner = document.getElementById('notification-banner');
    if (banner) {
      banner.style.animation = 'slideUp 0.3s ease-out';
      setTimeout(() => banner.remove(), 300);
    }
    // Remember user dismissed (check again tomorrow)
    localStorage.setItem('notificationBannerDismissed', new Date().toDateString());
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  window.notificationManager = new NotificationManager();
  window.notificationManager.initialize();
});
