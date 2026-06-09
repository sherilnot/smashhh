/**
 * Unit tests for authentication & authorization middleware (task 3.1).
 * Mocks the Authentication Service so no live DB connection is required.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
 */

const mockVerifySession = jest.fn();

jest.mock('../services/authService', () => ({
  verifySession: (...args) => mockVerifySession(...args)
}));

const { requireAuth, roleGuard, SESSION_COOKIE_NAME } = require('./auth');

/** Build a mock Express response with chainable status() and spies. */
function makeRes() {
  const res = {};
  res.redirect = jest.fn();
  res.send = jest.fn();
  res.status = jest.fn(() => res);
  return res;
}

describe('requireAuth', () => {
  beforeEach(() => {
    mockVerifySession.mockReset();
  });

  test('redirects to /login when no session cookie is present (Req 3.7)', async () => {
    const req = { cookies: {} };
    const res = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith('/login');
    expect(next).not.toHaveBeenCalled();
    expect(mockVerifySession).not.toHaveBeenCalled();
  });

  test('redirects to /login when cookies are undefined (Req 3.7)', async () => {
    const req = {};
    const res = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith('/login');
    expect(next).not.toHaveBeenCalled();
  });

  test('redirects to /login when session is invalid/expired (Req 3.7)', async () => {
    mockVerifySession.mockResolvedValueOnce(null);
    const req = { cookies: { [SESSION_COOKIE_NAME]: 'bad-token' } };
    const res = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(mockVerifySession).toHaveBeenCalledWith('bad-token');
    expect(res.redirect).toHaveBeenCalledWith('/login');
    expect(next).not.toHaveBeenCalled();
  });

  test('attaches req.user and calls next() for a valid session', async () => {
    mockVerifySession.mockResolvedValueOnce({
      userId: 'user-uuid-1',
      userRole: 'employee'
    });
    const req = { cookies: { [SESSION_COOKIE_NAME]: 'good-token' } };
    const res = makeRes();
    const next = jest.fn();

    await requireAuth(req, res, next);

    expect(req.user).toEqual({ userId: 'user-uuid-1', userRole: 'employee' });
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.redirect).not.toHaveBeenCalled();
  });

  test('fails closed (redirects) when verifySession throws', async () => {
    mockVerifySession.mockRejectedValueOnce(new Error('db down'));
    const req = { cookies: { [SESSION_COOKIE_NAME]: 'token' } };
    const res = makeRes();
    const next = jest.fn();
    const errSpy = jest.spyOn(console, 'error').mockImplementation();

    await requireAuth(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith('/login');
    expect(next).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe('roleGuard', () => {
  test('redirects to /login when the request is unauthenticated (Req 3.7)', () => {
    const guard = roleGuard('employee');
    const req = {};
    const res = makeRes();
    const next = jest.fn();

    guard(req, res, next);

    expect(res.redirect).toHaveBeenCalledWith('/login');
    expect(next).not.toHaveBeenCalled();
  });

  test('grants access when the role matches (Req 3.1, 3.3, 3.5)', () => {
    const guard = roleGuard('store_manager');
    const req = { user: { userId: 'u1', userRole: 'store_manager' } };
    const res = makeRes();
    const next = jest.fn();

    guard(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('returns 403 when the role does not match (Req 3.2, 3.4, 3.6)', () => {
    const guard = roleGuard('warehouse_manager');
    const req = { user: { userId: 'u1', userRole: 'employee' } };
    const res = makeRes();
    const next = jest.fn();

    guard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  test.each([
    ['employee', 'store_manager'],
    ['employee', 'warehouse_manager'],
    ['store_manager', 'employee'],
    ['store_manager', 'warehouse_manager'],
    ['warehouse_manager', 'employee'],
    ['warehouse_manager', 'store_manager']
  ])('denies %s accessing a %s-guarded route with 403', (userRole, requiredRole) => {
    const guard = roleGuard(requiredRole);
    const req = { user: { userId: 'u1', userRole } };
    const res = makeRes();
    const next = jest.fn();

    guard(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
