const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { pool } = require('../config/database');

/**
 * Authentication Service
 *
 * Provides password hashing/verification and (in later subtasks) session-based
 * authentication for the Employee Management System.
 *
 * Requirements: 1.4 (hash passwords with bcrypt before storage),
 *               1.5 (use bcrypt comparison during authentication)
 */

// bcrypt cost factor (work factor). Higher = more secure but slower.
const BCRYPT_COST_FACTOR = 12;

// Number of random bytes used for session tokens. 32 bytes (256 bits) provides
// cryptographically strong, effectively unique tokens.
const SESSION_TOKEN_BYTES = 32;

/**
 * @typedef {Object} AuthResult
 * @property {boolean} success - Whether authentication was successful
 * @property {string} [sessionToken] - Session token if successful
 * @property {string} [userRole] - User's role (employee, store_manager, warehouse_manager)
 * @property {string} [userId] - User's ID if successful
 * @property {string} [error] - Error message if failed
 */

/**
 * @typedef {Object} SessionData
 * @property {string} userId - User's ID
 * @property {string} userRole - User's role
 * @property {Date} createdAt - When session was created
 * @property {Date} expiresAt - When session expires
 */

/**
 * Hash a plaintext password using bcrypt with a cost factor of 12.
 *
 * Requirement 1.4: passwords must be hashed with bcrypt before storage.
 *
 * @param {string} password - Plain text password to hash
 * @returns {Promise<string>} The bcrypt hash (60 characters)
 */
async function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('[Auth] hashPassword requires a non-empty password string');
  }

  return bcrypt.hash(password, BCRYPT_COST_FACTOR);
}

/**
 * Verify a plaintext password against a stored bcrypt hash.
 *
 * Requirement 1.5: use bcrypt comparison during authentication.
 *
 * @param {string} password - Plain text password to verify
 * @param {string} hash - Stored bcrypt hash to compare against
 * @returns {Promise<boolean>} True if the password matches the hash
 */
async function verifyPassword(password, hash) {
  if (typeof password !== 'string' || typeof hash !== 'string' || hash.length === 0) {
    return false;
  }

  return bcrypt.compare(password, hash);
}

/**
 * Generate a cryptographically secure, effectively unique session token.
 *
 * Uses Node's crypto.randomBytes to produce 32 random bytes (256 bits) of
 * entropy, encoded as a hexadecimal string (64 characters). This satisfies the
 * requirement for cryptographically secure session tokens built from a minimum
 * of 32 random bytes.
 *
 * Requirement 1.6: cryptographically secure session tokens using a minimum of
 * 32 random bytes.
 *
 * @returns {string} A 64-character hex string representing 32 random bytes
 */
function generateSecureToken() {
  return crypto.randomBytes(SESSION_TOKEN_BYTES).toString('hex');
}

// Session lifetime in milliseconds (8 hours).
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

/**
 * Authenticate a user by user_id and password, creating a session on success.
 *
 * Follows the "Main Authentication Algorithm" from the design document:
 *   1. Validate input (reject empty userId).
 *   2. Look up the user by user_id using a parameterized query.
 *   3. Reject deactivated accounts.
 *   4. Verify the password with bcrypt (via verifyPassword).
 *   5. On success, generate a secure session token, compute an 8-hour
 *      expiry, and persist the session.
 *   6. Return an AuthResult describing the outcome.
 *
 * Security notes:
 *   - Plaintext passwords and password hashes are NEVER logged or returned.
 *   - Failed authentication attempts are logged with the userId and timestamp
 *     only (Req 16.3, 16.6).
 *   - Authentication failures return a generic 'Invalid credentials' message
 *     so callers cannot distinguish between unknown users and wrong passwords
 *     (Req 1.2).
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 16.3, 16.6, 19.1
 *
 * @param {string} userId - User's login identifier (users.user_id)
 * @param {string} password - User's plaintext password
 * @returns {Promise<AuthResult>}
 */
async function authenticate(userId, password) {
  // Step 1: Input validation. Keep this minimal so valid logins are never
  // rejected by overly strict format rules — auth failures use the generic
  // 'Invalid credentials' message instead.
  if (typeof userId !== 'string' || userId.trim() === '') {
    return { success: false, error: 'User ID is required' };
  }

  if (typeof password !== 'string' || password.length === 0) {
    return { success: false, error: 'Password is required' };
  }

  try {
    // Step 2: Query the user from the database using a parameterized query
    // to prevent SQL injection (Req 17.5).
    const result = await pool.query(
      'SELECT id, user_id, password_hash, role, is_active FROM users WHERE user_id = $1',
      [userId]
    );

    if (!result || result.rows.length === 0) {
      // Unknown user. Log the failed attempt without exposing credentials.
      console.warn(
        `[Auth] Failed authentication attempt for user_id="${userId}" at ${new Date().toISOString()} (reason: user not found)`
      );
      return { success: false, error: 'Invalid credentials' };
    }

    const userData = result.rows[0];

    // Step 3: Reject deactivated accounts (Req 1.3).
    if (!userData.is_active) {
      console.warn(
        `[Auth] Failed authentication attempt for user_id="${userId}" at ${new Date().toISOString()} (reason: account deactivated)`
      );
      return { success: false, error: 'Account is deactivated' };
    }

    // Step 4: Verify the password using bcrypt (Req 1.5).
    const isPasswordValid = await verifyPassword(password, userData.password_hash);

    if (!isPasswordValid) {
      console.warn(
        `[Auth] Failed authentication attempt for user_id="${userId}" at ${new Date().toISOString()} (reason: invalid password)`
      );
      return { success: false, error: 'Invalid credentials' };
    }

    // Step 5: Generate a cryptographically secure session token (Req 1.6) and
    // compute an 8-hour expiration (Req 1.7).
    const sessionToken = generateSecureToken();
    const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

    // Step 6: Persist the session using a parameterized query.
    await pool.query(
      'INSERT INTO sessions (user_id, session_token, expires_at) VALUES ($1, $2, $3)',
      [userData.id, sessionToken, expiresAt]
    );

    // Step 7: Return success. Never include password material in the result.
    return {
      success: true,
      sessionToken,
      userRole: userData.role,
      userId: userData.id
    };
  } catch (error) {
    // Step 8: Log database/internal errors with a stack trace (Req 16.1) and
    // return a generic failure without leaking internal details.
    console.error('[Auth] Authentication error', {
      userId,
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    return { success: false, error: 'Authentication failed. Please try again.' };
  }
}

/**
 * Authentication Service object.
 *
 * Subsequent subtasks will extend this object with:
 *   - verifySession()       (2.4)
 *   - logout()              (2.5)
 */
const AuthenticationService = {
  hashPassword,
  verifyPassword,
  generateSecureToken,
  authenticate
};

module.exports = AuthenticationService;
