/**
 * Unit tests for database connection module
 * Tests Requirements: 19.5 (connection pooling), 16.1 (error handling), 16.2 (database error logging)
 */

// Mock pg module before any imports
const mockPoolInstance = {
  query: jest.fn(),
  end: jest.fn(),
  on: jest.fn(),
  queryWithRetry: jest.fn(),
};

const mockPool = jest.fn(() => mockPoolInstance);

jest.mock('pg', () => ({
  Pool: mockPool
}));

// Mock dotenv
jest.mock('dotenv', () => ({
  config: jest.fn()
}));

describe('Database Connection Module', () => {
  let originalEnv;
  let consoleErrorSpy;
  let consoleWarnSpy;
  let consoleLogSpy;
  
  beforeEach(() => {
    // Save original environment
    originalEnv = process.env;
    
    // Suppress console output during tests
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    
    // Set up test environment variables
    process.env = {
      ...originalEnv,
      DB_HOST: 'localhost',
      DB_PORT: '5432',
      DB_NAME: 'testdb',
      DB_USER: 'testuser',
      DB_PASSWORD: 'testpass'
    };
    
    // Clear module cache and mocks
    jest.clearAllMocks();
    jest.resetModules();
  });
  
  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    
    // Restore console methods
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });
  
  describe('Configuration', () => {
    test('should create pool with correct configuration from environment variables', () => {
      const db = require('./database');
      
      expect(mockPool).toHaveBeenCalledWith(expect.objectContaining({
        host: 'localhost',
        port: 5432,
        database: 'testdb',
        user: 'testuser',
        password: 'testpass',
        min: 5,
        max: 20
      }));
    });
    
    test('should set minimum connections to 5', () => {
      const db = require('./database');
      
      const poolConfig = mockPool.mock.calls[0][0];
      expect(poolConfig.min).toBe(5);
    });
    
    test('should set maximum connections to 20', () => {
      const db = require('./database');
      
      const poolConfig = mockPool.mock.calls[0][0];
      expect(poolConfig.max).toBe(20);
    });
    
    test('should throw error when required environment variables are missing', () => {
      delete process.env.DB_NAME;
      jest.resetModules();
      
      expect(() => {
        require('./database');
      }).toThrow('Database configuration error: Missing environment variables');
    });
    
    test('should throw error when DB_USER is missing', () => {
      delete process.env.DB_USER;
      jest.resetModules();
      
      expect(() => {
        require('./database');
      }).toThrow();
    });
    
    test('should throw error when DB_PASSWORD is missing', () => {
      delete process.env.DB_PASSWORD;
      jest.resetModules();
      
      expect(() => {
        require('./database');
      }).toThrow();
    });
    
    test('should use default values for optional configuration', () => {
      // DB_PORT is optional and should default to 5432
      delete process.env.DB_PORT;
      jest.resetModules();
      
      const db = require('./database');
      
      const poolConfig = mockPool.mock.calls[0][0];
      expect(poolConfig.port).toBe(5432);
    });
  });
  
  describe('Pool Instance', () => {
    test('should export pool instance', () => {
      const db = require('./database');
      
      expect(db.pool).toBeDefined();
      expect(db.pool).toBeTruthy();
    });
    
    test('should register error handler on pool', () => {
      const db = require('./database');
      
      expect(mockPoolInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
    });
    
    test('should register connect handler on pool', () => {
      const db = require('./database');
      
      expect(mockPoolInstance.on).toHaveBeenCalledWith('connect', expect.any(Function));
    });
    
    test('should register acquire handler on pool', () => {
      const db = require('./database');
      
      expect(mockPoolInstance.on).toHaveBeenCalledWith('acquire', expect.any(Function));
    });
    
    test('should register remove handler on pool', () => {
      const db = require('./database');
      
      expect(mockPoolInstance.on).toHaveBeenCalledWith('remove', expect.any(Function));
    });
  });
  
  describe('Connection Testing', () => {
    test('should export testConnection function', () => {
      const db = require('./database');
      
      expect(db.testConnection).toBeDefined();
      expect(typeof db.testConnection).toBe('function');
    });
    
    test('testConnection should query database and return true on success', async () => {
      mockPoolInstance.query.mockResolvedValueOnce({
        rows: [{
          current_time: new Date(),
          postgres_version: 'PostgreSQL 15.0'
        }]
      });
      
      const db = require('./database');
      const result = await db.testConnection();
      
      expect(result).toBe(true);
      expect(mockPoolInstance.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT NOW()')
      );
    });
    
    test('testConnection should return false on failure', async () => {
      mockPoolInstance.query.mockRejectedValueOnce(new Error('Connection failed'));
      
      const db = require('./database');
      const result = await db.testConnection();
      
      expect(result).toBe(false);
    });
  });
  
  describe('Retry Logic', () => {
    test('should export retryOperation function', () => {
      const db = require('./database');
      
      expect(db.retryOperation).toBeDefined();
      expect(typeof db.retryOperation).toBe('function');
    });
    
    test('retryOperation should retry failed operations', async () => {
      const db = require('./database');
      const mockOperation = jest.fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockRejectedValueOnce(new Error('Second failure'))
        .mockResolvedValueOnce({ success: true });
      
      const result = await db.retryOperation(mockOperation, 3);
      
      expect(mockOperation).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ success: true });
    });
    
    test('retryOperation should throw error after max retries', async () => {
      const db = require('./database');
      const mockOperation = jest.fn()
        .mockRejectedValue(new Error('Persistent failure'));
      
      await expect(db.retryOperation(mockOperation, 2)).rejects.toThrow('Persistent failure');
      expect(mockOperation).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });
    
    test('retryOperation should succeed on first attempt if no error', async () => {
      const db = require('./database');
      const mockOperation = jest.fn().mockResolvedValueOnce({ success: true });
      
      const result = await db.retryOperation(mockOperation, 3);
      
      expect(mockOperation).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true });
    });
    
    test('pool should have queryWithRetry method', () => {
      const db = require('./database');
      
      expect(db.pool.queryWithRetry).toBeDefined();
      expect(typeof db.pool.queryWithRetry).toBe('function');
    });
  });
  
  describe('Pool Cleanup', () => {
    test('should export closePool function', () => {
      const db = require('./database');
      
      expect(db.closePool).toBeDefined();
      expect(typeof db.closePool).toBe('function');
    });
    
    test('closePool should end the pool', async () => {
      mockPoolInstance.end.mockResolvedValueOnce();
      
      const db = require('./database');
      await db.closePool();
      
      expect(mockPoolInstance.end).toHaveBeenCalled();
    });
    
    test('closePool should throw error if pool.end fails', async () => {
      mockPoolInstance.end.mockRejectedValueOnce(new Error('End failed'));
      
      const db = require('./database');
      await expect(db.closePool()).rejects.toThrow('End failed');
    });
  });
  
  describe('Error Handling', () => {
    test('should handle pool error events', () => {
      const db = require('./database');
      
      // Get the error handler
      const errorHandlerCall = mockPoolInstance.on.mock.calls.find(call => call[0] === 'error');
      expect(errorHandlerCall).toBeDefined();
      
      const errorHandler = errorHandlerCall[1];
      const mockError = new Error('Pool error');
      
      errorHandler(mockError, {});
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Database] Unexpected error'),
        expect.objectContaining({
          error: 'Pool error'
        })
      );
    });
  });
  
  describe('Environment Variable Validation', () => {
    test('should validate all required environment variables are present', () => {
      const requiredVars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
      
      requiredVars.forEach(varName => {
        jest.resetModules();
        const testEnv = { ...process.env };
        delete testEnv[varName];
        process.env = testEnv;
        
        expect(() => {
          require('./database');
        }).toThrow();
        
        // Restore for next iteration
        process.env = {
          DB_HOST: 'localhost',
          DB_PORT: '5432',
          DB_NAME: 'testdb',
          DB_USER: 'testuser',
          DB_PASSWORD: 'testpass'
        };
      });
    });
  });
});
