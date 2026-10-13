/**
 * Native Push Notification Manager (iOS app only)
 * Inside the Capacitor iOS app, Web Push isn't available, so this registers an
 * APNs device token instead. It exposes the same interface as
 * WebPushNotificationManager so pages can use window.webPushManager unchanged.
 */

(function () {
  var Capacitor = window.Capacitor;
  if (!Capacitor || !Capacitor.isNativePlatform || !Capacitor.isNativePlatform()) return;

  var PushNotifications = Capacitor.Plugins && Capacitor.Plugins.PushNotifications;
  if (!PushNotifications) {
    console.warn('[NativePush] PushNotifications plugin not available');
    return;
  }

  var TOKEN_KEY = 'nativePushToken';
  var ENABLED_KEY = 'nativePushEnabled';
  var COOKIE_NAME = 'native_push_token';

  function storage(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* storage unavailable */ }
    return null;
  }

  function setTokenCookie(token) {
    // Lets the server drop this device's token on logout.
    var maxAge = token ? 60 * 60 * 24 * 365 : 0;
    document.cookie = COOKIE_NAME + '=' + encodeURIComponent(token || '') + '; path=/; max-age=' + maxAge + '; secure; samesite=strict';
  }

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body)
    });
  }

  // Resolves with the APNs token after PushNotifications.register()
  var pendingRegistration = null;

  PushNotifications.addListener('registration', function (token) {
    var value = token.value;
    postJson('/employee/notifications/native-register', { token: value, platform: Capacitor.getPlatform() })
      .then(function (res) {
        if (!res.ok) throw new Error('Server rejected device token');
        storage(TOKEN_KEY, value);
        storage(ENABLED_KEY, 'true');
        setTokenCookie(value);
        if (pendingRegistration) pendingRegistration.resolve({ success: true });
      })
      .catch(function (error) {
        console.error('[NativePush] Failed to save token:', error);
        if (pendingRegistration) pendingRegistration.resolve({ success: false, error: error.message });
      })
      .finally(function () { pendingRegistration = null; });
  });

  PushNotifications.addListener('registrationError', function (error) {
    console.error('[NativePush] Registration error:', error);
    if (pendingRegistration) pendingRegistration.resolve({ success: false, error: error.error || 'Registration failed' });
    pendingRegistration = null;
  });

  // Tapping a notification opens the page it points at (same-origin paths only).
  PushNotifications.addListener('pushNotificationActionPerformed', function (action) {
    var data = (action.notification && action.notification.data) || {};
    if (typeof data.url === 'string' && data.url.charAt(0) === '/' && data.url.charAt(1) !== '/') {
      window.location.href = data.url;
    }
  });

  function register() {
    return new Promise(function (resolve) {
      pendingRegistration = { resolve: resolve };
      PushNotifications.register().catch(function (error) {
        pendingRegistration = null;
        resolve({ success: false, error: error.message });
      });
    });
  }

  var manager = {
    isSupported: true,

    getStatus: async function () {
      var perm = await PushNotifications.checkPermissions();
      var permission = perm.receive === 'granted' ? 'granted' : perm.receive === 'denied' ? 'denied' : 'default';
      return {
        supported: true,
        permission: permission,
        subscribed: permission === 'granted' && storage(ENABLED_KEY) === 'true' && !!storage(TOKEN_KEY),
        serviceWorkerActive: false
      };
    },

    subscribe: async function () {
      var perm = await PushNotifications.checkPermissions();
      if (perm.receive !== 'granted') {
        perm = await PushNotifications.requestPermissions();
      }
      if (perm.receive !== 'granted') {
        return { success: false, error: 'Permission denied' };
      }
      return register();
    },

    unsubscribe: async function () {
      var token = storage(TOKEN_KEY);
      if (token) {
        try { await postJson('/employee/notifications/native-unregister', { token: token }); } catch (e) { /* offline */ }
      }
      storage(ENABLED_KEY, 'false');
      storage(TOKEN_KEY, null);
      setTokenCookie(null);
      return { success: true };
    },

    enableNotifications: async function () {
      var result = await manager.subscribe();
      if (!result.success) alert('Unable to enable notifications. Check Settings > Notifications for this app.');
    },

    dismissBanner: function () {},

    testPushNotification: async function () {
      var res = await postJson('/employee/notifications/test-push', {});
      return res.json();
    }
  };

  window.nativePushManager = manager;

  // Once per app launch: re-register so the server always has the current token
  // (APNs tokens can change, and the logged-in employee may have changed).
  // On first use, ask for permission straight away like a normal app.
  document.addEventListener('DOMContentLoaded', async function () {
    try {
      if (sessionStorage.getItem('nativePushChecked')) return;
      sessionStorage.setItem('nativePushChecked', '1');
    } catch (e) { /* storage unavailable */ }

    var status = await manager.getStatus();
    var enabled = storage(ENABLED_KEY);
    if (status.permission === 'granted' && enabled !== 'false') {
      register();
    } else if (status.permission === 'default' && enabled === null) {
      manager.subscribe();
    }
  });
})();
