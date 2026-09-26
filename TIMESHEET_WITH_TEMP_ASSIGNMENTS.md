# Timesheet with Temporary Assignments - Testing Guide

## ✅ Created Test Data with Completed Shifts

I've created **7 completed shifts** across different stores for week of Sep 29 - Oct 5, 2026:

## 📊 What You'll See on Each Manager's Timesheet

### 1. Carol White (Seaford Manager) - Login: mgr001

**Navigate to:** Timesheet → Week of Sep 29

**Employees on Timesheet:**

| Employee | Mon Sep 29 | Type | Hours |
|----------|------------|------|-------|
| **Harry** | 11:00-15:00 | ✓ Regular | 4.0h |
| **Mia Chen** | 11:00-15:00 | **📥 Temp** | 4.0h |
| **Liam Nguyen** | 15:00-21:00 | **📥 Temp** | 6.0h |
| **Noah Kumar** | 15:00-21:00 | **📥 Temp** | 6.0h |
| **Thejus** | 15:00-21:00 | ✓ Regular | 6.0h |

**Total for Monday:** 26 hours  
**Regular staff:** 2 employees (10h)  
**Temp staff from Store B:** 3 employees (16h)

**What to Look For:**
- ✅ Mia Chen, Liam, and Noah show "📥 Temp" indicator
- ✅ Hover shows "Temporary assignment from Store B"
- ✅ Hours calculated normally (4h or 6h)
- ✅ All 5 employees appear in the timesheet

---

### 2. Frank Garcia (Store B Manager) - Login: mgr002

**Navigate to:** Timesheet → Week of Sep 29

**Employees on Timesheet:**

| Employee | Tue Sep 30 | Type | Hours |
|----------|------------|------|-------|
| **Ashin Das** | 15:00-21:00 | **📥 Temp** | 6.0h |

**Total for Tuesday:** 6 hours  
**Temp staff from Seaford:** 1 employee (6h)

**What to Look For:**
- ✅ Ashin Das shows "📥 Temp" indicator
- ✅ Hover shows "Temporary assignment from Rizin's Seaford"
- ✅ 6 hours calculated (15:00-21:00)

**Note:** Mia, Liam, Noah do NOT appear here - they worked at Seaford, not Store B!

---

### 3. Grace Lee (Store C Manager) - Login: mgr003

**Navigate to:** Timesheet → Week of Sep 29

**Employees on Timesheet:**

| Employee | Wed Oct 1 | Type | Hours |
|----------|-----------|------|-------|
| **Javad Ali** | 11:00-15:00 | **📥 Temp** | 4.0h |

**Total for Wednesday:** 4 hours  
**Temp staff from Seaford:** 1 employee (4h)

**What to Look For:**
- ✅ Javad Ali shows "📥 Temp" indicator
- ✅ Hover shows "Temporary assignment from Rizin's Seaford"
- ✅ 4 hours calculated (11:00-15:00)

---

## 🎯 Key Points About Timesheets

### The Rule: Employees appear on the timesheet of WHERE THEY WORKED

1. **Mia Chen** worked at Seaford → Appears on **Seaford's timesheet**
2. **Ashin Das** worked at Store B → Appears on **Store B's timesheet**
3. **Javad Ali** worked at Store C → Appears on **Store C's timesheet**

### Visual Indicators:

**Regular Employee:**
```
Harry
11:00 AM
3:00 PM
4.0h
```

**Temporary Employee:**
```
Mia Chen
11:00 AM
3:00 PM
4.0h
📥 Temp          ← This badge appears!
```

### Database Tracking:

Behind the scenes, the system stores:
- `timesheet_entries.worked_at_store_id` = Store where work was performed
- `shift_bookings.is_temporary_assignment` = true
- `temporary_store_assignments` = Full details of the assignment

## 🧪 How to Test

### Step 1: Login as Carol White
```
URL: http://localhost:3000
User: mgr001
Password: (your password)
```

### Step 2: Go to Timesheet
- Click "Timesheet" in sidebar
- You'll probably see current week
- Navigate forward to **Sep 29 - Oct 5** using → arrow

### Step 3: Look for the Indicators
- Scroll through Monday Sep 29
- Find the employees
- Look for the **📥 Temp** badge on Mia, Liam, and Noah
- Hover over the badge to see "from Store B"

### Step 4: Submit the Timesheet (Optional)
- Click "Submit" to save it
- This won't affect the display, just marks it as submitted

### Step 5: Repeat for Other Managers
- Logout
- Login as Frank Garcia (mgr002) - See Ashin Das on Tuesday
- Login as Grace Lee (mgr003) - See Javad Ali on Wednesday

## 📈 What This Proves

✅ **Temporary assignments integrate seamlessly**
- No manual entry needed
- Hours calculated automatically
- Clear visual distinction between regular and temp staff
- Managers see who worked at their store, regardless of home store

✅ **Payroll accuracy**
- Each store tracks hours worked AT that location
- No double-counting
- No missing hours
- Temp assignments properly attributed

✅ **Manager visibility**
- Know who's temporary at a glance
- See which store they came from
- Track all labor costs for your location

## 🎨 The Visual Experience

**On Desktop:**
The timesheet grid shows:
- Employee names in left column
- Days across the top
- Shift times in cells
- Small "📥 Temp" badge in orange for temporary employees

**On Mobile:**
Same information, scrollable grid

## 💡 Pro Tip

Want to see the raw data?
```sql
psql -h localhost -U MadRishi -d fashionshop -c "
SELECT 
  ts.week_start,
  st.name as store,
  te.shift_date,
  u.first_name || ' ' || COALESCE(u.last_name, '') as employee,
  te.hours_worked,
  worked_st.name as worked_at_store
FROM timesheet_entries te
JOIN timesheets ts ON te.timesheet_id = ts.id
JOIN stores st ON ts.store_id = st.id
JOIN users u ON te.employee_id = u.id
LEFT JOIN stores worked_st ON te.worked_at_store_id = worked_st.id
WHERE ts.week_start >= '2026-09-29'
ORDER BY st.name, te.shift_date;
"
```

---

**Server:** ✅ Running at http://localhost:3000  
**PostgreSQL:** ✅ Running  
**Test Data:** ✅ 7 completed shifts with 4 temporary assignments  
**Ready to view!** 🎉
