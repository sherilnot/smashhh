/**
 * Temporary verification test for authenticate() (task 2.3).
 * Mocks the database pool so no live DB connection is required.
 */

const mockQuery = jest.fn();

jest.mock('../config/database', () => ({
  pool: { query: (...args) => mockQuery(...args) }
}));

const bcrypt = require('bcrypt');
const AuthenticationService = require('./authService');

describe('authenticate()', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('rejects empty userId', async () => {
    const result = await AuthenticationService.authenticate('', 'password123');
    expect(result.success).toBe(false);
    expect(result.error).toBe('User ID is required');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('returns Invalid credentials for unknown user', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const result = await AuthenticationService.authenticate('ghost', 'password123');
    expect(result).toEqual({ success: false, error: 'Invalid credentials' });
  });

  test('returns Account is deactivated for inactive user', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', user_id: 'jdoe', password_hash: 'h', role: 'employee', is_active: false }]
    });
    const result = await AuthenticationService.authenticate('jdoe', 'password123');
    expect(result).toEqual({ success: false, error: 'Account is deactivated' });
  });

  test('returns Invalid credentials when password mismatches', async () => {
    const hash = await bcrypt.hash('correct-password', 4);
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'u1', user_id: 'jdoe', password_hash: hash, role: 'employee', is_active: true }]
    });
    const result = await AuthenticationService.authenticate('jdoe', 'wrong-password');
    expect(result).toEqual({ success: false, error: 'Invalid credentials' });
  });

  test('succeeds with valid credentials and creates a session', async () => {
    const hash = await bcrypt.hash('correct-password', 4);
    mockQuery
      .mockResolvedValueOnce({
        rows: [{ id: 'u1', user_id: 'jdoe', password_hash: hash, role: 'store_manager', is_active: true }]
      })
      .mockResolvedValueOnce({ rows: [] }); // INSERT into sessions

    const result = await AuthenticationService.authenticate('jdoe', 'correct-password');

    expect(result.success).toBe(true);
    expect(result.userRole).toBe('store_manager');
    expect(result.userId).toBe('u1');
    expect(typeof result.sessionToken).toBe('string');
    expect(result.sessionToken).toHaveLength(64);

    // Verify session INSERT was parameterized with an 8-hour expiry.
    const insertCall = mockQuery.mock.calls[1];
    expect(insertCall[0]).toContain('INSERT INTO sessions');
    const [userIdParam, tokenParam, expiresAt] = insertCall[1];
    expect(userIdParam).toBe('u1');
    expect(tokenParam).toBe(result.sessionToken);
    const eightHoursMs = 8 * 60 * 60 * 1000;
    expect(expiresAt.getTime() - Date.now()).toBeGreaterThan(eightHoursMs - 5000);
    expect(expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(eightHoursMs + 5000);
  });

  test('returns generic failure on database error', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const result = await AuthenticationService.authenticate('jdoe', 'password123');
    expect(result.success).toBe(false);
    expect(result.error).toBe('Authentication failed. Please try again.');
  });
});
