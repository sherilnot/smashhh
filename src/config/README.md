# Database Configuration Module

## Overview

This module provides a PostgreSQL connection pool with comprehensive error handling, retry logic, and monitoring capabilities for the Employee Management System.

## Requirements Coverage

- **Requirement 19.5**: Database connection pooling with min: 5, max: 20 connections
- **Requirement 16.1**: Connection error handling and retry logic
- **Requirement 16.2**: Database error logging with timestamps and stack traces

## Features

### Connection Pooling
- Minimum pool size: 5 connections
- Maximum pool size: 20 connections
- Idle timeout: 30 seconds
- Connection timeout: 10 seconds
- Connection rotation after 7,500 uses

### Error Handling
- Automatic retry logic for failed operations (up to 3 retries with 2-second delay)
- Comprehensive error logging with timestamps and stack traces
- Pool error event monitoring
- Connection lifecycle event tracking

### Environment Variables

Required variables:
- `DB_HOST` - PostgreSQL server hostname
- `DB_NAME` - Database name
- `DB_USER` - Database user
- `DB_PASSWORD` - Database password

Optional variables:
- `DB_PORT` - PostgreSQL server port (default: 5432)

## Usage

### Basic Usage

```javascript
const { pool } = require('./config/database');

// Simple query
const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);

// Query with automatic retry
const result = await pool.queryWithRetry('SELECT * FROM users WHERE id = $1', [userId]);
```

### With Transaction

```javascript
const { pool } = require('./config/database');

const client = await pool.connect();
try {
  await client.query('BEGIN');
  
  // Your database operations here
  const result = await client.query('INSERT INTO users (name) VALUES ($1) RETURNING id', ['John']);
  
  await client.query('COMMIT');
  return result.rows[0];
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
}
```

### Connection Testing

```javascript
const { testConnection } = require('./config/database');

// Test database connectivity
const isConnected = await testConnection();
if (!isConnected) {
  console.error('Database connection failed');
}
```

### Graceful Shutdown

```javascript
const { closePool } = require('./config/database');

// Close all connections gracefully
await closePool();
```

## Error Handling

The module automatically handles:

1. **Connection errors**: Logs errors and retries operations
2. **Pool errors**: Monitors and logs unexpected errors on idle clients
3. **Transaction failures**: Provides clean error propagation for rollback handling

## Event Monitoring

The module logs the following events:
- Client connections
- Client acquisitions from pool
- Client removals from pool
- Unexpected errors on idle clients

## Testing

### Unit Tests
```bash
npm test -- src/config/database.test.js
```

### Integration Tests
```bash
# Requires a running PostgreSQL instance
RUN_INTEGRATION_TESTS=true npm test -- src/config/database.integration.test.js
```

## Configuration Example

`.env` file:
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=employee_management
DB_USER=postgres
DB_PASSWORD=your_secure_password
```

## Best Practices

1. **Always use parameterized queries** to prevent SQL injection
2. **Release clients** after use when using `pool.connect()`
3. **Use transactions** for operations that require atomicity
4. **Monitor pool events** in production for performance insights
5. **Set appropriate pool sizes** based on application load

## Performance

Under normal load, the module meets the following performance requirements:
- Authentication queries: < 100ms (Requirement 19.1)
- Shift availability queries: < 200ms (Requirement 19.2)
- Wage calculations: < 500ms for monthly periods (Requirement 19.3)
- Checklist retrieval: < 150ms (Requirement 19.4)

## Troubleshooting

### Connection Refused
- Verify PostgreSQL is running
- Check `DB_HOST` and `DB_PORT` environment variables
- Ensure firewall allows connections

### Pool Exhausted
- Increase `max` pool size if needed
- Check for connection leaks (unreleased clients)
- Review query performance

### Slow Queries
- Add database indexes as per Requirement 14
- Use `EXPLAIN ANALYZE` to optimize queries
- Consider query result caching for frequently accessed data
