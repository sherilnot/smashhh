# Requirements Document

## Introduction

This feature adds weekly roster preparation, warehouse checklist upload, and timesheet submission capabilities to the Employee Management System. Shop managers prepare a Monday-starting weekly roster showing employees with booked shifts, upload warehouse checklist items to the warehouse manager, and submit end-of-week timesheets to a designated receiving manager. Each store operates with its own isolated set of employees.

## Glossary

- **Roster_Service**: The backend service responsible for generating, storing, and retrieving weekly rosters for a store.
- **Timesheet_Service**: The backend service responsible for creating, calculating, and submitting weekly timesheets.
- **Checklist_Upload_Service**: The backend service responsible for transmitting completed warehouse checklist items from a store manager to the warehouse manager.
- **Store_Manager**: A user with the `store_manager` role who is assigned to one or more stores via `store_manager_assignments`.
- **Warehouse_Manager**: The single user with the `warehouse_manager` role who receives uploaded checklist items.
- **Receiving_Manager**: A new role (name TBD) that receives submitted timesheets from store managers.
- **Weekly_Roster**: A read-only view of all employees who have confirmed shift bookings for a given Monday-to-Sunday week at a specific store.
- **Timesheet**: A summary document containing employee names, shift hours worked, and total hours for a specific store during a Monday-to-Sunday week.
- **Roster_Week**: A seven-day period starting on Monday (00:00:00) and ending on Sunday (23:59:59).
- **Checklist_Upload**: The action of sending completed checklist items from a store manager to the warehouse manager for review.

## Requirements

### Requirement 1: Weekly Roster Generation

**User Story:** As a store manager, I want to view a weekly roster for my store starting on Monday, so that I can see which employees have shifts booked for the week.

#### Acceptance Criteria

1. WHEN a Store_Manager requests a roster for a specific week by providing any date within that week, THE Roster_Service SHALL retrieve all confirmed shift bookings for the Roster_Week that contains the provided date at the manager's assigned store.
2. THE Roster_Service SHALL define a Roster_Week as starting on Monday at 00:00:00 and ending on Sunday at 23:59:59 in the store's local time.
3. WHEN generating a roster, THE Roster_Service SHALL include only employees who have at least one confirmed booking (booking_status = 'confirmed') during the Roster_Week.
4. THE Roster_Service SHALL group roster entries by employee, showing each employee's first name, last name, and their confirmed shift start time and end time for each booking during the week, ordered alphabetically by last name then first name, with shifts within each employee ordered chronologically by start time.
5. WHILE a Store_Manager is not assigned to a store, THE Roster_Service SHALL return an empty roster with an indication that no store assignment exists.
6. THE Roster_Service SHALL restrict roster visibility so that a Store_Manager can only view rosters for stores to which the manager is assigned.
7. IF a Store_Manager requests a roster for a valid Roster_Week and no confirmed bookings exist for that week at the assigned store, THEN THE Roster_Service SHALL return an empty roster with an indication that no shifts are scheduled for the requested week.
8. IF a Store_Manager provides an invalid or missing date when requesting a roster, THEN THE Roster_Service SHALL return an error indication that the requested week could not be determined.
9. THE Roster_Service SHALL return the roster response within 3 seconds for rosters containing up to 200 confirmed bookings.

### Requirement 2: Roster Employee Isolation

**User Story:** As a store manager, I want to see only employees who have booked shifts at my specific store, so that the roster accurately reflects my store's workforce.

#### Acceptance Criteria

1. WHEN a Store_Manager requests the roster, THE Roster_Service SHALL include only shift bookings where the shift's store_id matches one of the Store_Manager's assigned stores (via store_manager_assignments) and the booking_status is 'confirmed'.
2. WHEN a Store_Manager is assigned to multiple stores, THE Roster_Service SHALL include bookings from all of the manager's assigned stores and SHALL NOT include bookings from stores the manager is not assigned to.
3. WHEN a shift has a NULL store_id, THE Roster_Service SHALL exclude that shift's bookings from all store manager rosters.
4. IF the Store_Manager has no entries in store_manager_assignments, THEN THE Roster_Service SHALL return an empty roster with zero bookings.

### Requirement 3: Roster Display and Navigation

**User Story:** As a store manager, I want to navigate between weeks on the roster view, so that I can plan ahead or review past schedules.

#### Acceptance Criteria

1. THE Roster_Service SHALL default to displaying the current week's roster (the Roster_Week containing today's date).
2. WHEN a Store_Manager requests the previous week, THE Roster_Service SHALL display the roster for the Roster_Week immediately before the currently displayed week.
3. WHEN a Store_Manager requests the next week, THE Roster_Service SHALL display the roster for the Roster_Week immediately after the currently displayed week.
4. THE Roster_Service SHALL display the Roster_Week start date (Monday) and end date (Sunday) in ISO 8601 date format (YYYY-MM-DD) on the roster view.
5. IF the navigated Roster_Week contains no confirmed shift bookings for the Store_Manager's assigned store, THEN THE Roster_Service SHALL display an empty roster with a message indicating no shifts are booked for that week, while still showing the week's start and end dates and navigation controls.
6. THE Roster_Service SHALL allow navigation up to 12 weeks into the past and 12 weeks into the future from the current week, and SHALL disable the corresponding navigation control when the boundary is reached.

### Requirement 4: Warehouse Checklist Upload

**User Story:** As a store manager, I want to upload completed warehouse checklist items to the warehouse manager, so that the warehouse manager can review delivery discrepancies from my store.

#### Acceptance Criteria

1. WHEN a Store_Manager initiates a checklist upload, THE Checklist_Upload_Service SHALL retrieve all checklist items with a status of "arrived", "missing", or "partial" that are associated with the Store_Manager's assigned store and have not already been marked as transmitted.
2. WHEN the Checklist_Upload_Service has retrieved completed checklist items, THE Checklist_Upload_Service SHALL send the items to the single Warehouse_Manager in the system.
3. IF no Warehouse_Manager exists in the system, THEN THE Checklist_Upload_Service SHALL return an error indicating that no warehouse manager is available.
4. IF no non-transmitted checklist items with a status of "arrived", "missing", or "partial" exist for the Store_Manager's assigned store, THEN THE Checklist_Upload_Service SHALL return a response indicating that no items are available for upload.
5. WHEN a checklist upload succeeds, THE Checklist_Upload_Service SHALL record the upload timestamp and the identity of the Store_Manager who initiated the upload.
6. WHEN a checklist upload succeeds, THE Checklist_Upload_Service SHALL mark the uploaded items as transmitted so they are not included in subsequent uploads.
7. IF a checklist item has already been marked as transmitted, THEN THE Checklist_Upload_Service SHALL exclude that item from subsequent uploads.

### Requirement 5: Checklist Upload Validation

**User Story:** As a store manager, I want to be prevented from uploading incomplete checklists, so that only verified data reaches the warehouse manager.

#### Acceptance Criteria

1. IF a Store_Manager attempts to upload a checklist that contains one or more items with status 'pending', THEN THE Checklist_Upload_Service SHALL reject the upload, preserve the checklist in its current state without modification, and return an error indicating that all items must have a status of 'arrived', 'missing', or 'partial' before upload.
2. WHEN a Store_Manager submits a checklist where all items have a status of 'arrived', 'missing', or 'partial', THE Checklist_Upload_Service SHALL accept the upload within 3 seconds, mark the checklist as uploaded, and display a confirmation message to the Store_Manager indicating the checklist has been successfully submitted.
3. WHILE no checklist exists for the Store_Manager's assigned store on the current date, THE Checklist_Upload_Service SHALL display a message indicating that there are no items available for upload and SHALL NOT present an upload action.
4. IF the Checklist_Upload_Service encounters a failure during the upload operation after validation has passed, THEN THE Checklist_Upload_Service SHALL preserve the checklist data without modification and display an error indicating the upload was not completed and may be retried.

### Requirement 6: Timesheet Generation

**User Story:** As a store manager, I want to generate a weekly timesheet for my store's employees, so that I can summarize hours worked during the week.

#### Acceptance Criteria

1. WHEN a Store_Manager requests a timesheet for a specific Roster_Week, THE Timesheet_Service SHALL calculate total hours worked for each employee with completed bookings (booking_status = 'completed') at the manager's assigned store during that week.
2. THE Timesheet_Service SHALL compute hours worked as the difference between shift end_time and start_time for each completed booking, rounded to two decimal places.
3. THE Timesheet_Service SHALL group timesheet entries by employee, showing employee first name, last name, individual shift date and hours, and total weekly hours.
4. THE Timesheet_Service SHALL include only bookings from the Store_Manager's assigned store (enforcing store isolation).
5. IF no completed bookings exist for the requested week, THEN THE Timesheet_Service SHALL return an empty timesheet with a message indicating no completed shifts for the period.
6. IF a Store_Manager is not assigned to any store, THEN THE Timesheet_Service SHALL return an error indicating no store assignment exists.

### Requirement 7: Timesheet Submission

**User Story:** As a store manager, I want to submit the weekly timesheet to the receiving manager, so that payroll processing can proceed.

#### Acceptance Criteria

1. WHEN a Store_Manager submits a timesheet, THE Timesheet_Service SHALL send the timesheet data to the Receiving_Manager.
2. WHEN the Timesheet_Service successfully submits a timesheet, THE Timesheet_Service SHALL record the submission timestamp, the submitting Store_Manager's identity, and the receiving manager's identity.
3. IF no Receiving_Manager exists in the system, THEN THE Timesheet_Service SHALL return an error indicating that no receiving manager is available to accept the timesheet.
4. IF a timesheet for the same store and Roster_Week has already been submitted, THEN THE Timesheet_Service SHALL reject the duplicate submission with an error indicating the timesheet was already submitted.
5. IF a Store_Manager attempts to submit a timesheet for a future Roster_Week, THEN THE Timesheet_Service SHALL reject the submission with an error indicating that timesheets cannot be submitted for future weeks.
6. IF the timesheet contains no completed bookings (empty timesheet), THEN THE Timesheet_Service SHALL reject the submission with an error indicating that there are no hours to submit.
7. WHEN a timesheet is successfully submitted, THE Timesheet_Service SHALL display a confirmation to the Store_Manager indicating the timesheet was sent.

### Requirement 8: Receiving Manager Role

**User Story:** As an administrator, I want a dedicated receiving manager role to exist in the system, so that timesheets can be routed to the correct person.

#### Acceptance Criteria

1. THE system SHALL support a new user role named 'receiving_manager' in the users table role constraint.
2. THE system SHALL allow exactly one active Receiving_Manager at any time.
3. IF a user attempts to create or activate a second Receiving_Manager while one active Receiving_Manager already exists, THEN THE system SHALL reject the operation with an error indicating that only one active Receiving_Manager is permitted.
4. WHEN a Receiving_Manager logs in, THE system SHALL authenticate the Receiving_Manager using the existing session-based authentication mechanism.
5. THE system SHALL grant the Receiving_Manager access to view submitted timesheets from all stores.
6. IF a Receiving_Manager attempts to access store management, warehouse, or employee routes, THEN THE system SHALL deny access with a 403 Forbidden response.

### Requirement 9: Receiving Manager Timesheet View

**User Story:** As a receiving manager, I want to view submitted timesheets, so that I can review employee hours for payroll processing.

#### Acceptance Criteria

1. WHEN a Receiving_Manager views timesheets, THE Timesheet_Service SHALL list all submitted timesheets sorted by submission date (most recent first), displaying a maximum of 50 timesheets per page.
2. THE Timesheet_Service SHALL display for each submitted timesheet: the store name, Roster_Week start date (Monday) and end date (Sunday), total employee count, total hours (displayed to two decimal places), and submission timestamp.
3. WHEN a Receiving_Manager selects a specific timesheet, THE Timesheet_Service SHALL display each employee's full name, individual shift date and hours (displayed to two decimal places), and that employee's total weekly hours for the selected timesheet.
4. IF no submitted timesheets exist in the system, THEN THE Timesheet_Service SHALL display an empty list with a message indicating no timesheets have been submitted.
5. IF a Receiving_Manager attempts to view a timesheet that does not exist, THEN THE Timesheet_Service SHALL return an error indicating the requested timesheet was not found.
