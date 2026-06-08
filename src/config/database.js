const { Pool } = require('pg');
require('dotenv').config();

/**
 * Database Connection Module
 * Provides PostgreSQL connection pooling with error handling and retry logic
 * 
 * Requirements: 19.5 (connection pooling), 16.1 (error handling), 16.2 (database error logging)
 */

// Connection configuration from environment variables
const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  min: 5,  // Minimum connections in pool
  max: 20, // Maximum connections in pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 10000, // Wait 10 seconds before timing out
  maxUses: 7500, // Rotate connections after 7500 uses
};

// Validate required environment variables
const requiredEnvVars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(`[Database] Missing required environment variables: ${missingVars.join(', ')}`);
  throw new Error(`Database configuration error: Missing environment variables`);
}

// Create connection pool
const pool = new Pool(poolConfig);

// Connection retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/**
 * Retry logic for database operations
 * @param {Function} operation - Async function to retry
 * @param {number} retries - Number of retries remaining
 * @returns {Promise<any>}
 */
async function retryOperation(operation, retries = MAX_RETRIES) {
  try {
    return await operation();
  } catch (error) {
    if (retries > 0) {
      console.warn(`[Database] Operation failed, retrying... (${retries} attempts remaining)`);
      console.warn(`[Database] Error: ${error.message}`);
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
      
      return retryOperation(operation, retries - 1);
    }
    throw error;
  }
}

/**
 * Enhanced pool query method with retry logic
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @returns {Promise<Object>}
 */
pool.queryWithRetry = async function(text, params) {
  return retryOperation(async () => {
    return await pool.query(text, params);
  });
};

// Pool error handling
pool.on('error', (err, client) => {
  console.error('[Database] Unexpected error on idle client', {
    error: err.message,
    stack: err.stack,
    timestamp: new Date().toISOString()
  });
});

// Pool connection event
pool.on('connect', (client) => {
  console.log('[Database] New client connected to pool');
});

// Pool acquisition event
pool.on('acquire', (client) => {
  console.log('[Database] Client acquired from pool');
});

// Pool removal event
pool.on('remove', (client) => {
  console.log('[Database] Client removed from pool');
});

/**
 * Test database connection
 * @returns {Promise<boolean>}
 */
async function testConnection() {
  try {
    const result = await retryOperation(async () => {
      return await pool.query('SELECT NOW() as current_time, version() as postgres_version');
    });
    
    console.log('[Database] Connection successful');
    console.log(`[Database] PostgreSQL Version: ${result.rows[0].postgres_version}`);
    console.log(`[Database] Server Time: ${result.rows[0].current_time}`);
    
    return true;
  } catch (error) {
    console.error('[Database] Connection test failed', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    return false;
  }
}

/**
 * Gracefully close all pool connections
 * @returns {Promise<void>}
 */
async function closePool() {
  try {
    await pool.end();
    console.log('[Database] Pool has ended gracefully');
  } catch (error) {
    console.error('[Database] Error closing pool', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    });
    throw error;
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  console.log('[Database] SIGINT received, closing pool...');
  await closePool();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('[Database] SIGTERM received, closing pool...');
  await closePool();
  process.exit(0);
});

// Export pool instance and utility functions
module.exports = {
  pool,
  testConnection,
  closePool,
  retryOperation
};
