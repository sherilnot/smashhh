/**
 * Example usage of the database connection module
 * This file demonstrates how to use the database module in the Employee Management System
 */

const { pool, testConnection, closePool } = require('./database');

// Example 1: Test database connection
async function exampleTestConnection() {
  console.log('Example 1: Testing database connection...');
  const isConnected = await testConnection();
  if (isConnected) {
    console.log('✓ Database connection successful');
  } else {
    console.error('✗ Database connection failed');
  }
}

// Example 2: Simple query
async function exampleSimpleQuery() {
  console.log('\nExample 2: Executing simple query...');
  try {
    const result = await pool.query('SELECT $1 as message', ['Hello from database!']);
    console.log('✓ Query result:', result.rows[0].message);
  } catch (error) {
    console.error('✗ Query failed:', error.message);
  }
}

// Example 3: Query with retry logic
async function exampleQueryWithRetry() {
  console.log('\nExample 3: Executing query with retry logic...');
  try {
    const result = await pool.queryWithRetry(
      'SELECT user_id, role FROM users WHERE user_id = $1',
      ['emp001']
    );
    if (result.rows.length > 0) {
      console.log('✓ User found:', result.rows[0]);
    } else {
      console.log('✓ Query executed but no user found');
    }
  } catch (error) {
    console.error('✗ Query failed after retries:', error.message);
  }
}

// Example 4: Transaction
async function exampleTransaction() {
  console.log('\nExample 4: Executing transaction...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Create a shift
    const shiftResult = await client.query(
      `INSERT INTO shifts (start_time, end_time, store_location, capacity) 
       VALUES ($1, $2, $3, $4) 
       RETURNING id`,
      [new Date('2024-02-01T09:00:00'), new Date('2024-02-01T17:00:00'), 'Store A', 5]
    );
    
    console.log('✓ Shift created with ID:', shiftResult.rows[0].id);
    
    await client.query('COMMIT');
    console.log('✓ Transaction committed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('✗ Transaction failed and rolled back:', error.message);
  } finally {
    client.release();
  }
}

// Example 5: Handling errors gracefully
async function exampleErrorHandling() {
  console.log('\nExample 5: Demonstrating error handling...');
  try {
    // This will fail if the table doesn't exist
    await pool.query('SELECT * FROM nonexistent_table');
  } catch (error) {
    console.log('✓ Error caught gracefully:', error.message);
  }
}

// Example 6: Concurrent queries
async function exampleConcurrentQueries() {
  console.log('\nExample 6: Executing concurrent queries...');
  try {
    const queries = [
      pool.query('SELECT 1 as number'),
      pool.query('SELECT 2 as number'),
      pool.query('SELECT 3 as number'),
    ];
    
    const results = await Promise.all(queries);
    console.log('✓ All queries completed:', results.map(r => r.rows[0].number));
  } catch (error) {
    console.error('✗ Concurrent queries failed:', error.message);
  }
}

// Main function to run all examples
async function runExamples() {
  console.log('=== Database Module Examples ===\n');
  
  try {
    await exampleTestConnection();
    await exampleSimpleQuery();
    await exampleQueryWithRetry();
    // Uncomment the following if tables exist:
    // await exampleTransaction();
    await exampleErrorHandling();
    await exampleConcurrentQueries();
  } catch (error) {
    console.error('Unexpected error:', error);
  } finally {
    console.log('\n=== Closing database connection ===');
    await closePool();
    console.log('✓ Database connection closed');
  }
}

// Run examples if this file is executed directly
if (require.main === module) {
  runExamples().catch(console.error);
}

module.exports = {
  exampleTestConnection,
  exampleSimpleQuery,
  exampleQueryWithRetry,
  exampleTransaction,
  exampleErrorHandling,
  exampleConcurrentQueries
};
