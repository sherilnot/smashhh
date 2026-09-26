# Testing Guide - Temporary Store Assignments

## Server Status
✅ Server is running at: **http://localhost:3000**

## Test Data Created

### Stores & Managers
| Store | Manager | User ID | Password |
|-------|---------|---------|----------|
| Rizin's Seaford | Carol White | carol.white | (check database) |
| Store B | Frank Garcia | frank.garcia | (check database) |
| Store C | Grace Lee | grace.lee | (check database) |
| Store D | Henry Patel | henry.patel | (check database) |

### Test Employees
| Employee | Home Store |
|----------|-----------|
| Mia Chen | Store B |
| Noah Kumar | Store B |
| Liam Nguyen | Store B |
| Ashin Das | Rizin's Seaford |
| Javad Ali | Rizin's Seaford |
| Harry | Rizin's Seaford |
| Sophia Ali | Store C |
| James Singh | Store C |
| Ava Kim | Store D |
| Lucas Russo | Store D |

### Test Shifts Created (Sep 29 - Oct 3, 2026)

**Monday Sep 29:**
- Rizin's Seaford: 11:00-15:00 (3 spots), 15:00-21:00 (4 spots)

**Tuesday Sep 30:**
- Store B: 11:00-15:00 (3 spots), 15:00-21:00 (4 spots)

**Wednesday Oct 1:**
- Store C: 11:00-15:00 (2 spots), 15:00-21:00 (3 spots)

**Thursday Oct 2:**
- Store D: 11:00-15:00 (3 spots), 15:00-21:00 (4 spots)

**Friday Oct 3:**
- Rizin's Seaford: 11:00-15:00 (4 spots)
- Store B: 15:00-21:00 (4 spots)

### Temporary Assignments Already Created

1. **Mia Chen** (Store B) → **Rizin's Seaford**
   - Date: Monday, Sep 29, 2026
   - Time: 11:00 AM - 3:00 PM
   - Notes: "Need extra help for busy Monday morning"
   - Status: Confirmed

2. **Ashin Das** (Rizin's Seaford) → **Store B**
   - Date: Tuesday, Sep 30, 2026
   - Time: 3:00 PM - 9:00 PM
   - Notes: "Covering for vacation - experienced staff needed"
   - Status: Confirmed

## How to Test

### Step 1: Get Manager Credentials

Run this to get a manager's password:
```bash
psql -h localhost -U MadRishi -d fashionshop -c "SELECT user_id, first_name, last_name, role FROM users WHERE role = 'store_manager' ORDER BY first_name;"
```

If you need to reset a password to something simple like "password123":
```bash
# For Carol White (Seaford manager)
psql -h localhost -U MadRishi -d fashionshop -c "UPDATE users SET password_hash = '\$2b\$10\$YourHashHere' WHERE first_name = 'Carol' AND last_name = 'White';"
```

### Step 2: Login and Navigate

1. Go to **http://localhost:3000**
2. Login as Carol White (Seaford manager) or Frank Garcia (Store B manager)
3. Look for **"Temp Assignments"** in the sidebar navigation

### Step 3: View Existing Assignments

On the Temp Assignments page, you should see:

**For Carol White (Seaford):**
- **Incoming** (📥 green): Mia Chen from Store B on Sep 29
- **Outgoing** (📤 orange): Ashin Das to Store B on Sep 30

**For Frank Garcia (Store B):**
- **Incoming** (📥 green): Ashin Das from Seaford on Sep 30
- **Outgoing** (📤 orange): Mia Chen to Seaford on Sep 29

### Step 4: Create a New Assignment

1. **Select an employee** from another store
2. **Select a store** to load available shifts
3. **Pick a shift** with available capacity
4. **Add notes** (optional)
5. **Click "Create Assignment"**

Try creating:
- Noah Kumar (Store B) → Rizin's Seaford on Sep 29, 3:00-9:00 PM
- Harry (Seaford) → Store C on Oct 1, 11:00 AM-3:00 PM

### Step 5: Check Roster Integration

1. Navigate to **"Weekly Roster"** in the sidebar
2. Navigate to the week of Sep 29 - Oct 5, 2026
3. You should see:
   - **Mia Chen** appears on Rizin's Seaford roster for Sep 29 with "📥 From Store B" badge
   - **Ashin Das** appears on Store B roster for Sep 30 (if viewing as Frank Garcia)

### Step 6: Test Timesheet Integration

**Complete the test shifts first (simulate the shift happening):**

```sql
-- Complete Mia Chen's shift at Seaford
UPDATE shift_bookings sb
SET booking_status = 'completed', completed_at = NOW()
FROM shifts s
WHERE sb.shift_id = s.id
AND sb.employee_id = (SELECT id FROM users WHERE first_name = 'Mia' AND last_name = 'Chen')
AND s.start_time::date = '2026-09-29'
AND s.store_id = (SELECT id FROM stores WHERE name = 'Rizin''s Seaford');

-- Complete Ashin Das's shift at Store B
UPDATE shift_bookings sb
SET booking_status = 'completed', completed_at = NOW()
FROM shifts s
WHERE sb.shift_id = s.id
AND sb.employee_id = (SELECT id FROM users WHERE first_name = 'Ashin' AND last_name = 'Das')
AND s.start_time::date = '2026-09-30'
AND s.store_id = (SELECT id FROM stores WHERE name = 'Store B');
```

**Then check the timesheet:**

1. Navigate to **"Timesheet"** in the sidebar
2. Navigate to the week of Sep 29 - Oct 5, 2026
3. **For Carol White (Seaford):**
   - You should see Mia Chen's hours (4 hours on Sep 29)
   - The shift should show "📥 Temp" indicator
   - Hover over it to see "Temporary assignment from Store B"
4. **For Frank Garcia (Store B):**
   - You should see Ashin Das's hours (6 hours on Sep 30)
   - The shift should show "📥 Temp" indicator

### Step 7: Test Cancellation

1. Go back to **Temp Assignments**
2. Find an upcoming (future) assignment
3. Click **"Cancel"** button
4. Confirm the cancellation
5. Verify it disappears from both managers' views

## What to Check

### ✅ UI Features
- [ ] Temp Assignments page loads without errors
- [ ] Incoming assignments show with green border
- [ ] Outgoing assignments show with orange border
- [ ] Employee dropdown is grouped by store
- [ ] Store selection dynamically loads shifts
- [ ] Create assignment form validates properly
- [ ] Cancel button only appears for future shifts
- [ ] Notes display correctly

### ✅ Roster Integration
- [ ] Temporary employees appear on roster
- [ ] "📥 From [Store]" badge shows correctly
- [ ] Can view roster without errors
- [ ] Edit mode doesn't break

### ✅ Timesheet Integration
- [ ] Completed temp assignments appear on timesheet
- [ ] "📥 Temp" indicator shows
- [ ] Hours are calculated correctly
- [ ] worked_at_store_id is tracked in database
- [ ] Submit timesheet works normally

### ✅ Validation
- [ ] Cannot assign to same store
- [ ] Cannot assign to full shifts
- [ ] Cannot assign to past shifts
- [ ] Cannot duplicate bookings
- [ ] Cannot cancel completed shifts
- [ ] Proper error messages display

## Troubleshooting

**If temporary assignments don't appear:**
```bash
# Check database
psql -h localhost -U MadRishi -d fashionshop -c "SELECT * FROM temporary_store_assignments;"
```

**If server has errors:**
```bash
# Check logs
tail -50 /tmp/smashhh.log
```

**Reset test data:**
```bash
# Remove test shifts and assignments
psql -h localhost -U MadRishi -d fashionshop -c "DELETE FROM shifts WHERE start_time >= '2026-09-29' AND start_time < '2026-10-04';"
# Then re-run test_shifts.sql
```

## Database Queries for Verification

**Check temporary assignments:**
```sql
SELECT 
  u.first_name || ' ' || u.last_name as employee,
  from_st.name as from_store,
  to_st.name as to_store,
  s.start_time,
  sb.booking_status,
  ta.notes
FROM temporary_store_assignments ta
JOIN users u ON ta.employee_id = u.id
JOIN stores from_st ON ta.from_store_id = from_st.id
JOIN stores to_st ON ta.to_store_id = to_st.id
JOIN shift_bookings sb ON ta.shift_booking_id = sb.id
JOIN shifts s ON sb.shift_id = s.id
ORDER BY s.start_time;
```

**Check timesheet entries with store tracking:**
```sql
SELECT 
  te.*,
  u.first_name || ' ' || u.last_name as employee,
  s.name as worked_at_store
FROM timesheet_entries te
JOIN users u ON te.employee_id = u.id
LEFT JOIN stores s ON te.worked_at_store_id = s.id
WHERE te.shift_date >= '2026-09-29' AND te.shift_date < '2026-10-04';
```

## Success Criteria

The feature is working correctly if:
1. ✅ Managers can view and create temporary assignments through the UI
2. ✅ Assignments appear on both source and destination store rosters with indicators
3. ✅ Timesheets automatically include temp assignments with visual badges
4. ✅ All validation prevents errors and conflicts
5. ✅ Cancellation works for future assignments
6. ✅ No errors in server logs or browser console
