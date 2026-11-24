const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getVapidPublicKey, saveWebPushSubscription, removeWebPushSubscription, sendPushNotification } = require('../services/webPushService');
const { saveNativeToken, removeNativeToken } = require('../services/apnsService');
const { HOME_BY_ROLE } = require('../services/staffNotifyService');

/**
 * Push notification sign-up for every logged-in role (crew, managers, head office).
 * The crew-only /employee/notifications/* routes stay for older cached pages.
 */
const router = express.Router();
router.use(requireAuth);

router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: getVapidPublicKey() });
});

// Browser (web push) subscription
router.post('/webpush-subscribe', async (req, res) => {
  const { subscription } = req.body || {};
  if (!subscription || typeof subscription.endpoint !== 'string') {
    return res.status(400).json({ success: false, error: 'Invalid subscription' });
  }
  const result = await saveWebPushSubscription(req.user.userId, subscription);
  if (result.success) return res.json({ success: true });
  res.status(500).json({ success: false, error: result.error || 'Failed to subscribe' });
});

router.post('/webpush-unsubscribe', async (req, res) => {
  const { endpoint } = req.body || {};
  if (endpoint) await removeWebPushSubscription(req.user.userId, endpoint);
  res.json({ success: true });
});

// iOS app device token (APNs)
router.post('/native-register', async (req, res) => {
  const { token, platform } = req.body || {};
  const result = await saveNativeToken(req.user.userId, token, platform === 'android' ? 'android' : 'ios');
  if (result.success) return res.json({ success: true });
  res.status(400).json({ success: false, error: result.error });
});

router.post('/native-unregister', async (req, res) => {
  const { token } = req.body || {};
  if (token) await removeNativeToken(token, req.user.userId);
  res.json({ success: true });
});

router.post('/test-push', async (req, res) => {
  const result = await sendPushNotification(req.user.userId, {
    title: 'Rizins Smash',
    message: 'Notifications are working on this device.',
    data: { url: HOME_BY_ROLE[req.user.userRole] || '/' }
  });
  if (result.success) return res.json({ success: true, sent: result.sent });
  res.status(500).json({ success: false, error: result.error || 'No devices registered' });
});

module.exports = router;
