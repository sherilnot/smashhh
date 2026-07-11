# Weekly Submission Locking System

## 🎯 Overview

Employees can only submit their shift preferences **once per booking window** (Wednesday-Saturday). After submitting, they're locked out until the next Wednesday.

---

## 🔒 How It Works

### **Booking Cycle:**

```
SUNDAY      → Locked (booking closed)
MONDAY      → Locked (booking closed)
TUESDAY     → Locked (booking closed)
WEDNESDAY   → 🟢 BOOKING OPENS (can submit)
THURSDAY    → 🟢 Can submit (if not already submitted)
FRIDAY      → 🟢 Can submit (if not already submitted)
SATURDAY    → 🟢 Last chance! (if not already submitted)
SUNDAY      → 🔒 Locked again (new cycle starts)
```

### **Submission Flow:**

```
Employee visits /employee/shifts on Wednesday
    ↓
System checks: hasSubmittedThisWeek(employeeId)
    ↓
NO → Show booking form ✅
YES → Show "Already submitted" message 🔒
    ↓
Employee fills form and clicks "Submit"
    ↓
Backend validates: hasSubmittedThisWeek(employeeId)
    ↓
NO → Process bookings + recordSubmission() ✅
YES → Reject with error message ❌
    ↓
After successful submission:
    - Bookings created with 'pending' status
    - Submission recorded in weekly_submissions table
    - Form locked until next Wednesday
```

---

## 📊 Database

### **Table: `weekly_submissions`**

```sql
CREATE TABLE weekly_submissions (
  id UUID PRIMARY KEY,
  employee_id UUID NOT NULL,
  roster_week_start DATE NOT NULL,      -- Monday of week being booked (YYYY-MM-DD)
  submitted_at TIMESTAMP DEFAULT NOW(),  -- When they submitted
  UNIQUE(employee_id, roster_week_start)
);
```

### **Example Data:**

| employee_id | roster_week_start | submitted_at        |
|-------------|-------------------|---------------------|
| abc-123-... | 2026-07-13        | 2026-07-09 14:23:45 |
| def-456-... | 2026-07-13        | 2026-07-10 09:15:22 |

- Employee `abc-123` submitted on **Thursday, July 9** for the week of **July 13-19**
- They **cannot** submit again until **Wednesday, July 15** (for the following week)

---

## 🔧 Key Functions

### **`hasSubmittedThisWeek(employeeId)`**

Checks if employee already submitted for next week.

```javascript
const { hasSubmitted, submittedAt } = await hasSubmittedThisWeek(employeeId);

if (hasSubmitted) {
  // Block submission
  // Show: "You already submitted on [submittedAt]"
}
```

### **`recordSubmission(employeeId)`**

Records that employee submitted for the current roster week.

```javascript
await recordSubmission(employeeId);
// Creates entry in weekly_submissions table
// Key: (employee_id, roster_week_start)
```

### **`getSubmissionStatus(employeeId)`**

Returns complete status for UI.

```javascript
const status = await getSubmissionStatus(employeeId);

// Returns:
{
  canSubmit: true/false,
  hasSubmitted: true/false,
  submittedAt: Date or null,
  inBookingWindow: true/false,
  nextWeek: { start: Date, end: Date },
  nextBookingWindow: Date or null,
  message: "Book your shifts for Jul 13 - Jul 19"
}
```

---

## 🎨 UI States

### **State 1: Can Submit (Wed-Sat, not yet submitted)**

```
┌────────────────────────────────────────────┐
│ 📅 Booking Open!                           │
│ Book your shifts for Jul 13 - Jul 19      │
│ Deadline: Saturday 11:59 PM                │
└────────────────────────────────────────────┘

[Booking Form Shown]

[Submit Shift Availability] ← Active button
```

### **State 2: Already Submitted**

```
┌────────────────────────────────────────────┐
│ ✅ Shifts Submitted Successfully!          │
│ You've already submitted shifts for the    │
│ week of Jul 13. You can submit again next  │
│ Wednesday.                                  │
│ Next booking window opens: Wednesday       │
└────────────────────────────────────────────┘

[Form Hidden - Shows message instead]
```

### **State 3: Outside Booking Window**

```
┌────────────────────────────────────────────┐
│ ⚠️ Booking Window Closed                   │
│ Booking opens on Wednesday, July 15        │
└────────────────────────────────────────────┘

[Form Hidden - Shows message]
```

---

## ✅ Verification

### **Test Scenario 1: First Submission**

1. **Wednesday morning** - Login as employee
2. **Visit `/employee/shifts`**
3. **See**: Booking form is shown
4. **Fill form** and click Submit
5. **Result**: ✅ Bookings created, submission recorded
6. **Visit `/employee/shifts` again**
7. **See**: "Already submitted" message, form hidden

### **Test Scenario 2: Try to Submit Twice**

1. **Submit shifts** on Wednesday
2. **Try POST to `/employee/book-weekly-shifts`** directly (bypass UI)
3. **Result**: ❌ Rejected with error "already submitted"
4. **Check database**:
   ```sql
   SELECT * FROM weekly_submissions WHERE employee_id = 'your-id';
   -- Should show 1 row for this week
   ```

### **Test Scenario 3: New Week**

1. **Wednesday arrives** (new booking window)
2. **System calculates**: Next roster week is now Jul 20-26
3. **Check submission**: No entry for Jul 20 week
4. **Result**: ✅ Form shows again, can submit

---

## 🔍 Database Queries

### **Check who submitted this week:**

```sql
SELECT 
  u.first_name,
  u.last_name,
  ws.roster_week_start,
  ws.submitted_at
FROM weekly_submissions ws
JOIN users u ON u.id = ws.employee_id
WHERE ws.roster_week_start = '2026-07-13'  -- Next Monday
ORDER BY ws.submitted_at DESC;
```

### **Check who hasn't submitted yet:**

```sql
SELECT 
  u.first_name,
  u.last_name,
  u.email
FROM users u
WHERE u.role = 'employee'
  AND u.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM weekly_submissions ws
    WHERE ws.employee_id = u.id
      AND ws.roster_week_start = '2026-07-13'
  );
```

### **Clear submissions (for testing):**

```sql
-- Clear all submissions for a specific week
DELETE FROM weekly_submissions WHERE roster_week_start = '2026-07-13';

-- Clear submissions for specific employee
DELETE FROM weekly_submissions WHERE employee_id = 'your-uuid';
```

---

## 🚨 Edge Cases Handled

### **1. Submission During Transition**

**Scenario**: Employee starts filling form on Saturday 11:58 PM, submits at 12:01 AM Sunday.

**Handled**: Backend checks `isInBookingWindow()` - rejects submission after Saturday.

### **2. Multiple Browser Tabs**

**Scenario**: Employee opens two tabs, tries to submit from both.

**Handled**: Database UNIQUE constraint on `(employee_id, roster_week_start)` - second submission fails.

### **3. Database Error**

**Scenario**: Database is down when checking submission status.

**Handled**: `hasSubmittedThisWeek()` returns `false` (fail open) - allows submission if error.

### **4. Manager Deletes Bookings**

**Scenario**: Manager rejects all employee's shifts. Should employee be able to resubmit?

**Handled**: NO - Submission lock remains. Design decision: One submission per window regardless of outcome.

**Alternative**: Clear submission when manager rejects to allow resubmission (optional feature).

---

## ⚙️ Configuration

### **Change Booking Window Days**

Edit `/src/services/weeklySubmissionService.js`:

```javascript
// Current: Wednesday-Saturday (3-6)
function isInBookingWindow() {
  const currentDay = now.getDay();
  return currentDay >= 3 && currentDay <= 6;
}

// Change to Monday-Friday (1-5):
function isInBookingWindow() {
  const currentDay = now.getDay();
  return currentDay >= 1 && currentDay <= 5;
}
```

### **Allow Resubmission After Rejection**

Add this function to `weeklySubmissionService.js`:

```javascript
async function clearSubmissionForWeek(employeeId, weekStart) {
  await pool.query(
    'DELETE FROM weekly_submissions WHERE employee_id = $1 AND roster_week_start = $2',
    [employeeId, weekStart]
  );
}
```

Call it when manager rejects bookings:

```javascript
// In manager reject route
await clearSubmissionForWeek(employeeId, weekStartDate);
```

---

## 📈 Benefits

✅ **Prevents spam** - Employees can't flood managers with multiple submissions  
✅ **Fair scheduling** - One chance per employee per week  
✅ **Clear expectations** - Employees know they have Wed-Sat to decide  
✅ **Reduces confusion** - No conflicting multiple submissions  
✅ **Manageable workload** - Managers review once per employee per week  

---

## 🎯 Summary

**The system ensures:**

1. ✅ Employees can submit **once per booking window** (Wed-Sat)
2. ✅ After submitting, they're **locked out until next Wednesday**
3. ✅ UI shows clear status (can submit / already submitted / window closed)
4. ✅ Backend validates all submissions (double protection)
5. ✅ Database tracks every submission with timestamp
6. ✅ Clean weekly cycle: Submit → Lock → New week → Unlock

**Perfect for managing recurring weekly schedules!** 🚀
