# New Timesheet Workflow - Manager & Receiving Manager

## ✅ What Changed:

### 1. Store Manager Workflow (3 stages)

**Stage 1: Draft Submission**
- Manager edits times → clicks **"📤 Submit as Draft"**
- Timesheet saved but NOT locked
- Manager can still edit and **"📝 Update Draft"** multiple times
- Badge shows: "📝 Draft (Not Confirmed)"

**Stage 2: Editing After Submission**
- Click **"✎ Edit Timesheet"** to modify times
- Make changes → click **"📝 Update Draft"** to save
- Can repeat this as many times as needed

**Stage 3: Final Confirmation**
- When satisfied → click **"✓ Confirm & Send Final"**
- Confirmation dialog: "You will NOT be able to edit after confirmation"
- Once confirmed → **LOCKED** (no more edits)
- Badge shows: "🔒 Confirmed & Locked"
- Sent to receiving manager for wage calculation

### 2. Receiving Manager Workflow

**View Confirmed Timesheets:**
- Go to receiving manager dashboard
- See list of confirmed timesheets from all stores
- Each timesheet shows hours worked (no wages yet)

**Set Wages Per Employee:**
- Click on a timesheet to view details
- Each employee has:
  - Default wage: **$23.00/hour**
  - Option to customize per employee
- Input custom wage → system calculates total
- Shows:
  - Total hours worked
  - Hourly wage (editable)
  - Total wages earned

**Calculate Final Wages:**
- Set all employee wages
- Click **"Calculate Total Wages"**
- System shows total payroll for that week/store

### 3. What's Removed:

❌ **No wage display on store manager's timesheet**
- Store managers only see HOURS
- They don't see employee wages
- Clean separation of concerns

### 4. Database Changes:

```sql
-- Timesheet statuses
'submitted'  -- Draft, can be edited
'confirmed'  -- Locked, sent to receiving manager
'reviewed'   -- Receiving manager has processed it

-- New tables
timesheet_wage_overrides
  - timesheet_id
  - employee_id
  - hourly_wage (custom wage set by receiving manager)
  
-- New columns
users.default_hourly_wage = 23.00 (default)
```

## 🧪 Test the Workflow:

### As Store Manager (mgr001):

1. **Login:** mgr001 / 123
2. **Go to:** Timesheet
3. **Edit times** for last week
4. **Submit as Draft** → see "Draft (Not Confirmed)" badge
5. **Edit again** → change more times
6. **Update Draft** → changes saved
7. **Confirm & Send Final** → locked!
8. **Try to edit** → Edit button disabled

### As Receiving Manager (rm001):

1. **Login:** rm001 / 123
2. **Go to:** Timesheets (receiving manager view)
3. **See:** List of confirmed timesheets
4. **Click:** View details
5. **See:** Hours worked (no wages yet)
6. **Set wages:** 
   - Employee 1: Use default $23.00
   - Employee 2: Custom $25.50
7. **Calculate:** Total wages shown
8. **Mark reviewed** → timesheet complete

## 📋 UI Flow:

### Manager View:
```
┌─────────────────────────────────────┐
│  Weekly Timesheet                   │
├─────────────────────────────────────┤
│  [✎ Edit Timesheet]  📝 Draft       │
│                                     │
│  Employee  | Mon | Tue | ... Total │
│  ──────────┼─────┼─────┼────┼─────│
│  Alice     | 8h  | 0h  | ...│ 40h │
│  Bob       | 6.5h| 8h  | ...│ 38h │
│                                     │
│  [📝 Update Draft]  [✓ Confirm]    │
└─────────────────────────────────────┘
```

### Receiving Manager View:
```
┌─────────────────────────────────────┐
│  Timesheet: Store A - Week 06/28   │
├─────────────────────────────────────┤
│  Employee  | Hours | Wage    | Pay  │
│  ──────────┼───────┼─────────┼──────│
│  Alice     | 40h   | [$23.00]│ $920 │
│  Bob       | 38h   | [$25.50]│ $969 │
│                                     │
│  Total Payroll: $1,889              │
│  [Calculate Wages] [Mark Reviewed]  │
└─────────────────────────────────────┘
```

## 🔒 Security & Business Rules:

1. **Managers can't see wages** (only hours)
2. **Once confirmed → locked** (no edits)
3. **Receiving manager sets wages** (not store manager)
4. **Default $23/hour** prevents blank values
5. **Audit trail** (who set wage, when)

## 🚀 Benefits:

✅ Managers can fix mistakes before locking
✅ Clear draft vs final status
✅ Receiving manager controls wage info
✅ Separation of duties (hours vs wages)
✅ Audit trail for wage changes
✅ Default wage prevents errors

---

All changes are live! Test the flow now with mgr001 and rm001.
