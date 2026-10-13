const http2 = require('http2');
const crypto = require('crypto');
const fs = require('fs');
const { pool } = require('../config/database');

/**
 * Native iOS Push Service (APNs)
 * Sends push notifications to the iOS app using Apple's token-based (.p8 key) auth.
 *
 * Env:
 *   APNS_KEY_ID     - Key ID of the .p8 key (Apple Developer > Keys)
 *   APNS_TEAM_ID    - Apple Developer Team ID
 *   APNS_BUNDLE_ID  - App bundle ID (must match capacitor.config.json appId)
 *   APNS_KEY_PATH   - Path to the .p8 file, or
 *   APNS_KEY        - Contents of the .p8 file (newlines may be written as \n)
 *   APNS_ENV        - 'production' (TestFlight / App Store, default) or 'sandbox' (Xcode debug builds)
 */

const keyId = process.env.APNS_KEY_ID;
const teamId = process.env.APNS_TEAM_ID;
const bundleId = process.env.APNS_BUNDLE_ID;
const apnsHost = process.env.APNS_ENV === 'sandbox'
  ? 'https://api.sandbox.push.apple.com'
  : 'https://api.push.apple.com';

function loadSigningKey() {
  try {
    if (process.env.APNS_KEY) return process.env.APNS_KEY.replace(/\\n/g, '\n');
    if (process.env.APNS_KEY_PATH) return fs.readFileSync(process.env.APNS_KEY_PATH, 'utf8');
  } catch (error) {
    console.error('[APNs] Failed to read signing key:', error.message);
  }
  return null;
}

const signingKey = loadSigningKey();
const isConfigured = !!(keyId && teamId && bundleId && signingKey);

if (isConfigured) {
  console.log(`[APNs] Configured for ${bundleId} (${apnsHost})`);
} else {
  console.warn('[APNs] Not configured. iOS app push notifications will not work.');
}

// Apple requires the provider token to be refreshed between 20 and 60 minutes.
let cachedToken = null;
let cachedTokenAt = 0;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function getProviderToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now - cachedTokenAt < 50 * 60) return cachedToken;

  const header = base64url(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = base64url(JSON.stringify({ iss: teamId, iat: now }));
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), {
    key: signingKey,
    dsaEncoding: 'ieee-p1363'
  });

  cachedToken = `${header}.${claims}.${signature.toString('base64url')}`;
  cachedTokenAt = now;
  return cachedToken;
}

// Reuse one HTTP/2 connection to APNs, reconnecting if it drops.
let session = null;

function getSession() {
  if (session && !session.closed && !session.destroyed) return session;
  const connection = http2.connect(apnsHost);
  connection.on('error', (error) => console.error('[APNs] Connection error:', error.message));
  connection.on('close', () => { if (session === connection) session = null; });
  // Close the connection after a minute idle; the next send reconnects.
  connection.setTimeout(60000, () => connection.close());
  session = connection;
  return session;
}

/**
 * Send one notification to one device token.
 * @returns {Promise<{ ok: boolean, status: number, reason?: string }>}
 */
function sendToDevice(deviceToken, { title, body, data }) {
  const payload = JSON.stringify({
    aps: { alert: { title, body }, sound: 'default' },
    ...(data || {})
  });

  return new Promise((resolve) => {
    let req;
    try {
      req = getSession().request({
        ':method': 'POST',
        ':path': `/3/device/${deviceToken}`,
        'authorization': `bearer ${getProviderToken()}`,
        'apns-topic': bundleId,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'content-type': 'application/json'
      });
    } catch (error) {
      resolve({ ok: false, status: 0, reason: error.message });
      return;
    }

    let status = 0;
    let responseBody = '';
    req.setEncoding('utf8');
    req.on('response', (headers) => { status = headers[':status']; });
    req.on('data', (chunk) => { responseBody += chunk; });
    req.on('end', () => {
      let reason;
      try { reason = responseBody ? JSON.parse(responseBody).reason : undefined; } catch (e) { reason = responseBody; }
      resolve({ ok: status === 200, status, reason });
    });
    req.on('error', (error) => resolve({ ok: false, status: 0, reason: error.message }));
    req.setTimeout(10000, () => {
      req.close();
      resolve({ ok: false, status: 0, reason: 'Timeout' });
    });
    req.end(payload);
  });
}

/**
 * Save (or reassign) a device token for an employee
 * @param {string} employeeId - The user UUID
 * @param {string} token - APNs device token (hex)
 * @param {string} platform
 * @returns {Promise<{ success: boolean, error?: string }>}
 */
async function saveNativeToken(employeeId, token, platform = 'ios') {
  if (!token || !/^[0-9a-fA-F]{32,200}$/.test(token)) {
    return { success: false, error: 'Invalid device token' };
  }
  try {
    await pool.query(
      `INSERT INTO native_push_tokens (employee_id, token, platform, updated_at)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (token)
       DO UPDATE SET employee_id = $1, platform = $3, updated_at = CURRENT_TIMESTAMP`,
      [employeeId, token, platform]
    );
    console.log(`[APNs] Device token saved for employee ${employeeId}`);
    return { success: true };
  } catch (error) {
    console.error('[APNs] saveNativeToken error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Remove a device token. When employeeId is given, only removes it if it belongs to them.
 */
async function removeNativeToken(token, employeeId = null) {
  try {
    if (employeeId) {
      await pool.query(`DELETE FROM native_push_tokens WHERE token = $1 AND employee_id = $2`, [token, employeeId]);
    } else {
      await pool.query(`DELETE FROM native_push_tokens WHERE token = $1`, [token]);
    }
    return { success: true };
  } catch (error) {
    console.error('[APNs] removeNativeToken error:', error);
    return { success: false };
  }
}

/**
 * Send a notification to every iOS device registered to an employee
 * @param {string} employeeId - The user UUID
 * @param {object} payload - { title, message, data }
 * @returns {Promise<{ sent: number, failed: number }>}
 */
async function sendNativePushNotification(employeeId, payload) {
  if (!isConfigured) return { sent: 0, failed: 0 };

  let tokens;
  try {
    const result = await pool.query(`SELECT token FROM native_push_tokens WHERE employee_id = $1`, [employeeId]);
    tokens = result.rows.map(row => row.token);
  } catch (error) {
    // Table may not exist yet if migration 27 hasn't been applied.
    console.error('[APNs] Failed to load device tokens:', error.message);
    return { sent: 0, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  await Promise.all(tokens.map(async (token) => {
    const result = await sendToDevice(token, {
      title: payload.title,
      body: payload.message || payload.body,
      data: payload.data
    });

    if (result.ok) {
      sent++;
      return;
    }

    failed++;
    console.error(`[APNs] Failed to send to ${token.substring(0, 12)}...: ${result.status} ${result.reason || ''}`);
    // Token no longer valid for this app/environment - stop sending to it.
    if (result.status === 410 || result.reason === 'BadDeviceToken' || result.reason === 'Unregistered') {
      await removeNativeToken(token);
    }
  }));

  return { sent, failed };
}

module.exports = {
  saveNativeToken,
  removeNativeToken,
  sendNativePushNotification
};
