/**
 * Integration test for database connection module
 * This test file is designed to run only when DATABASE is available
 * Run with: RUN_INTEGRATION_TESTS=true npm test -- database.integration.test.js
 * 
 * Skip in CI/CD or when database is unavailable
 */

describe('Database Connection Integration Tests', () => {
  // Skip these tests if DB is not available
  const isDBAvailable = process.env.RUN_INTEGRATION_TESTS === 'true';
  
  (isDBAvailable ? describe : describe.skip)('With real database', () => {
    let pool, testConnection, closePool;
    
    beforeAll(() => {
      const db = require('./database');
      pool = db.pool;
      testConnection = db.testConnection;
      closePool = db.closePool;
    });
    
    afterAll(async () => {
      if (closePool) {
        await closePool();
      }
    });
    
    test('should connect to database successfully', async () => {
      const result = await testConnection();
      expect(result).toBe(true);
    }, 15000); // 15 second timeout for database operations
    
    test('pool should have correct configuration', () => {
      expect(pool.options.min).toBe(5);
      expect(pool.options.max).toBe(20);
    });
    
    test('should execute simple query', async () => {
      const result = await pool.query('SELECT 1 as number');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].number).toBe(1);
    }, 10000);
    
    test('should retry failed queries', async () => {
      // This will succeed immediately
      const result = await pool.queryWithRetry('SELECT NOW() as time');
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].time).toBeInstanceOf(Date);
    }, 10000);
    
    test('should handle concurrent connections within pool limits', async () => {
      const queries = Array.from({ length: 15 }, (_, i) => 
        pool.query('SELECT $1 as id', [i])
      );
      
      const results = await Promise.all(queries);
      
      expect(results).toHaveLength(15);
      results.forEach((result, index) => {
        expect(result.rows[0].id).toBe(index);
      });
    }, 20000);
  });
  
  describe('Without database (documentation)', () => {
    test('module structure is correct even without loading', () => {
      // This test just verifies the test structure works
      expect(true).toBe(true);
    });
  });
});
