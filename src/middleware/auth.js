const AuthenticationService = require('../services/authService');

/**
 * Authentication & Authorization Middleware
 *
 * Provides Express middleware for session-based authentication (requireAuth)
 * and role-based access control (roleGuard) for the Employee Management System.
 *
 * Requirements:
 *   - 3.1, 3.3, 3.5: grant access when a user's role matches the route's role.
 *   - 3.2, 3.4, 3.6: deny access with 403 Forbidden when an authenticated
 *     user's role does not match the route's required role.
 *   - 3.7: redirect unauthenticated users to the login page.
 */

/**
 * Name of the cookie used to store the session token.
 *
 * Defined here as the single source of truth and re-used by the auth routes so
 * the cookie name stays consistent across the application (middleware reads it,
 * the login route sets it, and the logout route clears it).
 */
const SESSION_COOKIE_NAME = 'session_token';

/**
 * Path of the login page that unauthenticated users are redirected to.
 */
const LOGIN_PATH = '/login';

/**
 * Express middleware that requires a valid, active, non-expired session.
 *
 * Reads the session token from the session cookie, verifies it via
 * AuthenticationService.verifySession, and on success attaches the
 * authenticated user's info to req.user as { userId, userRole } before calling
 * next(). When the token is missing or the session is invalid/expired, the
 * request is redirected to the login page (Req 3.7).
 *
 * @param {import('express').Request} req - Express request (expects req.cookies)
 * @param {import('express').Response} res - Express response
 * @param {import('express').NextFunction} next - Next middleware callback
 * @returns {Promise<void>}
 */
async function requireAuth(req, res, next) {
  // cookie-parser is expected to be wired in app.js, so req.cookies is
  // available. Guard against it being undefined to fail closed.
  const sessionToken = req.cookies && req.cookies[SESSION_COOKIE_NAME];

  // Req 3.7: no token means the user is not authenticated -> redirect to login.
  if (!sessionToken) {
    return res.redirect(LOGIN_PATH);
  }

  try {
    const session = await AuthenticationService.verifySession(sessionToken);

    // Req 3.7: an invalid, inactive, or expired session is treated as
    // unauthenticated -> redirect to login.
    if (!session) {
      return res.redirect(LOGIN_PATH);
    }

    // Attach the authenticated user's info for downstream handlers/guards.
    req.user = {
      userId: session.userId,
      userRole: session.userRole
    };

    return next();
  } catch (error) {
    // Fail closed on unexpected errors: log and treat the request as
    // unauthenticated rather than leaking access (Req 16.1).
    console.error('[Auth] requireAuth error', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    return res.redirect(LOGIN_PATH);
  }
}

/**
 * Middleware factory that restricts a route to a single user role.
 *
 * Returns an Express middleware that checks req.user.userRole (populated by
 * requireAuth) against the required role:
 *   - If the request is not authenticated (no req.user), redirect to login
 *     (Req 3.7) so role guards remain safe even if used without requireAuth.
 *   - If authenticated but the role does not match, respond with 403 Forbidden
 *     (Req 3.2, 3.4, 3.6).
 *   - If the role matches, call next() to grant access (Req 3.1, 3.3, 3.5).
 *
 * @param {string} role - Required role ('employee', 'store_manager', or
 *   'warehouse_manager')
 * @returns {import('express').RequestHandler}
 */
function roleGuard(role) {
  return function roleGuardMiddleware(req, res, next) {
    // Not authenticated -> redirect to login (Req 3.7).
    if (!req.user || !req.user.userRole) {
      return res.redirect(LOGIN_PATH);
    }

    // Authenticated but wrong role -> 403 Forbidden (Req 3.2, 3.4, 3.6).
    if (req.user.userRole !== role) {
      return res.status(403).send('403 Forbidden: You do not have access to this resource.');
    }

    // Role matches -> grant access (Req 3.1, 3.3, 3.5).
    return next();
  };
}

module.exports = {
  requireAuth,
  roleGuard,
  SESSION_COOKIE_NAME,
  LOGIN_PATH
};
