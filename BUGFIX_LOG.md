# Bug Fix Log

This log covers all bugs found and fixed across three review passes on this branch.

---

## Pass 1 — Critical & High severity

1. **`/employee/cancel` crashed the entire server** — an empty or malformed `shiftId` caused an unhandled Postgres error with no error handling anywhere in the call chain, taking down the whole app for every user. Fixed by wrapping `cancelShift()` in try/catch.

2. **Timesheet hours could go negative** — a manager could set a clock-out time before clock-in with zero validation, producing negative `hours_worked` that silently reduced an employee's pay. Fixed by validating clock-out > clock-in in `roster/clock-in`, plus a defensive floor at zero in `computeHours()`.

3. **Employees couldn't cancel a pending shift request** — `cancelShift()` only matched `confirmed` bookings; no way to withdraw a request awaiting manager approval. Fixed to also allow cancelling `pending` bookings, and added the Cancel button for pending status in `my-shifts.ejs`.

4. **Deactivating a user didn't end their session** — `verifySession()` never checked `users.is_active`, so a deactivated employee could keep using the app for up to 8 hours. Fixed by adding that check to the session query.

5. **Manager could silently re-submit an already-submitted received invoice** — no status check before overwriting figures the Receiving Manager may have already reviewed. Fixed by blocking re-submission once status is not `draft`, and fixed the GET route to actually display the resulting error (`req.query.error` was being ignored).

6. **Duplicate "Store A/B/C/D" rows created silently** — `stores.name` had no unique constraint, so re-seeding created a fresh duplicate every time. Fixed with a migration adding `UNIQUE(name)` after deduplicating existing rows, and fixed the seed script's `ON CONFLICT` clause to actually reference it.

7. **Race condition created duplicate shift rows** — two people booking the same new time slot simultaneously could each create a separate shift row. Fixed with a unique index on `(store_id, start_time, end_time)` plus `INSERT ... ON CONFLICT DO NOTHING` at all 3 call sites that create shifts on the fly.

8. **Manager could assign employees past a shift's capacity** — `roster/assign` inserted bookings directly as `confirmed`, bypassing the capacity check entirely. Fixed by wrapping the insert in a transaction that locks the shift row and re-checks occupied capacity first.

9. **Manager could clock-in an employee on a `pending` booking** — no status check before recording hours for a shift that was never approved. Fixed by requiring `confirmed` or `completed` status.

10. **Roster shift-time edits failed silently** — an invalid edit (end before start) hit a database constraint and got swallowed with no feedback. Fixed by validating upfront and surfacing a clear error message.

11. **`canEdit is not defined` crash on timesheet submit failure** — a 500 error whenever a submission attempt failed validation, because that render path was missing variables the template needed unconditionally. Fixed by computing and passing them in all render paths.

## Pass 2 — Deeper logic issues

12. **Auto-fill roster could push a shift over capacity** — `autoFillRoster()` only counted `confirmed` bookings when checking available spots, ignoring `pending` ones already on the same shift. Fixed to count `pending + confirmed` together, and fixed the returned "assigned" count to only reflect real successful inserts.

13. **Confirmed timesheets could still be secretly edited** — `/manager/timesheet/edit` and `/edit-ajax` never checked whether the parent timesheet was already `confirmed` before applying no-show flags, adjusted hours, or clock-time changes. Proved live over HTTP. Fixed by checking the week's timesheet status before allowing any edit.

14. **Weekly submission dates stored one day off** — `weeklySubmissionService.js` had the same UTC/local-timezone bug found elsewhere: the UI showed one week, the database stored a different date. Fixed by using local-time date formatting instead of `toISOString()`.

15. **Cancelled bookings blocked shift reminder notifications** — `getEmployeesNeedingReminder()` counted *any* booking (including `cancelled`/`rejected`) as proof the employee already booked, wrongly excluding them from reminders. Fixed by filtering to `pending`/`confirmed` only, matching the sibling function that already did this correctly.

16. **Removed dead/orphaned code** — `checklistUploadService.js` and `checklist-upload.ejs` had zero store-scoping in their SQL (would have leaked all stores' data cross-tenant) but were completely unreferenced by any route or view. Deleted both rather than leave the landmine in place.

## Pass 3 — New feature interactions & wage calculation

17. **Auto-completing shifts (new feature) could corrupt confirmed payroll** — the newly added scheduled job that auto-completes shifts after their end time didn't check whether the week's timesheet was already confirmed. Proved: a locked timesheet showing 8 hours silently became mismatched with 16 hours of real underlying data after the job ran. Fixed by skipping any booking whose week already has a confirmed timesheet for that store.

18. **Received invoice item errors were silently swallowed** — `/manager/received-invoice/add-item` ignored the service's return value, so empty product names got inserted as blank rows and failures on already-submitted invoices produced no feedback. Fixed by validating input and surfacing errors.

19. **No-show employees still showed full wages — the big one.** Every wage calculation path (manager dashboard, employee dashboard, and the `/manager/wages` report) completely ignored the `no_show` and `adjusted_hours` columns. Proved with a real number: a no-show for an 8-hour shift still showed **$132 owed** on the manager's dashboard and the wages report. Fixed all four affected functions (`buildWageEntry`, `getManagerWageEntries`, `getEmployeeWageEntries`, `calculateAllWages`) to respect no-show (pays $0) and manual hour adjustments, matching logic the timesheet system already had correct.

---

## New features added alongside the fixes

- **Auto-completing shifts** — a scheduled job runs every 15 minutes and marks `confirmed` bookings as `completed` once their shift's end time has passed. The manager's manual "End Shift" button is unaffected and still works for ending things early.
- **Operation Manager role** — new login role (`operation_manager`) with its own dashboard. Currently a placeholder with no functionality — scope to be defined later.

---

## Migrations added

- `16-stores-name-unique.sql` — dedupes existing stores, adds `UNIQUE(name)`
- `17-unique-shift-slot.sql` — dedupes existing shift slot collisions, adds unique index on `(store_id, start_time, end_time)`
- `18-operation-manager-role.sql` — adds `operation_manager` to the users role check constraint

## Verification

Every fix was individually tested and proved before being applied, then re-verified after the fix. A full regression pass across all 6 roles (employee, store manager, warehouse manager, receiving manager, operation manager) confirmed zero breakage and zero errors in application logs.
