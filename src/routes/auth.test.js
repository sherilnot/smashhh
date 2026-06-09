/**
 * Unit tests for authentication routes (task 3.2).
 * Mocks the Authentication Service so no live DB connection is required and
 * invokes the real route handlers extracted from the Express router stack.
 *
 * Requirements: 1.1, 1.2, 2.4, 2.5, 2.6, 2.7, 17.1, 17.2, 17.3
 */

const mockAuthenticate = jest.fn();
const mockVerifySession = jest.fn();
const mockLogout = jest.fn();

jest.mock('../services/authService', () => ({
  authenticate: (...args) => mockAuthenticate(...args),
  verifySession: (...args) => mockVerifySession(...args),
  logout: (...args) => mockLogout(...args)
}));

const { SESSION_COOKIE_NAME } = require('../middleware/auth');
const router = require('./auth');

/**
 * Find the (last) route handler registered for a given HTTP method and path
 * within an Express router's stack.
 */
function getHandler(method, path) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method]
  );
  if (!layer) {
    throw new Error(`No handler found for ${method.toUpperCase()} ${path}`);
  }
  const handlers = layer.route.stack;
  return handlers[handlers.length - 1].handle;
}

/** Build a mock Express response with chainable methods and spies. */
function makeRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.render = jest.fn(() => res);
  res.redirect = jest.fn(() => res);
  res.cookie = jest.fn(() => res);
  res.clearCookie = jest.fn(() => res);
  return res;
}

describe('GET /login', () => {
  const handler = getHandler('get', '/login');

  beforeEach(() => {
    mockVerifySession.mockReset();
  });

  test('renders the login view when no session cookie is present', async () => {
    const req = { cookies: {} };
    const res = makeRes();

    await handler(req, res);

    expect(res.render).toHaveBeenCalledWith('auth/login', { error: null, userId: '' });
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('redirects an already-authenticated employee to their dashboard', async () => {
    mockVerifySession.mockResolvedValueOnce({ userId: 'u1', userRole: 'employee' });
    const req = { cookies: { [SESSION_COOKIE_NAME]: 'tok' } };
    const res = makeRes();

    await handler(req, res);

    expect(res.redirect).toHaveBeenCalledWith('/employee/dashboard');
    expect(res.render).not.toHaveBeenCalled();
  });

  test('renders login when the existing session is invalid', async () => {
    mockVerifySession.mockResolvedValueOnce(null);
    const req = { cookies: { [SESSION_COOKIE_NAME]: 'tok' } };
    const res = makeRes();

    await handler(req, res);

    expect(res.render).toHaveBeenCalledWith('auth/login', { error: null, userId: '' });
  });
});

describe('POST /login', () => {
  const handler = getHandler('post', '/login');

  beforeEach(() => {
    mockAuthenticate.mockReset();
  });

  test.each([
    ['employee', '/employee/dashboard'],
    ['store_manager', '/manager/dashboard'],
    ['warehouse_manager', '/warehouse/dashboard']
  ])('on success for %s sets a secure cookie and redirects to %s', async (role, dest) => {
    mockAuthenticate.mockResolvedValueOnce({
      success: true,
      sessionToken: 'session-token-123',
      userRole: role,
      userId: 'uuid'
    });
    const req = { body: { user_id: 'alice', password: 'password123' } };
    const res = makeRes();

    await handler(req, res);

    expect(mockAuthenticate).toHaveBeenCalledWith('alice', 'password123');
    expect(res.cookie).toHaveBeenCalledTimes(1);
    const [cookieName, cookieValue, options] = res.cookie.mock.calls[0];
    expect(cookieName).toBe(SESSION_COOKIE_NAME);
    expect(cookieValue).toBe('session-token-123');
    // Req 2.5/17.1, 2.7/17.3, and 8-hour lifetime.
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('strict');
    expect(options.maxAge).toBe(8 * 60 * 60 * 1000);
    expect(res.redirect).toHaveBeenCalledWith(dest);
  });

  test('on failure re-renders login with an error and does not set a cookie (Req 1.2)', async () => {
    mockAuthenticate.mockResolvedValueOnce({ success: false, error: 'Invalid credentials' });
    const req = { body: { user_id: 'alice', password: 'wrong' } };
    const res = makeRes();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.render).toHaveBeenCalledWith('auth/login', {
      error: 'Invalid credentials',
      userId: 'alice'
    });
    expect(res.cookie).not.toHaveBeenCalled();
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('secure flag is enabled in production (Req 2.6/17.2)', async () => {
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    // Re-require the router with production env so cookie options recompute.
    jest.resetModules();
    jest.doMock('../services/authService', () => ({
      authenticate: (...args) => mockAuthenticate(...args),
      verifySession: (...args) => mockVerifySession(...args),
      logout: (...args) => mockLogout(...args)
    }));
    const prodRouter = require('./auth');
    const prodLayer = prodRouter.stack.find(
      (l) => l.route && l.route.path === '/login' && l.route.methods.post
    );
    const prodHandler = prodLayer.route.stack[prodLayer.route.stack.length - 1].handle;

    mockAuthenticate.mockResolvedValueOnce({
      success: true,
      sessionToken: 'tok',
      userRole: 'employee',
      userId: 'uuid'
    });
    const req = { body: { user_id: 'alice', password: 'password123' } };
    const res = makeRes();

    await prodHandler(req, res);

    const options = res.cookie.mock.calls[0][2];
    expect(options.secure).toBe(true);

    process.env.NODE_ENV = prevEnv;
    jest.resetModules();
  });
});

describe('POST /logout', () => {
  const handler = getHandler('post', '/logout');

  beforeEach(() => {
    mockLogout.mockReset();
  });

  test('invalidates the session, clears the cookie, and redirects (Req 2.4)', async () => {
    mockLogout.mockResolvedValueOnce(undefined);
    const req = { cookies: { [SESSION_COOKIE_NAME]: 'tok' } };
    const res = makeRes();

    await handler(req, res);

    expect(mockLogout).toHaveBeenCalledWith('tok');
    expect(res.clearCookie).toHaveBeenCalledWith(SESSION_COOKIE_NAME, expect.objectContaining({
      httpOnly: true,
      sameSite: 'strict'
    }));
    expect(res.redirect).toHaveBeenCalledWith('/login');
  });

  test('clears cookie and redirects even when no session cookie exists', async () => {
    const req = { cookies: {} };
    const res = makeRes();

    await handler(req, res);

    expect(mockLogout).not.toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/login');
  });

  test('still clears cookie and redirects when logout throws', async () => {
    mockLogout.mockRejectedValueOnce(new Error('db error'));
    const req = { cookies: { [SESSION_COOKIE_NAME]: 'tok' } };
    const res = makeRes();
    const errSpy = jest.spyOn(console, 'error').mockImplementation();

    await handler(req, res);

    expect(res.clearCookie).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/login');
    errSpy.mockRestore();
  });
});
