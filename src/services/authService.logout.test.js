/**
 * Verification tests for logout() (task 2.5).
 * Mocks the database pool so no live DB connection is required.
 *
 * Requirement 2.4: when a user logs out, the session is marked as inactive.
 */

const mockQuery = jest.fn();

jest.mock('../config/database', () => ({
  pool: { query: (...args) => mockQuery(...args) }
}));

const AuthenticationService = require('./authService');

describe('logout()', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  test('marks the matching session inactive with a parameterized query', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await AuthenticationService.logout('abc123token');

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('UPDATE sessions');
    expect(sql).toContain('is_active = false');
    expect(sql).toContain('$1');
    expect(params).toEqual(['abc123token']);
  });

  test('resolves to undefined (Promise<void>) on success', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const result = await AuthenticationService.logout('abc123token');
    expect(result).toBeUndefined();
  });

  test('is idempotent: unknown/already-inactive token updates zero rows and succeeds', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(AuthenticationService.logout('ghost-token')).resolves.toBeUndefined();
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test('does not touch the database for an empty token', async () => {
    await AuthenticationService.logout('');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('does not touch the database for a non-string token', async () => {
    await AuthenticationService.logout(undefined);
    await AuthenticationService.logout(null);
    await AuthenticationService.logout(12345);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('does not touch the database for a whitespace-only token', async () => {
    await AuthenticationService.logout('   ');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test('rethrows database errors so callers can surface the failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    await expect(AuthenticationService.logout('abc123token')).rejects.toThrow('connection refused');
  });
});
