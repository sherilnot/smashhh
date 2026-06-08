# Requirements Document

## Introduction

The Employee Management System is a web-based application for managing retail store operations with three distinct user roles. The system provides role-based authentication to route users to appropriate dashboards: employees can book shifts, store managers can view wage calculation reports, and warehouse managers can verify daily inventory checklists. The system integrates with existing retail infrastructure and includes automated nightly job scheduling for inventory checklist generation.

## Glossary

- **Employee**: A user with the 'employee' role who can view and book available work shifts
- **Store_Manager**: A user with the 'store_manager' role who can view wage calculations for all employees
- **Warehouse_Manager**: A user with the 'warehouse_manager' role who can view and verify daily inventory checklists
- **System**: The Employee Management System including web application, database, and scheduled services
- **Authentication_Service**: Component responsible for validating credentials and managing sessions
- **Shift_Booking_Service**: Component responsible for managing shift availability and employee bookings
- **Wage_Calculation_Service**: Component responsible for calculating employee wages from completed shifts
- **Inventory_Check_Service**: Component responsible for generating and managing daily inventory checklists
- **Scheduler_Service**: Component responsible for executing scheduled jobs including nightly checklist generation
- **Session**: A time-limited authentication token that expires 8 hours after creation
- **Shift**: A work period with defined start time, end time, store location, and employee capacity
- **Booking**: A record associating an employee with a specific shift
- **Checklist**: A daily list of expected inventory deliveries assigned to a warehouse manager
- **Checklist_Item**: An individual product entry in a checklist with expected and actual quantities

## Requirements

### Requirement 1: User Authentication

**User Story:** As a user, I want to log in with my credentials, so that I can access my role-specific dashboard.

#### Acceptance Criteria

1. WHEN a user submits valid credentials, THE Authentication_Service SHALL create a session token and route the user to their role-specific dashboard
2. WHEN a user submits an invalid user ID or password, THE Authentication_Service SHALL reject the authentication and return an error message
3. WHEN an inactive user attempts to authenticate, THE Authentication_Service SHALL reject the authentication
4. THE Authentication_Service SHALL hash all passwords using bcrypt before storage
5. WHEN comparing passwords during authentication, THE Authentication_Service SHALL use bcrypt comparison functions
6. THE Authentication_Service SHALL generate cryptographically secure session tokens using a minimum of 32 random bytes
7. WHEN a session is created, THE System SHALL set the expiration time to 8 hours from creation time

### Requirement 2: Session Management

**User Story:** As a user, I want my session to remain valid during my work period, so that I don't need to repeatedly log in.

#### Acceptance Criteria

1. WHEN a session token is valid and not expired, THE Authentication_Service SHALL return the associated user data
2. WHEN a session token has expired, THE Authentication_Service SHALL reject the session and return null
3. WHEN a session is marked as inactive, THE Authentication_Service SHALL reject the session and return null
4. WHEN a user logs out, THE System SHALL mark the session as inactive
5. THE System SHALL store session tokens in HTTP-only cookies to prevent XSS attacks
6. THE System SHALL transmit session cookies only over HTTPS connections
7. THE System SHALL set the SameSite attribute to Strict for session cookies to prevent CSRF attacks

### Requirement 3: Role-Based Access Control

**User Story:** As a system administrator, I want users to access only their authorized dashboards, so that data privacy and security are maintained.

#### Acceptance Criteria

1. WHEN an Employee attempts to access employee routes, THE System SHALL grant access
2. WHEN an Employee attempts to access store manager or warehouse manager routes, THE System SHALL deny access and return a 403 Forbidden status
3. WHEN a Store_Manager attempts to access store manager routes, THE System SHALL grant access
4. WHEN a Store_Manager attempts to access employee or warehouse manager routes, THE System SHALL deny access and return a 403 Forbidden status
5. WHEN a Warehouse_Manager attempts to access warehouse manager routes, THE System SHALL grant access
6. WHEN a Warehouse_Manager attempts to access employee or store manager routes, THE System SHALL deny access and return a 403 Forbidden status
7. WHEN an unauthenticated user attempts to access any protected route, THE System SHALL redirect to the login page

### Requirement 4: Shift Availability Display

**User Story:** As an employee, I want to view available shifts, so that I can choose shifts that fit my schedule.

#### Acceptance Criteria

1. WHEN an employee requests available shifts for a date range, THE Shift_Booking_Service SHALL return all future shifts within that range
2. THE Shift_Booking_Service SHALL include only shifts where current bookings are less than capacity
3. THE Shift_Booking_Service SHALL return shifts sorted by start time in ascending order
4. WHEN displaying a shift, THE System SHALL show the start time, end time, store location, capacity, and current booking count
5. THE Shift_Booking_Service SHALL calculate current bookings by counting confirmed bookings for each shift

### Requirement 5: Shift Booking

**User Story:** As an employee, I want to book available shifts, so that I can secure my work schedule.

#### Acceptance Criteria

1. WHEN an employee books an available shift, THE Shift_Booking_Service SHALL create a booking record with status 'confirmed'
2. WHEN an employee attempts to book a shift at full capacity, THE Shift_Booking_Service SHALL reject the booking and return an error
3. WHEN an employee attempts to book a shift they have already booked, THE Shift_Booking_Service SHALL reject the duplicate booking and return an error
4. WHEN an employee attempts to book a past or current shift, THE Shift_Booking_Service SHALL reject the booking and return an error
5. THE Shift_Booking_Service SHALL use database transactions with row locking to prevent race conditions during capacity checks
6. WHEN a booking transaction fails, THE Shift_Booking_Service SHALL roll back all database changes
7. THE Shift_Booking_Service SHALL verify that the user has the employee role before allowing booking

### Requirement 6: Shift Cancellation

**User Story:** As an employee, I want to cancel my booked shifts, so that I can adjust my schedule when needed.

#### Acceptance Criteria

1. WHEN an employee cancels a confirmed booking, THE Shift_Booking_Service SHALL update the booking status to 'cancelled'
2. WHEN a booking is cancelled, THE System SHALL record the cancellation timestamp
3. WHEN a shift is cancelled, THE Shift_Booking_Service SHALL make the shift available again for other employees
4. WHEN an employee attempts to cancel a shift they have not booked, THE Shift_Booking_Service SHALL reject the request and return an error

### Requirement 7: Wage Calculation

**User Story:** As a store manager, I want to view wage calculations for all employees, so that I can manage payroll and labor costs.

#### Acceptance Criteria

1. WHEN a store manager requests wage calculations for a date range, THE Wage_Calculation_Service SHALL return a report for each employee with completed shifts in that range
2. THE Wage_Calculation_Service SHALL calculate hours worked as the difference between shift end time and start time divided by 3600000 milliseconds
3. THE Wage_Calculation_Service SHALL calculate wages for each shift as hours worked multiplied by the employee's hourly rate
4. THE Wage_Calculation_Service SHALL aggregate total hours by summing hours worked across all shifts for each employee
5. THE Wage_Calculation_Service SHALL aggregate total wages by summing individual shift wages for each employee
6. THE Wage_Calculation_Service SHALL round all hour values to 2 decimal places
7. THE Wage_Calculation_Service SHALL round all wage values to 2 decimal places
8. THE Wage_Calculation_Service SHALL include only shifts with booking status 'completed'
9. THE Wage_Calculation_Service SHALL include detailed shift breakdowns showing date, hours, and wages for each shift

### Requirement 8: Hourly Rate Management

**User Story:** As a store manager, I want to update employee hourly rates, so that wages are calculated with current pay rates.

#### Acceptance Criteria

1. WHEN a store manager updates an employee's hourly rate, THE Wage_Calculation_Service SHALL store the new rate in the database
2. THE Wage_Calculation_Service SHALL validate that hourly rates are positive numbers
3. WHEN calculating wages, THE System SHALL use the hourly rate stored for each employee at the time of calculation

### Requirement 9: Nightly Checklist Generation

**User Story:** As a warehouse manager, I want inventory checklists automatically generated each night, so that I can verify deliveries each morning.

#### Acceptance Criteria

1. THE Scheduler_Service SHALL execute the checklist generation job at 10 PM every day
2. WHEN the nightly job runs, THE Inventory_Check_Service SHALL generate one checklist for each active warehouse manager for the next day
3. THE Inventory_Check_Service SHALL query expected deliveries for the next day from the expected deliveries table
4. THE Inventory_Check_Service SHALL group expected deliveries by warehouse manager
5. WHEN a warehouse manager has expected deliveries, THE Inventory_Check_Service SHALL create a checklist with status 'pending'
6. THE Inventory_Check_Service SHALL create checklist items for each expected delivery with status 'pending'
7. WHEN a checklist is generated, THE System SHALL send a notification to the warehouse manager's email address
8. THE Inventory_Check_Service SHALL use database transactions to ensure all checklists are created atomically
9. WHEN the nightly job fails, THE Scheduler_Service SHALL log the error and send an alert to system administrators

### Requirement 10: Checklist Retrieval

**User Story:** As a warehouse manager, I want to view my daily checklist, so that I can verify incoming inventory.

#### Acceptance Criteria

1. WHEN a warehouse manager requests their checklist for a specific date, THE Inventory_Check_Service SHALL return the checklist for that date and manager
2. THE System SHALL display each checklist item with product name, expected quantity, actual quantity, and status
3. WHEN no checklist exists for the requested date, THE System SHALL inform the warehouse manager that no deliveries are expected
4. THE Inventory_Check_Service SHALL return only checklists belonging to the requesting warehouse manager

### Requirement 11: Inventory Verification

**User Story:** As a warehouse manager, I want to mark inventory items as checked, so that I can track delivery accuracy.

#### Acceptance Criteria

1. WHEN a warehouse manager marks an item with actual quantity equal to expected quantity, THE Inventory_Check_Service SHALL set the item status to 'arrived'
2. WHEN a warehouse manager marks an item with actual quantity between zero and expected quantity (exclusive), THE Inventory_Check_Service SHALL set the item status to 'partial'
3. WHEN a warehouse manager marks an item with actual quantity of zero, THE Inventory_Check_Service SHALL set the item status to 'missing'
4. WHEN a checklist item is marked as checked, THE System SHALL record the current timestamp in the checked_at field
5. THE Inventory_Check_Service SHALL validate that the actual quantity matches the status before updating
6. WHEN validation fails, THE Inventory_Check_Service SHALL reject the update and return an error
7. THE Inventory_Check_Service SHALL use database transactions to ensure consistency when updating items

### Requirement 12: Checklist Completion

**User Story:** As a warehouse manager, I want my checklist to automatically complete when all items are verified, so that I know my work is done.

#### Acceptance Criteria

1. WHEN all checklist items have a status other than 'pending', THE Inventory_Check_Service SHALL update the checklist status to 'completed'
2. WHEN a checklist is completed, THE System SHALL record the completion timestamp
3. WHEN at least one checklist item has status 'pending' and at least one has another status, THE Inventory_Check_Service SHALL update the checklist status to 'in_progress'
4. WHEN all items remain 'pending', THE checklist status SHALL remain 'pending'

### Requirement 13: Data Validation

**User Story:** As a system administrator, I want all data to be validated before storage, so that database integrity is maintained.

#### Acceptance Criteria

1. WHEN creating a user, THE System SHALL validate that the user_id is non-empty and unique
2. WHEN creating a user, THE System SHALL validate that the email is in valid email format and unique
3. WHEN creating a user with employee role, THE System SHALL validate that hourly_wage is a positive number
4. WHEN creating a shift, THE System SHALL validate that end_time is after start_time
5. WHEN creating a shift, THE System SHALL validate that capacity is a positive integer
6. WHEN creating a shift, THE System SHALL validate that start_time is in the future
7. WHEN creating a booking, THE System SHALL validate that the shift_id references an existing shift
8. WHEN creating a booking, THE System SHALL validate that the employee_id references a user with employee role
9. WHEN creating a checklist, THE System SHALL validate that check_date is not in the past
10. WHEN creating a checklist item, THE System SHALL validate that expected_quantity is a positive integer
11. WHEN updating a checklist item, THE System SHALL validate that actual_quantity is a non-negative integer

### Requirement 14: Database Indexing

**User Story:** As a system administrator, I want database queries to execute quickly, so that users experience responsive performance.

#### Acceptance Criteria

1. THE System SHALL create an index on users.user_id for authentication lookups
2. THE System SHALL create an index on users.role for role-based queries
3. THE System SHALL create an index on sessions.session_token for session verification
4. THE System SHALL create a composite index on shifts (start_time, end_time) for availability queries
5. THE System SHALL create an index on shift_bookings.shift_id for capacity checks
6. THE System SHALL create an index on shift_bookings.employee_id for employee shift queries
7. THE System SHALL create a composite index on inventory_checklists (check_date, warehouse_manager_id) for daily checklist retrieval

### Requirement 15: Concurrent Booking Safety

**User Story:** As a system administrator, I want the system to handle concurrent bookings correctly, so that shift capacity is never exceeded.

#### Acceptance Criteria

1. WHEN multiple employees attempt to book the same shift concurrently, THE Shift_Booking_Service SHALL use SELECT FOR UPDATE to lock the shift record
2. THE Shift_Booking_Service SHALL verify capacity within the transaction before creating each booking
3. WHEN capacity is reached, THE System SHALL reject all subsequent booking attempts for that shift
4. THE System SHALL ensure that the count of confirmed bookings never exceeds shift capacity

### Requirement 16: Error Handling and Logging

**User Story:** As a system administrator, I want errors to be logged and handled gracefully, so that I can monitor system health and troubleshoot issues.

#### Acceptance Criteria

1. WHEN a database error occurs, THE System SHALL log the error with timestamp and stack trace
2. WHEN a database transaction fails, THE System SHALL roll back all changes
3. WHEN an authentication failure occurs, THE System SHALL log the attempt with user_id and timestamp
4. WHEN the nightly job fails, THE System SHALL log the error and send an alert email
5. WHEN an API error occurs, THE System SHALL return a user-friendly error message without exposing internal details
6. THE System SHALL never log or expose plaintext passwords in any error messages or logs

### Requirement 17: Security Headers and Cookies

**User Story:** As a system administrator, I want security best practices enforced, so that the application is protected against common web vulnerabilities.

#### Acceptance Criteria

1. THE System SHALL set the HttpOnly flag on session cookies to prevent JavaScript access
2. THE System SHALL set the Secure flag on session cookies to ensure HTTPS-only transmission
3. THE System SHALL set the SameSite attribute to Strict on session cookies
4. THE System SHALL configure Content-Security-Policy headers to prevent XSS attacks
5. THE System SHALL use parameterized SQL queries for all database operations to prevent SQL injection

### Requirement 18: Input Sanitization

**User Story:** As a system administrator, I want user input sanitized before display, so that XSS attacks are prevented.

#### Acceptance Criteria

1. WHEN rendering user-provided content in EJS templates, THE System SHALL use auto-escaping (<%=)
2. THE System SHALL validate all API inputs against expected types and formats
3. WHEN email addresses are provided, THE System SHALL validate format using appropriate validation rules
4. WHEN date ranges are provided, THE System SHALL validate that start date is before or equal to end date

### Requirement 19: Performance Requirements

**User Story:** As a user, I want the system to respond quickly, so that I can complete my tasks efficiently.

#### Acceptance Criteria

1. WHEN authenticating a user, THE System SHALL respond within 100 milliseconds under normal load
2. WHEN querying available shifts, THE System SHALL respond within 200 milliseconds under normal load
3. WHEN calculating wages for a monthly period, THE System SHALL respond within 500 milliseconds under normal load
4. WHEN retrieving a daily checklist, THE System SHALL respond within 150 milliseconds under normal load
5. THE System SHALL use database connection pooling with minimum 5 and maximum 20 connections

### Requirement 20: Data Integrity Constraints

**User Story:** As a system administrator, I want referential integrity enforced, so that orphaned records cannot exist.

#### Acceptance Criteria

1. THE System SHALL enforce that shift_bookings.shift_id references a valid shift record
2. THE System SHALL enforce that shift_bookings.employee_id references a valid user record
3. THE System SHALL enforce that checklist_items.checklist_id references a valid checklist record
4. THE System SHALL enforce that checklist_items.product_id references a valid product record
5. WHEN a shift is deleted, THE System SHALL cascade delete all associated bookings
6. WHEN a checklist is deleted, THE System SHALL cascade delete all associated checklist items
7. THE System SHALL enforce a unique constraint on (shift_id, employee_id, booking_status) where booking_status is 'confirmed'
8. THE System SHALL enforce a unique constraint on (check_date, warehouse_manager_id) for inventory checklists
