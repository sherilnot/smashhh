const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

/**
 * Firebase Cloud Messaging (HTTP v1) for the Android app.
 * Authenticates with a Firebase service account (Project settings > Service
 * accounts > Generate new private key).
 *
 * Env:
 *   FCM_SERVICE_ACCOUNT_PATH - path to the service account .json, or
 *   FCM_SERVICE_ACCOUNT      - its contents
 */

function loadServiceAccount() {
  try {
    if (process.env.FCM_SERVICE_ACCOUNT) return JSON.parse(process.env.FCM_SERVICE_ACCOUNT);
    if (process.env.FCM_SERVICE_ACCOUNT_PATH) return JSON.parse(fs.readFileSync(process.env.FCM_SERVICE_ACCOUNT_PATH, 'utf8'));
  } catch (error) {
    console.error('[FCM] Failed to read service account:', error.message);
  }
  return null;
}

const account = loadServiceAccount();
const isConfigured = !!(account && account.project_id && account.client_email && account.private_key);

if (isConfigured) {
  console.log(`[FCM] Configured for project ${account.project_id}`);
} else {
  console.warn('[FCM] Not configured. Android app push notifications will not work.');
}

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let json = null;
        try { json = data ? JSON.parse(data) : null; } catch (e) { /* not JSON */ }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('FCM request timed out')));
    if (body) req.write(body);
    req.end();
  });
}

// Google OAuth access token, reused until shortly before it expires (1 hour)
let cachedToken = null;
let cachedUntil = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedUntil) return cachedToken;

  const now = Math.floor(Date.now() / 1000);
  const encode = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(account.private_key, 'base64url');

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: `${unsigned}.${signature}`
  }).toString();
  const res = await request({
    method: 'POST',
    hostname: 'oauth2.googleapis.com',
    path: '/token',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }
  }, body);
  if (res.status !== 200 || !res.json || !res.json.access_token) {
    throw new Error(`OAuth token request failed (${res.status})`);
  }
  cachedToken = res.json.access_token;
  cachedUntil = Date.now() + (res.json.expires_in - 120) * 1000;
  return cachedToken;
}

/**
 * Send one notification to an Android device.
 * @returns {Promise<{ ok: boolean, status?: number, reason?: string }>}
 *   reason 'UNREGISTERED' / 'INVALID_ARGUMENT' means the token should be dropped.
 */
async function sendToAndroidDevice(token, { title, body, data }) {
  if (!isConfigured) return { ok: false, reason: 'NotConfigured' };
  try {
    const accessToken = await getAccessToken();
    // FCM data values must be strings
    const stringData = Object.fromEntries(Object.entries(data || {}).map(([k, v]) => [k, String(v)]));
    const payload = JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data: stringData,
        android: { priority: 'high', notification: { sound: 'default' } }
      }
    });
    const res = await request({
      method: 'POST',
      hostname: 'fcm.googleapis.com',
      path: `/v1/projects/${account.project_id}/messages:send`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, payload);
    if (res.status === 200) return { ok: true };
    const details = res.json && res.json.error && res.json.error.details;
    const fcmCode = Array.isArray(details) && details.map(d => d.errorCode).find(Boolean);
    return { ok: false, status: res.status, reason: fcmCode || (res.json && res.json.error && res.json.error.status) };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

module.exports = { sendToAndroidDevice, isConfigured };
