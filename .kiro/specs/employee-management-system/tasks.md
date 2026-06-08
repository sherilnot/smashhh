# Implementation Plan: Employee Management System

## Overview

This implementation plan breaks down the Employee Management System into discrete coding tasks. The system is a Node.js/Express web application with PostgreSQL database, providing role-based authentication and dashboards for three user types: employees (shift booking), store managers (wage calculation), and warehouse managers (inventory checklists). The implementation uses JavaScript (not TypeScript), EJS templates for server-side rendering, bcrypt for authentication, and node-cron for scheduled jobs.

## Tasks

- [x] 1. Database schema and connection setup
  - [x] 1.1 Create database schema with all tables
    - Write SQL schema file with users, sessions, shifts, shift_bookings, inventory_checklists, checklist_items, products, and expected_deliveries tables
    - Include all indexes, constraints, foreign keys, and unique constraints as specified in design
    - Add check constraints for data validation (e.g., end_time > start_time, capacity > 0)
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8_
  
  - [x] 1.2 Implement database connection module with pooling
    - Create src/config/database.js with pg pool configuration (min: 5, max: 20 connections)
    - Implement connection error handling and retry logic
    - Load database credentials from environment variables
    - Export pool instance for use across application
    - _Requirements: 19.5, 16.1, 16.2_

- [ ] 2. Authentication Service implementation
  - [x] 2.1 Implement password hashing and verification functions
    - Create src/services/authService.js
    - Implement hashPassword() function using bcrypt with cost factor 12
    - Implement verifyPassword() function using bcrypt.compare()
    - _Requirements: 1.4, 1.5_
  
  - [x] 2.2 Implement session token generation
    - Create generateSecureToken() function using crypto.randomBytes(32)
    - Ensure tokens are cryptographically secure and unique
    - _Requirements: 1.6_
  
  - [x] 2.3 Implement authenticate() function
    - Validate user credentials against database
    - Check user is_active status before allowing authentication
    - Compare password using bcrypt
    - Create session record with 8-hour expiration
    - Return AuthResult with success, sessionToken, userRole, and userId
    - Log failed authentication attempts without exposing passwords
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 16.3, 16.6, 19.1_
  
  - [ ] 2.4 Implement verifySession() function
    - Query session from database by token
    - Check session is_active and not expired (expires_at > NOW())
    - Return SessionData with userId and userRole, or null if invalid
    - _Requirements: 2.1, 2.2, 2.3_
  
  - [ ] 2.5 Implement logout() function
    - Mark session as inactive in database
    - _Requirements: 2.4_
  
  - [ ]* 2.6 Write property tests for Authentication Service
    - **Property 1: Valid sessions should verify successfully**
    - **Validates: Requirements 1.6, 1.7, 2.1**
    - **Property 2: Expired sessions always return null**
    - **Validates: Requirements 2.2, 1.7**
    - **Property 3: Inactive user authentication always fails**
    - **Validates: Requirements 1.3**
  
  - [ ]* 2.7 Write unit tests for Authentication Service
    - Test valid credentials → successful authentication
    - Test invalid user_id → authentication failure
    - Test invalid password → authentication failure
    - Test inactive user → authentication failure
    - Test session verification with expired token
    - Test logout marks session inactive

- [ ] 3. Authentication routes and middleware
  - [ ] 3.1 Implement authentication middleware
    - Create src/middleware/auth.js
    - Implement requireAuth middleware to verify session from cookie
    - Implement roleGuard middleware to check user role (employee, store_manager, warehouse_manager)
    - Redirect unauthenticated users to login page
    - Return 403 Forbidden for unauthorized role access
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
  
  - [ ] 3.2 Create login and logout routes
    - Create src/routes/auth.js
    - Implement GET /login route to render login page
    - Implement POST /login route to authenticate and set session cookie
    - Configure cookie with httpOnly, secure, sameSite: strict, maxAge: 8 hours
    - Implement POST /logout route to invalidate session and clear cookie
    - Redirect based on user role after successful login
    - _Requirements: 1.1, 1.2, 2.4, 2.5, 2.6, 2.7, 17.1, 17.2, 17.3_
  
  - [ ] 3.3 Create login view template
    - Create src/views/auth/login.ejs
    - Include form with user_id and password fields
    - Display error messages from authentication failures
    - Use EJS auto-escaping (<%=) for all user input
    - _Requirements: 18.1_

- [ ] 4. Shift Booking Service implementation
  - [ ] 4.1 Implement getAvailableShifts() function
    - Create src/services/shiftService.js
    - Query shifts within date range where start_time > NOW()
    - Use LEFT JOIN with shift_bookings to count confirmed bookings
    - Filter shifts where current_bookings < capacity
    - Return shifts sorted by start_time ascending
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 19.2_
  
  - [ ] 4.2 Implement bookShift() function
    - Begin database transaction for atomicity
    - Validate employee exists and has employee role
    - Validate shift exists and is in the future
    - Use SELECT FOR UPDATE to lock shift record for capacity check
    - Check for existing booking by same employee
    - Count confirmed bookings and verify capacity not exceeded
    - Create shift_bookings record with status 'confirmed'
    - Commit transaction on success, rollback on failure
    - Return BookingResult with success status and error messages
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 15.1, 15.2, 15.3, 15.4, 16.1, 16.2_
  
  - [ ] 4.3 Implement cancelShift() function
    - Update shift_bookings status to 'cancelled'
    - Set cancelled_at timestamp to NOW()
    - Validate employee owns the booking before allowing cancellation
    - _Requirements: 6.1, 6.2, 6.3, 6.4_
  
  - [ ] 4.4 Implement getEmployeeShifts() function
    - Query all shifts for employee within date range
    - Include shift details and booking status
    - Return shifts sorted by start_time
    - _Requirements: 4.1, 4.5_
  
  - [ ]* 4.5 Write property tests for Shift Booking Service
    - **Property 4: Confirmed bookings never exceed shift capacity**
    - **Validates: Requirements 5.2, 5.5, 15.3**
    - **Property 5: Booking same shift twice always fails**
    - **Validates: Requirements 5.3**
    - **Property 6: Past shifts cannot be booked**
    - **Validates: Requirements 5.4**
  
  - [ ]* 4.6 Write unit tests for Shift Booking Service
    - Test book available shift → success
    - Test book at-capacity shift → failure
    - Test book same shift twice → failure
    - Test book past shift → failure
    - Test cancel shift updates status to 'cancelled'
    - Test transaction rollback on booking errors

- [ ] 5. Employee routes and views
  - [ ] 5.1 Create employee shift booking routes
    - Create src/routes/employee.js
    - Implement GET /employee/dashboard to render employee dashboard
    - Implement GET /employee/shifts to show available shifts (default next 7 days)
    - Implement POST /employee/book-shift to book a shift
    - Implement POST /employee/cancel-shift to cancel a booking
    - Implement GET /employee/my-shifts to show employee's booked shifts
    - Apply requireAuth and roleGuard('employee') middleware to all routes
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4_
  
  - [ ] 5.2 Create employee view templates
    - Create src/views/employee/dashboard.ejs for employee landing page
    - Create src/views/employee/shifts.ejs to display available shifts with booking buttons
    - Create src/views/employee/my-shifts.ejs to show booked shifts with cancel buttons
    - Use EJS auto-escaping (<%=) for all dynamic content
    - _Requirements: 4.4, 18.1_

- [ ] 6. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Wage Calculation Service implementation
  - [ ] 7.1 Implement calculateAllWages() function
    - Create src/services/wageService.js
    - Query all completed shifts within date range with employee data
    - Calculate hours_worked as (end_time - start_time) / 3600000 milliseconds
    - Calculate wage for each shift as hours_worked × hourly_wage
    - Group shifts by employee and aggregate totals
    - Round totalHours and totalWages to 2 decimal places
    - Include detailed shift breakdown for each employee
    - Return array of WageReport objects
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 19.3_
  
  - [ ] 7.2 Implement calculateEmployeeWages() function
    - Similar to calculateAllWages but for single employee
    - Filter by employee_id parameter
    - Return single WageReport object
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_
  
  - [ ] 7.3 Implement getEmployeeHourlyRate() function
    - Query hourly_wage from users table for employee
    - _Requirements: 8.3_
  
  - [ ] 7.4 Implement updateHourlyRate() function
    - Update hourly_wage in users table for employee
    - Validate hourly rate is positive number
    - _Requirements: 8.1, 8.2_
  
  - [ ]* 7.5 Write property tests for Wage Calculation Service
    - **Property 7: Total wages equal sum of individual shift wages**
    - **Validates: Requirements 7.3, 7.4, 7.5**
    - **Property 8: Total hours equal sum of individual shift hours**
    - **Validates: Requirements 7.2, 7.4, 7.6**
    - **Property 9: Wages are always non-negative**
    - **Validates: Requirements 7.3, 7.4, 7.5**
  
  - [ ]* 7.6 Write unit tests for Wage Calculation Service
    - Test hours calculation: (end_time - start_time) / 3600000
    - Test wage calculation: hours × hourly_rate
    - Test aggregation across multiple shifts
    - Test rounding to 2 decimal places
    - Test empty date range returns empty results
    - Test only 'completed' shifts included

- [ ] 8. Store Manager routes and views
  - [ ] 8.1 Create store manager wage routes
    - Create src/routes/manager.js
    - Implement GET /manager/dashboard to render store manager dashboard
    - Implement GET /manager/wages to show wage calculations (default current month)
    - Allow date range filtering via query parameters
    - Implement POST /manager/update-rate to update employee hourly rate
    - Apply requireAuth and roleGuard('store_manager') middleware to all routes
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9, 8.1, 8.2_
  
  - [ ] 8.2 Create store manager view templates
    - Create src/views/manager/dashboard.ejs for store manager landing page
    - Create src/views/manager/wages.ejs to display wage reports with summary totals
    - Include table with employee name, total hours, hourly rate, total wages
    - Add expandable section for detailed shift breakdowns
    - Include date range filter form
    - Use EJS auto-escaping (<%=) for all dynamic content
    - _Requirements: 7.9, 18.1_

- [ ] 9. Inventory Check Service implementation
  - [ ] 9.1 Implement generateNightlyChecklists() function
    - Create src/services/inventoryService.js
    - Begin database transaction for atomicity
    - Calculate tomorrow's date (next day from current date)
    - Query all active warehouse managers
    - Query expected_deliveries for tomorrow from expected_deliveries table
    - Group deliveries by warehouse_manager_id
    - For each warehouse manager with deliveries:
      - Create inventory_checklists record with status 'pending'
      - Create checklist_items for each expected delivery with status 'pending'
      - Send notification email to warehouse manager
    - Commit transaction on success, rollback on failure
    - Log errors and send alert to system administrators on failure
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 16.1, 16.2, 16.4_
  
  - [ ] 9.2 Implement getChecklist() function
    - Query checklist for warehouse manager and specific date
    - Include all checklist items with product names
    - Return null if no checklist exists for date
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 19.4_
  
  - [ ] 9.3 Implement markItemChecked() function
    - Begin database transaction for atomicity
    - Validate checklist item exists and belongs to specified checklist
    - Validate status matches actual quantity:
      - status 'arrived' requires actual_quantity === expected_quantity
      - status 'partial' requires 0 < actual_quantity < expected_quantity
      - status 'missing' requires actual_quantity === 0
    - Update checklist_items with actual_quantity, status, and checked_at timestamp
    - Count pending items in checklist
    - Update checklist status:
      - 'completed' if no pending items remain (set completed_at timestamp)
      - 'in_progress' if some items checked but some pending
      - 'pending' if all items remain pending
    - Commit transaction on success, rollback on validation failure
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 12.1, 12.2, 12.3, 12.4, 16.1, 16.2_
  
  - [ ] 9.4 Implement getChecklistHistory() function
    - Query checklists for warehouse manager within date range
    - Include summary statistics (total items, completed items, status)
    - _Requirements: 10.1, 10.4_
  
  - [ ]* 9.5 Write property tests for Inventory Check Service
    - **Property 10: Status 'arrived' implies actual quantity equals expected**
    - **Validates: Requirements 11.1, 11.5**
    - **Property 11: Status 'partial' implies actual between 0 and expected**
    - **Validates: Requirements 11.2, 11.5**
    - **Property 12: Status 'missing' implies actual quantity is zero**
    - **Validates: Requirements 11.3, 11.5**
    - **Property 13: All items checked implies checklist completed**
    - **Validates: Requirements 12.1, 12.2**
  
  - [ ]* 9.6 Write unit tests for Inventory Check Service
    - Test generate checklist for all warehouse managers
    - Test checklist items match expected deliveries
    - Test mark item with valid status → success
    - Test mark item with invalid status → failure
    - Test all items checked → checklist status = 'completed'
    - Test one checklist per manager per date constraint

- [ ] 10. Warehouse Manager routes and views
  - [ ] 10.1 Create warehouse manager inventory routes
    - Create src/routes/warehouse.js
    - Implement GET /warehouse/dashboard to render warehouse manager dashboard
    - Implement GET /warehouse/checklist to show today's checklist
    - Allow date selection via query parameter
    - Implement POST /warehouse/check-item to mark item as checked with actual quantity
    - Implement GET /warehouse/history to show checklist history
    - Apply requireAuth and roleGuard('warehouse_manager') middleware to all routes
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 12.3, 12.4_
  
  - [ ] 10.2 Create warehouse manager view templates
    - Create src/views/warehouse/dashboard.ejs for warehouse manager landing page
    - Create src/views/warehouse/checklist.ejs to display checklist items with input fields for actual quantity
    - Show status indicators (pending, arrived, partial, missing)
    - Create src/views/warehouse/no-checklist.ejs for dates with no expected deliveries
    - Create src/views/warehouse/history.ejs to show past checklists
    - Use EJS auto-escaping (<%=) for all dynamic content
    - _Requirements: 10.2, 18.1_

- [ ] 11. Scheduler Service implementation
  - [ ] 11.1 Implement nightly scheduler with node-cron
    - Create src/services/schedulerService.js
    - Implement scheduleNightlyJob() function accepting jobName, time (cron format), and handler function
    - Schedule inventory checklist generation job to run at 10 PM every day ('0 22 * * *')
    - Log job execution start, completion, and failures with timestamps
    - Implement error handling to catch and log job failures
    - Send alert notifications on job failures
    - _Requirements: 9.1, 16.4_
  
  - [ ] 11.2 Implement cancelJob() and getJobStatus() functions
    - Allow manual job cancellation
    - Track job status (success, failed, pending) with last run and next run timestamps
    - _Requirements: 9.1_
  
  - [ ]* 11.3 Write unit tests for Scheduler Service
    - Test job is scheduled with correct cron time
    - Test job executes handler function
    - Test job logs execution start and completion
    - Test job catches and logs errors

- [ ] 12. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Main application setup and routing
  - [ ] 13.1 Create main Express application entry point
    - Create src/app.js
    - Initialize Express application
    - Configure middleware (body-parser, cookie-parser, express-session)
    - Set up EJS as view engine
    - Configure static file serving for public assets
    - Load environment variables from .env file
    - _Requirements: 17.4_
  
  - [ ] 13.2 Mount all route modules
    - Mount auth routes at /
    - Mount employee routes at /employee
    - Mount manager routes at /manager
    - Mount warehouse routes at /warehouse
    - Implement root route / to redirect based on session role or show login
    - Implement 404 error handler
    - Implement global error handler for 500 errors
    - _Requirements: 3.7, 16.5_
  
  - [ ] 13.3 Configure security headers and cookies
    - Set Content-Security-Policy header
    - Configure session cookies with httpOnly, secure, sameSite: strict
    - Ensure all cookies only transmitted over HTTPS in production
    - _Requirements: 2.5, 2.6, 2.7, 17.1, 17.2, 17.3, 17.4_
  
  - [ ] 13.4 Initialize scheduler on application start
    - Import schedulerService and inventoryService
    - Schedule nightly checklist generation job
    - Log scheduler initialization
    - _Requirements: 9.1_

- [ ] 14. Input validation and error handling
  - [ ] 14.1 Implement input validation middleware
    - Create src/middleware/validation.js
    - Implement validators for common inputs:
      - Email format validation
      - Date range validation (startDate <= endDate)
      - Positive number validation for quantities and rates
      - UUID format validation for IDs
    - Return 400 Bad Request with descriptive error messages for invalid inputs
    - _Requirements: 18.2, 18.3, 18.4_
  
  - [ ] 14.2 Implement comprehensive error handling
    - Ensure all database errors are caught and logged with stack traces
    - Return user-friendly error messages without exposing internal details
    - Never log or expose plaintext passwords in error messages
    - Implement transaction rollback on all database errors
    - _Requirements: 16.1, 16.2, 16.5, 16.6_

- [ ] 15. SQL injection and XSS prevention
  - [ ] 15.1 Verify all database queries use parameterized statements
    - Audit all database queries across all services
    - Ensure no string concatenation of user input into SQL
    - Replace any unsafe queries with parameterized versions ($1, $2, etc.)
    - _Requirements: 17.5_
  
  - [ ] 15.2 Verify all EJS templates use auto-escaping
    - Audit all .ejs files for proper escaping
    - Ensure user-provided content uses <%= not <%-
    - Only use <%- for trusted admin content
    - _Requirements: 18.1_

- [ ] 16. Seed data and database initialization script
  - [ ] 16.1 Create database initialization script
    - Create scripts/init-db.js to run schema file against database
    - Create scripts/seed-data.js to populate test users, shifts, and products
    - Create at least 3 test users (one per role) with hashed passwords
    - Create sample shifts for next 30 days
    - Create sample products for inventory
    - Create sample expected_deliveries for testing nightly job
    - _Requirements: 1.4, 13.1, 13.2, 13.3_

- [ ] 17. Integration and final wiring
  - [ ] 17.1 Wire all components together
    - Ensure all routes are properly connected to services
    - Ensure all middleware is applied correctly
    - Verify authentication flow from login to dashboard
    - Verify role-based routing works for all three roles
    - Test session expiration and logout
    - _Requirements: 1.1, 1.2, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_
  
  - [ ]* 17.2 Write integration tests for complete workflows
    - Test end-to-end authentication flow (login → session → dashboard)
    - Test employee shift booking flow (login → view shifts → book → verify)
    - Test store manager wage dashboard flow (login → view wages → verify calculations)
    - Test warehouse manager checklist flow (login → view checklist → check items → verify completion)
    - Test role-based access control (employees cannot access manager routes, etc.)
    - _Requirements: 1.1, 1.2, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 5.1, 7.1, 10.1, 11.1_
  
  - [ ] 17.3 Create README and setup documentation
    - Document installation steps (npm install, database setup)
    - Document environment variables required (.env.example)
    - Document how to run the application (npm start, npm run dev)
    - Document test user credentials for each role
    - Document API endpoints and their purposes

- [ ] 18. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at major milestones
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples, edge cases, and error conditions
- Integration tests validate complete end-to-end workflows
- All code examples use JavaScript (not TypeScript) as specified by the user
- Use EJS templates for server-side rendering (already in use in the project)
- Use existing database connection pattern from the project (pg with pool)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4", "2.5"] },
    { "id": 3, "tasks": ["2.6", "2.7", "3.1"] },
    { "id": 4, "tasks": ["3.2", "3.3"] },
    { "id": 5, "tasks": ["4.1"] },
    { "id": 6, "tasks": ["4.2", "4.3", "4.4"] },
    { "id": 7, "tasks": ["4.5", "4.6", "5.1"] },
    { "id": 8, "tasks": ["5.2"] },
    { "id": 9, "tasks": ["7.1", "7.2", "7.3", "7.4"] },
    { "id": 10, "tasks": ["7.5", "7.6", "8.1"] },
    { "id": 11, "tasks": ["8.2"] },
    { "id": 12, "tasks": ["9.1", "9.2", "9.3", "9.4"] },
    { "id": 13, "tasks": ["9.5", "9.6", "10.1"] },
    { "id": 14, "tasks": ["10.2", "11.1", "11.2"] },
    { "id": 15, "tasks": ["11.3"] },
    { "id": 16, "tasks": ["13.1"] },
    { "id": 17, "tasks": ["13.2", "13.3", "13.4"] },
    { "id": 18, "tasks": ["14.1", "14.2"] },
    { "id": 19, "tasks": ["15.1", "15.2"] },
    { "id": 20, "tasks": ["16.1"] },
    { "id": 21, "tasks": ["17.1"] },
    { "id": 22, "tasks": ["17.2", "17.3"] }
  ]
}
```
