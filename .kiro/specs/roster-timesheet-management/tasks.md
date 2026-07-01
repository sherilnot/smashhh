# Implementation Plan

## Overview

This plan implements the roster-timesheet-management feature in 12 tasks, progressing from database schema changes through service layer, routes, and views. Tasks are ordered to minimize blocking dependencies.

## Tasks

- [x] 1. Database Migration — Create `db/03-roster-timesheet.sql` with: ALTER users role CHECK to include 'receiving_manager'; CREATE `timesheets` table (id UUID PK, store_id FK stores, week_start DATE, week_end DATE, total_hours NUMERIC(10,2), employee_count INTEGER, submitted_by FK users, received_by FK users, submitted_at TIMESTAMP, status VARCHAR(20) CHECK IN ('submitted','reviewed'), UNIQUE(store_id, week_start)); CREATE `timesheet_entries` table (id UUID PK, timesheet_id FK timesheets CASCADE, employee_id FK users, shift_date DATE, shift_start TIMESTAMP, shift_end TIMESTAMP, hours_worked NUMERIC(10,2)); ALTER `checklist_items` ADD transmitted_at TIMESTAMP NULL, transmitted_by UUID FK users NULL; Add indexes on timesheets(store_id, week_start, submitted_by) and timesheet_entries(timesheet_id, employee_id). Run migration locally and verify.
  - **Requirements**: 8.1, 7.2, 7.4, 6.2, 6.3, 4.5, 4.6

- [x] 2. Roster Service Pure Helpers — Create `src/services/rosterService.js` with pure functions: `getRosterWeek(date)` returns Monday 00:00:00 to Sunday 23:59:59; `validateRosterRequest(facts)` validates date and store assignment; `isWithinNavigationBounds(weekStart, currentDate)` returns canGoPrev/canGoNext based on ±12 weeks; `sortRosterEntries(entries)` sorts by last_name, first_name then chronologically; `filterRosterBookings(bookings, assignedStoreIds)` filters to confirmed bookings from assigned stores only.
  - **Requirements**: 1.2, 1.4, 1.8, 2.1, 2.3, 3.6

- [x] 3. Roster Service Database Query — Add `getRoster(managerId, weekStart, weekEnd)` to rosterService.js: query store_manager_assignments for manager's stores; if none return hasManagedStore:false; JOIN shifts → shift_bookings → users WHERE store_id IN assigned stores AND booking_status='confirmed' AND start_time within week AND store_id IS NOT NULL; return grouped roster sorted via sortRosterEntries.
  - **Requirements**: 1.1, 1.3, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4

- [x] 4. Roster Routes and View — Add GET /roster route to manager.js accepting optional ?date=YYYY-MM-DD; compute week via getRosterWeek, fetch via getRoster, compute nav bounds. Create `src/views/manager/roster.ejs` showing week dates (YYYY-MM-DD), prev/next navigation (disabled at bounds), employee shift table sorted alphabetically, empty state messages for no bookings or no store assignment.
  - **Requirements**: 1.1–1.9, 3.1–3.6

- [x] 5. Timesheet Service Pure Helpers — Create `src/services/timesheetService.js` with: `computeHours(startTime, endTime)` returns (end-start)/3600000 rounded to 2 decimals; `validateTimesheetSubmission(facts)` checks hasStore, hasReceivingManager, !alreadySubmitted, weekEnd<=now, hasCompletedBookings; `aggregateTimesheet(entries)` groups by employee summing hours.
  - **Requirements**: 6.2, 7.3, 7.4, 7.5, 7.6

- [x] 6. Timesheet Service Database Functions — Add to timesheetService.js: `generateTimesheet(managerId, weekStart, weekEnd)` queries completed bookings for manager's store, computes hours, returns grouped data; `submitTimesheet(managerId, weekStart, weekEnd)` validates then inserts into timesheets+timesheet_entries within transaction; `getSubmittedTimesheets(page, limit)` returns paginated list ordered by submitted_at DESC (max 50/page); `getTimesheetDetail(timesheetId)` returns full breakdown with employee names.
  - **Requirements**: 6.1, 6.3–6.6, 7.1–7.7, 9.1–9.5

- [x] 7. Timesheet Routes and View (Store Manager) — Add GET /timesheet and POST /timesheet/submit routes to manager.js. Create `src/views/manager/timesheet.ejs` with week navigation, employee hours table, submit button (disabled for future/empty/already-submitted), success/error messages.
  - **Requirements**: 6.1–6.6, 7.1–7.7

- [x] 8. Checklist Upload Service — Create `src/services/checklistUploadService.js` with: `validateChecklistUpload(facts)` pure validation (hasStore, hasWarehouseManager, !hasPendingItems, hasCompletedItems); `filterUploadableItems(items, storeId)` pure filter; `uploadChecklist(managerId)` finds store and warehouse_manager, validates, uses transaction to UPDATE transmitted_at/transmitted_by on eligible items.
  - **Requirements**: 4.1–4.7, 5.1–5.4

- [x] 9. Checklist Upload Routes and View — Add GET /checklist-upload and POST /checklist-upload routes to manager.js. Create `src/views/manager/checklist-upload.ejs` listing uploadable items with product details, upload button (hidden when no items/pending items), success/error feedback.
  - **Requirements**: 4.1–4.7, 5.1–5.4

- [x] 10. Receiving Manager Routes and Views — Create `src/routes/receiving-manager.js` with roleGuard('receiving_manager'); GET /dashboard redirects to /timesheets; GET /timesheets lists paginated submitted timesheets; GET /timesheets/:id shows detail. Register in app.js with `app.use('/receiving-manager', ...)`. Update root redirect to handle receiving_manager role. Create `src/views/receiving-manager/timesheets.ejs` and `src/views/receiving-manager/timesheet-detail.ejs`.
  - **Requirements**: 8.4–8.6, 9.1–9.5

- [x] 11. Seed Data Update — Update `scripts/seed-data.js` to add a receiving_manager user (rm001 / Receiver123!) and print credentials in output. Verify seed runs with updated role constraint.
  - **Requirements**: 8.1, 8.2

- [x] 12. Manager Dashboard Navigation — Update `src/views/manager/dashboard.ejs` to add nav links: "Weekly Roster" → /manager/roster, "Timesheet" → /manager/timesheet, "Upload Checklist" → /manager/checklist-upload. Update header partial if applicable for receiving_manager nav.
  - **Requirements**: 1, 4, 6 (feature discoverability)

## Task Dependency Graph

```json
{
  "waves": [
    [1],
    [2, 5, 8, 11],
    [3, 6, 9],
    [4, 7, 10],
    [12]
  ]
}
```

## Notes

- Task 1 must be completed first as all other tasks depend on the schema changes.
- Tasks 2–4, 5–7, and 8–9 are independent streams that can be developed in parallel after Task 1.
- Task 10 depends on Task 6 (uses getSubmittedTimesheets and getTimesheetDetail).
- Task 12 depends on Tasks 4, 7, and 9 (links to those routes).
- The receiving_manager role name is a placeholder (TBD per user) — can be renamed later via a simple migration + find-replace.
