const express = require('express');
const AuthenticationService = require('../services/authService');
const { SESSION_COOKIE_NAME, LOGIN_PATH } = require('../middleware/auth');

/**
 * Authentication Routes
 *
 * Provides the login page, login submission, and logout endpoints for the
 * Employee Management System. On successful login a secure session cookie is
 * set and the user is routed to their role-specific dashboard.
 *
 * Requirements:
 *   - 1.1: valid credentials create a session and route to the role dashboard.
 *   - 1.2: invalid credentials are rejected with an error message.
 *   - 2.4: logging out invalidates the session.
 *   - 2.5: session tokens are stored in HTTP-only cookies.
 *   - 2.6: session cookies are transmitted only over HTTPS (Secure flag).
 *   - 2.7: session cookies use SameSite=Strict.
 *   - 17.1, 17.2, 17.3: HttpOnly, Secure, and SameSite=Strict cookie flags.
 */

const router = express.Router();

// Session lifetime in milliseconds (8 hours), matching the Authentication
// Service session expiration (Req 1.7).
const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

/**
 * Cookie options applied to the session cookie.
 *
 * - httpOnly: prevents JavaScript access to the cookie (Req 2.5, 17.1).
 * - secure: only sent over HTTPS. Enabled in production; disabled otherwise so
 *   local development over HTTP still works (Req 2.6, 17.2).
 * - sameSite: 'strict' to mitigate CSRF (Req 2.7, 17.3).
 * - maxAge: 8 hours, matching the session lifetime (Req 1.7).
 */
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge: SESSION_MAX_AGE_MS
};

/**
 * Map a user role to its dashboard path.
 *
 * Req 1.1: route the user to their role-specific dashboard after login.
 *
 * @param {string} role - User role
 * @returns {string} Dashboard path for the role (defaults to login on unknown)
 */
function dashboardPathForRole(role) {
  switch (role) {
    case 'employee':
      return '/employee/dashboard';
    case 'store_manager':
      return '/manager/dashboard';
    case 'warehouse_manager':
      return '/warehouse/dashboard';
    default:
      return LOGIN_PATH;
  }
}

/**
 * GET /login
 *
 * Render the login page. If the request already carries a valid session, the
 * user is redirected to their role-specific dashboard instead of seeing the
 * login form again.
 */
router.get('/login', async (req, res) => {
  const sessionToken = req.cookies && req.cookies[SESSION_COOKIE_NAME];

  if (sessionToken) {
    try {
      const session = await AuthenticationService.verifySession(sessionToken);
      if (session) {
        return res.redirect(dashboardPathForRole(session.userRole));
      }
    } catch (error) {
      // If verification fails, fall through and render the login page.
      console.error('[Auth] GET /login session check error', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }

  return res.render('auth/login', { error: null, userId: '' });
});

/**
 * POST /login
 *
 * Authenticate the submitted credentials. On success, set the secure session
 * cookie (Req 2.5, 2.6, 2.7, 17.1, 17.2, 17.3) and redirect to the role
 * dashboard (Req 1.1). On failure, re-render the login page with an error
 * message (Req 1.2).
 */
router.post('/login', async (req, res) => {
  const { user_id: userId, password } = req.body || {};

  try {
    const result = await AuthenticationService.authenticate(userId, password);

    if (!result.success) {
      // Req 1.2: reject and re-render with an error. Use a generic message so
      // we don't reveal whether the user id or the password was wrong.
      return res.status(401).render('auth/login', {
        error: result.error || 'Invalid credentials',
        userId: typeof userId === 'string' ? userId : ''
      });
    }

    // Req 2.5/2.6/2.7/17.1/17.2/17.3: set the session token in a secure cookie.
    res.cookie(SESSION_COOKIE_NAME, result.sessionToken, SESSION_COOKIE_OPTIONS);

    // Req 1.1: route to the role-specific dashboard.
    return res.redirect(dashboardPathForRole(result.userRole));
  } catch (error) {
    console.error('[Auth] POST /login error', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    return res.status(500).render('auth/login', {
      error: 'An unexpected error occurred. Please try again.',
      userId: typeof userId === 'string' ? userId : ''
    });
  }
});

/**
 * POST /logout
 *
 * Invalidate the current session (Req 2.4), clear the session cookie, and
 * redirect to the login page.
 */
router.post('/logout', async (req, res) => {
  const sessionToken = req.cookies && req.cookies[SESSION_COOKIE_NAME];

  try {
    if (sessionToken) {
      // Req 2.4: mark the session inactive server-side.
      await AuthenticationService.logout(sessionToken);
    }
  } catch (error) {
    // Even if server-side invalidation fails, still clear the cookie and
    // redirect so the user is logged out client-side.
    console.error('[Auth] POST /logout error', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
  }

  // Clear the cookie using matching attributes so the browser removes it.
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  });

  return res.redirect(LOGIN_PATH);
});

module.exports = router;
