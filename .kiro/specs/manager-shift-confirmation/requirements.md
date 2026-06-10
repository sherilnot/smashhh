# Requirements Document

## Introduction

This feature introduces a manager-mediated approval workflow for employee shift bookings, the ability for store managers to end (complete) shifts, the display of earned wages on dashboards after a shift is ended, and a new store-to-manager assignment mechanism so that booking requests are routed to the correct store manager.

Today, an employee booking is created directly with `confirmed` status (no approval step), shifts carry only a free-text `store_location` with no store entity or manager ownership, wages are calculated only for bookings already in `completed` status, and there is no in-application action to mark a shift as completed. This feature closes those gaps:

1. A **Store** entity is introduced and each store manager is assigned to one or more stores.
2. Each shift belongs to a store, so a new booking request routes to the manager(s) of that store.
3. Employee bookings enter a `pending` state and require manager confirmation before becoming `confirmed`.
4. A store manager can confirm or reject pending requests for shifts at stores they manage.
5. A store manager can end a confirmed, in-scope shift, transitioning the booking to `completed`.
6. After a shift is ended, the earned wages for that shift are calculated and displayed on the manager dashboard and the employee dashboard.

This document defines the business requirements only. Technical realization (schema migrations, new tables, service methods) is deferred to the design phase.

## Glossary

- **Booking_Service**: The component responsible for creating, listing, and changing the state of employee shift bookings.
- **Confirmation_Service**: The component responsible for processing manager decisions (confirm/reject) on pending booking requests.
- **Store_Assignment_Service**: The component responsible for creating stores and assigning store managers to stores.
- **Wage_Service**: The component responsible for calculating earned wages from completed shifts.
- **Dashboard**: The role-specific landing view rendered for an authenticated user (manager dashboard or employee dashboard).
- **Employee**: An authenticated user whose role is `employee`.
- **Store_Manager**: An authenticated user whose role is `store_manager`.
- **Store**: A physical retail location that owns shifts and is managed by one or more Store_Managers.
- **Shift**: A defined work period (start time, end time, capacity) that belongs to exactly one Store.
- **Booking**: A record linking one Employee to one Shift, with a lifecycle status.
- **Booking_Status**: The lifecycle state of a Booking, one of: `pending`, `confirmed`, `rejected`, `completed`, `cancelled`, `no_show`.
- **Pending_Request**: A Booking with Booking_Status `pending` awaiting a Store_Manager decision.
- **Managed_Store**: A Store to which a given Store_Manager is assigned.
- **In_Scope_Booking**: A Booking whose Shift belongs to a Managed_Store of the acting Store_Manager.
- **Earned_Wage**: The monetary amount for a completed Shift, computed as worked hours multiplied by the Employee's hourly wage.

## Requirements

### Requirement 1: Store Entity and Manager Assignment

**User Story:** As a system administrator, I want to define stores and assign store managers to them, so that booking requests route to the correct manager.

#### Acceptance Criteria

1. THE Store_Assignment_Service SHALL persist each Store with a unique store identifier and a store name.
2. WHEN a Store_Manager is assigned to a Store, THE Store_Assignment_Service SHALL persist the association between that Store_Manager and that Store.
3. THE Store_Assignment_Service SHALL allow one Store to have one or more assigned Store_Managers.
4. THE Store_Assignment_Service SHALL allow one Store_Manager to be assigned to one or more Stores.
5. IF an assignment request references a user whose role is not `store_manager`, THEN THE Store_Assignment_Service SHALL reject the assignment and return an error identifying the invalid role.
6. IF the role of the referenced user cannot be determined, THEN THE Store_Assignment_Service SHALL reject the assignment and return an error stating that the role could not be validated.
7. IF an assignment request references a Store identifier that does not exist, THEN THE Store_Assignment_Service SHALL reject the assignment and return an error identifying the missing Store.
8. WHEN the same Store_Manager and Store pair is assigned more than once, THE Store_Assignment_Service SHALL retain exactly one association for that pair.

### Requirement 2: Shift Ownership by Store

**User Story:** As a store manager, I want each shift to belong to a specific store, so that I only handle bookings for stores I manage.

#### Acceptance Criteria

1. THE Booking_Service SHALL associate each Shift with exactly one Store.
2. WHEN an Employee requests the list of available Shifts, THE Booking_Service SHALL include the owning Store identifier for each returned Shift.
3. IF a Shift is not associated with any Store, THEN THE Booking_Service SHALL exclude that Shift from manager confirmation queues and return that Shift only in administrative listings.

### Requirement 3: Booking Request Creation as Pending

**User Story:** As an employee, I want my shift booking to be submitted for manager approval, so that the store manager can confirm my attendance.

#### Acceptance Criteria

1. WHEN an Employee books an available Shift, THE Booking_Service SHALL create a Booking with Booking_Status `pending`.
2. WHEN a Booking is created with Booking_Status `pending`, THE Booking_Service SHALL route the Pending_Request to the Store_Manager(s) assigned to the owning Store of the Shift.
3. IF an Employee submits a booking for a Shift that already has a `pending` or `confirmed` Booking for that same Employee, THEN THE Booking_Service SHALL reject the new booking and return an error stating that a booking already exists.
4. IF an Employee submits a booking for a Shift whose start time is in the past or equal to the current time, THEN THE Booking_Service SHALL reject the booking and return an error stating that past or current shifts cannot be booked.
5. WHEN counting a Shift's occupied capacity, THE Booking_Service SHALL count Bookings with Booking_Status `pending` and Bookings with Booking_Status `confirmed`.
6. IF an Employee submits a booking for a Shift whose occupied capacity equals the Shift capacity, THEN THE Booking_Service SHALL reject the booking and return an error stating that the Shift is at full capacity.

### Requirement 4: Manager Views Pending Requests

**User Story:** As a store manager, I want to see the pending booking requests for my stores, so that I can decide whether to confirm them.

#### Acceptance Criteria

1. WHEN a Store_Manager requests the list of Pending_Requests, THE Confirmation_Service SHALL return only Pending_Requests that are In_Scope_Bookings for that Store_Manager.
2. THE Confirmation_Service SHALL include, for each returned Pending_Request, the Employee name, the Shift start time, the Shift end time, and the owning Store identifier.
3. WHILE a Store_Manager has no Managed_Store, THE Confirmation_Service SHALL return an empty list of Pending_Requests and an indication that no Store is assigned.
4. IF a Store_Manager loses a Managed_Store assignment during an active session, THEN THE Confirmation_Service SHALL continue to return the previously retrieved Pending_Requests until the Store_Manager issues a new request.

### Requirement 5: Manager Confirms a Booking

**User Story:** As a store manager, I want to confirm a pending booking, so that the employee is scheduled for the shift.

#### Acceptance Criteria

1. WHEN a Store_Manager confirms a Pending_Request that is an In_Scope_Booking, THE Confirmation_Service SHALL set the Booking_Status to `confirmed`.
2. WHEN a Booking is set to `confirmed`, THE Confirmation_Service SHALL record the confirming Store_Manager identifier and the confirmation timestamp.
3. IF a Store_Manager attempts to confirm a Booking that is not an In_Scope_Booking, THEN THE Confirmation_Service SHALL reject the action and return a `403` authorization error.
4. IF a Store_Manager attempts to confirm a Booking whose Booking_Status is not `pending`, THEN THE Confirmation_Service SHALL reject the action and return an error stating that only pending bookings can be confirmed.
5. IF confirming a Pending_Request would cause the number of `confirmed` Bookings to exceed the Shift capacity, THEN THE Confirmation_Service SHALL reject the confirmation and return an error stating that the Shift is at full capacity.

### Requirement 6: Manager Rejects a Booking

**User Story:** As a store manager, I want to reject a pending booking, so that the slot is freed when I cannot approve the request.

#### Acceptance Criteria

1. WHEN a Store_Manager rejects a Pending_Request that is an In_Scope_Booking, THE Confirmation_Service SHALL set the Booking_Status to `rejected`.
2. WHEN a Booking is set to `rejected`, THE Confirmation_Service SHALL record the deciding Store_Manager identifier and the decision timestamp.
3. IF a Store_Manager attempts to reject a Booking that is not an In_Scope_Booking, THEN THE Confirmation_Service SHALL reject the action and return a `403` authorization error.
4. IF a Store_Manager attempts to reject a Booking whose Booking_Status is not `pending`, THEN THE Confirmation_Service SHALL reject the action and return an error stating that only pending bookings can be rejected.
5. WHEN a Booking transitions to `rejected`, THE Booking_Service SHALL decrease the Shift's occupied capacity count by exactly one.

### Requirement 7: Manager Ends a Shift

**User Story:** As a store manager, I want to end a shift, so that worked hours are recorded and wages can be paid.

#### Acceptance Criteria

1. WHEN a Store_Manager ends a Shift for an In_Scope_Booking whose Booking_Status is `confirmed`, THE Booking_Service SHALL set that Booking's Booking_Status to `completed`.
2. WHEN a Booking is set to `completed`, THE Booking_Service SHALL record the ending Store_Manager identifier and the completion timestamp.
3. IF a Store_Manager attempts to end a Shift for a Booking that is not an In_Scope_Booking, THEN THE Booking_Service SHALL reject the action and return a `403` authorization error.
4. IF a Store_Manager attempts to end a Shift for a Booking whose Booking_Status is not `confirmed`, THEN THE Booking_Service SHALL reject the action and return an error stating that only confirmed bookings can be ended.
5. IF a Store_Manager attempts to end a Shift whose start time is in the future, THEN THE Booking_Service SHALL reject the action and return an error stating that a shift cannot be ended before it begins.

### Requirement 8: Wage Calculation on Shift End

**User Story:** As an employee, I want my wage to be calculated when my shift ends, so that I am paid accurately for the time I worked.

#### Acceptance Criteria

1. WHEN a Booking transitions to `completed`, THE Wage_Service SHALL automatically compute the Earned_Wage as worked hours multiplied by the Employee's hourly wage without requiring a separate trigger.
2. THE Wage_Service SHALL compute worked hours as the difference between the Shift end time and the Shift start time expressed in hours.
3. THE Wage_Service SHALL round the Earned_Wage to two decimal places.
4. THE Wage_Service SHALL include in wage results only Bookings whose Booking_Status is `completed`.
5. IF the Employee's hourly wage is not a positive number, THEN THE Wage_Service SHALL exclude that Booking from wage results and return an error identifying the affected Employee.

### Requirement 9: Wage Display on Manager Dashboard

**User Story:** As a store manager, I want to see the wages from ended shifts on my dashboard, so that I can monitor labor costs for my stores.

#### Acceptance Criteria

1. WHEN a Store_Manager opens the Dashboard, THE Dashboard SHALL display the Earned_Wage for each `completed` In_Scope_Booking, including entries whose Earned_Wage equals zero.
2. THE Dashboard SHALL display, for each listed wage entry, the Employee name, the Shift date, the worked hours, and the Earned_Wage amount.
3. THE Dashboard SHALL display the total Earned_Wage summed across all listed wage entries.
4. WHILE a Store_Manager has no `completed` In_Scope_Bookings, THE Dashboard SHALL display a message stating that no wage entries are available.

### Requirement 10: Wage Display on Employee Dashboard

**User Story:** As an employee, I want to see the wages from my ended shifts on my dashboard, so that I know how much I have earned.

#### Acceptance Criteria

1. WHEN an Employee opens the Dashboard, THE Dashboard SHALL display the Earned_Wage for each of that Employee's `completed` Bookings.
2. THE Dashboard SHALL display, for each listed wage entry, the Shift date, the worked hours, and the Earned_Wage amount.
3. THE Dashboard SHALL display the total Earned_Wage summed across that Employee's listed wage entries.
4. WHILE an Employee has no `completed` Bookings, THE Dashboard SHALL display a message stating that no wage entries are available.

### Requirement 11: Employee Visibility of Booking Status

**User Story:** As an employee, I want to see the status of my booking requests, so that I know whether my shift has been confirmed.

#### Acceptance Criteria

1. WHEN an Employee requests the list of their Bookings, THE Booking_Service SHALL include the Booking_Status for each Booking.
2. THE Booking_Service SHALL return Bookings with Booking_Status `pending`, `confirmed`, `rejected`, `completed`, `cancelled`, and `no_show` for the requesting Employee.
3. IF the Booking_Status for a Booking is temporarily unavailable, THEN THE Booking_Service SHALL return the Booking without its Booking_Status rather than omitting the Booking from the list.

### Requirement 12: Authorization for Manager Actions

**User Story:** As a system owner, I want manager actions restricted to assigned stores, so that managers cannot affect bookings outside their responsibility.

#### Acceptance Criteria

1. IF a user whose role is not `store_manager` requests a Confirmation_Service action, THEN THE Confirmation_Service SHALL deny the request with a `403` authorization error.
2. IF a Store_Manager requests an action on a Booking that is not an In_Scope_Booking, THEN THE Confirmation_Service SHALL deny the request with a `403` authorization error.
3. IF an unauthenticated request invokes any Booking_Service, Confirmation_Service, or Store_Assignment_Service action, THEN THE system SHALL redirect the request to the login page.
