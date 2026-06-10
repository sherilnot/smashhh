# Implementation Plan: Manager Shift Confirmation

## Overview

This plan implements a manager-mediated approval workflow on top of the existing
Express + EJS + PostgreSQL app. Work proceeds from the database schema outward:
first the migration and the `Store_Assignment_Service`, then the extended
`Booking_Service` (pending creation, capacity, end-shift, status-inclusive
listings), the new `Confirmation_Service` (pending queue, confirm/reject), the
extended `Wage_Service` (earned-wage arithmetic and dashboard scoping), and
finally the routes and EJS views that wire everything to the UI.

Business logic is factored into pure helpers (`occupiedCount`,
`validateBookingRequest`, `validateEndShift`, `authorizeManagerAction`,
`validateDecision`, `validateAssignment`, `workedHours`, `earnedWage`,
`totalWage`) so the 22 correctness properties can be exercised with `fast-check`
(at least 100 iterations each) without a live database. Tests follow the existing
`*.test.js` co-located convention and mock `../config/database`.

## Tasks

- [x] 1. Database migration and schema foundation
  - [x] 1.1 Create the schema migration script
    - Create `scripts/migrate-shift-confirmation.js` following the `scripts/init-db.js` style with `IF NOT EXISTS` guards for idempotency
    - Create `stores` table (id, name, created_at)
    - Create `store_manager_assignments` join table with `UNIQUE (store_id, manager_id)` plus manager/store indexes
    - Add nullable `shifts.store_id` FK + `idx_shifts_store`
    - Expand the `shift_bookings.booking_status` CHECK to include `pending` and `rejected`; add `decided_by_manager_id`, `decided_at`, `completed_by_manager_id`, `completed_at`; replace `idx_unique_confirmed_booking` with `idx_unique_active_booking` over `pending`+`confirmed`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.8, 2.1, 2.3, 3.1, 3.3, 5.2, 6.2, 7.2_
  - [ ]* 1.2 Write migration smoke integration test
    - Apply the migration against a test database and assert the new tables/columns/constraints exist and the expanded CHECK accepts `pending`/`rejected`
    - _Requirements: 1.1, 2.1_

- [x] 2. Implement Store_Assignment_Service
  - [x] 2.1 Implement store creation, assignment, and scope helpers
    - Create `src/services/storeAssignmentService.js` with pure `validateAssignment({ targetRole, storeExists })`
    - Implement `createStore`, `assignManagerToStore` (resolves role, checks store, `INSERT ... ON CONFLICT DO NOTHING`), `getManagedStores`, `managerOwnsBooking` using parameterized queries on the shared pool
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_
  - [ ]* 2.2 Write property test for idempotent assignment
    - **Property 21: Store-manager assignment is idempotent**
    - **Validates: Requirements 1.8**
  - [ ]* 2.3 Write property test for invalid-role assignment rejection
    - **Property 22: Assignment is rejected for non-store_manager targets**
    - **Validates: Requirements 1.5, 1.6**
  - [ ]* 2.4 Write unit tests for store CRUD and missing-store handling
    - Assert parameterized SQL and returned shapes for create/assign (1.1–1.4); edge case for missing store id (1.7)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.7_

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Extend Booking_Service (shiftService.js)
  - [x] 4.1 Implement capacity helpers and pending booking creation
    - Add pure `occupiedCount(bookings)`, `validateBookingRequest({...})`, `validateEndShift({...})` to `src/services/shiftService.js`
    - Modify `bookShift` to create the booking as `pending` inside the existing `FOR UPDATE` transaction and return `routedManagerIds` (managers of the shift's owning store)
    - Modify `getAvailableShifts` to include the owning `store_id` per shift
    - _Requirements: 2.2, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [x] 4.2 Implement status-inclusive listing and end-shift
    - Modify `getEmployeeShifts` to return every booking with its `bookingStatus` (mapping a temporarily unavailable status to `null` rather than omitting the booking)
    - Implement `endShift(managerId, bookingId)` that authorizes scope, applies `validateEndShift`, sets status to `completed`, and records `completed_by_manager_id`/`completed_at`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 11.1, 11.2, 11.3_
  - [ ]* 4.3 Write property test for pending creation
    - **Property 1: New bookings are created as pending**
    - **Validates: Requirements 3.1**
  - [ ]* 4.4 Write property test for duplicate active bookings
    - **Property 3: Duplicate active bookings are rejected without state change**
    - **Validates: Requirements 3.3**
  - [ ]* 4.5 Write property test for past/current shift rejection
    - **Property 4: Past or current shifts cannot be booked**
    - **Validates: Requirements 3.4**
  - [ ]* 4.6 Write property test for occupied-capacity rule
    - **Property 5: Occupied capacity counts pending and confirmed, and full shifts reject**
    - **Validates: Requirements 3.5, 3.6**
  - [ ]* 4.7 Write property test for slot freeing on rejection
    - **Property 13: Rejecting a pending booking frees exactly one capacity slot**
    - **Validates: Requirements 6.5**
  - [ ]* 4.8 Write property test for end-shift guard
    - **Property 14: Ending a shift requires a confirmed, already-started booking**
    - **Validates: Requirements 7.1, 7.4, 7.5**
  - [ ]* 4.9 Write property test for status-preserving listings
    - **Property 20: Booking listings preserve status for every booking and every status**
    - **Validates: Requirements 11.1, 11.2**
  - [ ]* 4.10 Write property test for available-shift store id
    - **Property 6: Available shifts expose their owning store id**
    - **Validates: Requirements 2.2**
  - [ ]* 4.11 Write property test for pending-request routing
    - **Property 2: Pending requests route to exactly the owning store's managers**
    - **Validates: Requirements 3.2**
  - [ ]* 4.12 Write unit tests for status-unavailable and completion audit
    - Edge case mapping missing status to `null` (11.3); assert `completed_by_manager_id`/`completed_at` written on end (7.2)
    - _Requirements: 7.2, 11.3_

- [x] 5. Implement Confirmation_Service
  - [x] 5.1 Implement pending queue and confirm/reject decisions
    - Create `src/services/confirmationService.js` with pure `authorizeManagerAction({ role, isInScope })` and `validateDecision({ action, status, confirmedCount, capacity })`
    - Implement `getPendingRequests` (in-scope `pending` only, excluding storeless shifts, with employee name + start/end + store id, and `hasManagedStore` flag)
    - Implement `confirmBooking` and `rejectBooking` with `FOR UPDATE` capacity locking, recording `decided_by_manager_id`/`decided_at`
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.3, 5.4, 5.5, 6.1, 6.3, 6.4, 12.1, 12.2_
  - [ ]* 5.2 Write property test for manager-action authorization
    - **Property 9: Manager actions are authorized only for store_manager role and in-scope bookings**
    - **Validates: Requirements 5.3, 6.3, 7.3, 12.1, 12.2**
  - [ ]* 5.3 Write property test for pending-only decisions
    - **Property 10: Only pending bookings can be confirmed or rejected**
    - **Validates: Requirements 5.4, 6.4**
  - [ ]* 5.4 Write property test for confirm capacity ceiling
    - **Property 11: Confirming cannot exceed shift capacity**
    - **Validates: Requirements 5.5**
  - [ ]* 5.5 Write property test for confirm/reject transitions
    - **Property 12: Confirm and reject perform their state transition**
    - **Validates: Requirements 5.1, 6.1**
  - [ ]* 5.6 Write property test for storeless-shift exclusion
    - **Property 7: Storeless shifts are excluded from confirmation queues**
    - **Validates: Requirements 2.3**
  - [ ]* 5.7 Write property test for in-scope pending queue contents
    - **Property 8: The pending queue returns exactly the in-scope pending bookings, with required fields**
    - **Validates: Requirements 4.1, 4.2**
  - [ ]* 5.8 Write unit tests for decision audit and empty-state messaging
    - Assert `decided_by_manager_id`/`decided_at` recorded on confirm/reject (5.2, 6.2); no-managed-store empty list + indication (4.3)
    - _Requirements: 4.3, 5.2, 6.2_

- [x] 6. Extend Wage_Service (wageService.js)
  - [x] 6.1 Implement wage arithmetic and dashboard scoping
    - Add pure `workedHours(startTime, endTime)`, `earnedWage(startTime, endTime, hourlyWage)` (rounds to 2 dp, returns `{ ok:false }` for non-positive wage), and `totalWage(entries)` to `src/services/wageService.js`
    - Implement `getManagerWageEntries(managerId)` (in-scope `completed` bookings) and `getEmployeeWageEntries(employeeId)`, including zero-wage entries and excluding non-positive-wage bookings with an identifying error
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3, 10.1, 10.2, 10.3_
  - [ ]* 6.2 Write property test for earned-wage formula
    - **Property 15: Earned wage equals rounded hours times hourly wage**
    - **Validates: Requirements 8.1, 8.2, 8.3**
  - [ ]* 6.3 Write property test for completed-only inclusion
    - **Property 16: Only completed bookings contribute to wage results**
    - **Validates: Requirements 8.4**
  - [ ]* 6.4 Write property test for non-positive wage exclusion
    - **Property 17: Non-positive hourly wage is excluded and reported**
    - **Validates: Requirements 8.5**
  - [ ]* 6.5 Write property test for full wage listing fields
    - **Property 18: Wage entries are listed in full (including zero) with required fields**
    - **Validates: Requirements 9.1, 9.2, 10.1, 10.2**
  - [ ]* 6.6 Write property test for displayed total
    - **Property 19: Displayed total equals the sum of listed entries**
    - **Validates: Requirements 9.3, 10.3**

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Wire routes and views
  - [x] 8.1 Extend manager routes
    - In `src/routes/manager.js` add `GET /manager/pending`, `POST /manager/confirm`, `POST /manager/reject`, `POST /manager/end-shift` (403 on authorization failure), and load `getManagerWageEntries` into `GET /manager/dashboard`
    - _Requirements: 4.1, 5.1, 6.1, 7.1, 9.1, 9.3, 12.1, 12.2_
  - [x] 8.2 Extend employee routes
    - In `src/routes/employee.js` keep `POST /employee/book` (now pending), load `getEmployeeWageEntries` into `GET /employee/dashboard`, and pass all statuses to `GET /employee/my-shifts`
    - _Requirements: 3.1, 10.1, 10.3, 11.1, 11.2_
  - [x] 8.3 Create manager pending-requests view
    - Create `src/views/manager/pending.ejs` listing employee name, start, end, store with confirm/reject forms; show "no store assigned" when `hasManagedStore` is false
    - _Requirements: 4.2, 4.3_
  - [x] 8.4 Update manager dashboard view
    - Modify `src/views/manager/dashboard.ejs` to render the wage table (employee, date, hours, amount), total row, and empty-state message
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [x] 8.5 Update employee dashboard view
    - Modify `src/views/employee/dashboard.ejs` to render the wage table (date, hours, amount), total, and empty-state message
    - _Requirements: 10.1, 10.2, 10.3, 10.4_
  - [x] 8.6 Update employee my-shifts view
    - Modify `src/views/employee/my-shifts.ejs` to add status styling for `pending` and `rejected`
    - _Requirements: 11.1, 11.2_
  - [ ]* 8.7 Write route smoke tests for manager endpoints
    - Cover 403 on out-of-scope/wrong-role actions and unauthenticated redirect to `/login`
    - _Requirements: 12.1, 12.2, 12.3_
  - [ ]* 8.8 Write end-to-end booking lifecycle integration test
    - book → pending → confirm → end → completed → wage appears, against a test database
    - _Requirements: 3.1, 5.1, 7.1, 8.1, 9.1, 10.1_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (tests) and can be skipped for a faster MVP.
- Each task references specific requirements for traceability.
- Property-based tests use `fast-check` at >= 100 iterations and are tagged with
  `// Feature: manager-shift-confirmation, Property {n}: ...`.
- Property tests map to files per the design: `shiftService.logic.test.js`,
  `confirmationService.logic.test.js`, `storeAssignmentService.logic.test.js`,
  `wageService.logic.test.js`, and `queue.projection.test.js`.
- Database-bound and UI-only criteria (1.1–1.4, 4.3, 5.2, 6.2, 7.2, 9.4, 10.4,
  11.3, 12.3) are covered by example/integration/smoke tests.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["4.1", "2.2", "2.4"] },
    { "id": 3, "tasks": ["4.2", "2.3"] },
    { "id": 4, "tasks": ["5.1", "6.1", "4.3"] },
    { "id": 5, "tasks": ["4.4", "5.2", "6.2", "4.10"] },
    { "id": 6, "tasks": ["4.5", "5.3", "6.3", "4.11"] },
    { "id": 7, "tasks": ["4.6", "5.4", "6.4", "5.6"] },
    { "id": 8, "tasks": ["4.7", "5.5", "6.5", "5.7"] },
    { "id": 9, "tasks": ["4.8", "6.6", "5.8", "4.12"] },
    { "id": 10, "tasks": ["4.9"] },
    { "id": 11, "tasks": ["8.1", "8.2", "8.3", "8.4", "8.5", "8.6"] },
    { "id": 12, "tasks": ["8.7", "8.8"] }
  ]
}
```
