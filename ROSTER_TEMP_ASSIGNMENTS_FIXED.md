# How to See Temporary Assignments on Roster

## ✅ Fixed! Temporary employees now appear on rosters.

## 📅 Important: Navigate to the Right Week

**Today:** Saturday, September 26, 2026  
**Test shifts are:** September 29 - October 3, 2026  
**Roster week needed:** Week of Monday, Sep 28 (or Sep 29)

## 🔍 Step-by-Step to See Mia Chen on Seaford Roster

### 1. Login as Carol White (Seaford Manager)
- Go to: http://localhost:3000
- User ID: `mgr001`
- Password: (your manager password)

### 2. Navigate to Weekly Roster
- Click **"Weekly Roster"** in the sidebar

### 3. Navigate to Next Week
- You'll probably see this week (Sep 22-28)
- Click the **→** arrow to go forward one week
- You should now see **Sep 29 - Oct 5** (or Sep 28 - Oct 4 depending on week start)

### 4. Look for Mia Chen
- Scroll down the employee list
- You should see **Mia Chen** in the list
- She'll have a shift on **Monday (Sep 29)** at **11:00-15:00**
- The shift will have a badge: **"📥 From Store B"**

## 📊 What You Should See

### Seaford Roster (Carol White):
| Employee | Mon Sep 29 | Notes |
|----------|------------|-------|
| Ashin Das | (empty) | Regular employee - he's OUT to Store B on Tue |
| Harry | - | Regular employee |
| **Mia Chen** | **11:00-15:00** ⭐ | **📥 From Store B** |
| Other employees... | - | - |

### Store B Roster (Frank Garcia):
| Employee | Tue Sep 30 | Notes |
|----------|------------|-------|
| **Ashin Das** | **15:00-21:00** ⭐ | **📥 From Rizin's Seaford** |
| Mia Chen | (empty) | She's OUT to Seaford on Mon |
| Other employees... | - | - |

## 🎯 What Changed in the Code

**Before:** Roster only showed employees in `store_employee_assignments`  
**After:** Roster now shows:
1. ✅ Regular employees (from store_employee_assignments)
2. ✅ Temporary employees (who have confirmed bookings with is_temporary_assignment = true)

The query now includes:
```sql
OR u.id IN (
  SELECT sb.employee_id 
  FROM shift_bookings sb
  JOIN shifts s ON sb.shift_id = s.id
  WHERE s.store_id = $1
  AND sb.is_temporary_assignment = true
)
```

## 🧪 Quick Test

Run this to verify Mia Chen will appear:
```bash
psql -h localhost -U MadRishi -d fashionshop -c "
SELECT u.first_name, u.last_name, s.name as home_store, 
       TO_CHAR(sh.start_time, 'Mon DD HH24:MI') as shift
FROM shift_bookings sb
JOIN shifts sh ON sb.shift_id = sh.id
JOIN users u ON sb.employee_id = u.id
JOIN store_employee_assignments sea ON u.id = sea.employee_id
JOIN stores s ON sea.store_id = s.id
WHERE sb.is_temporary_assignment = true
AND sh.start_time >= '2026-09-29'
ORDER BY sh.start_time;
"
```

Expected output:
```
 first_name | last_name | home_store |  shift  
------------+-----------+------------+--------------
 Mia        | Chen      | Store B    | Sep 29 11:00
 Ashin      | Das       | Rizin's Seaford | Sep 30 15:00
```

## 🎉 Success Criteria

- ✅ Mia Chen appears on Seaford roster (not her home store)
- ✅ Shows "📥 From Store B" badge
- ✅ Shift time shows 11:00-15:00
- ✅ Ashin Das appears on Store B roster with "📥 From Rizin's Seaford"

## 💡 Why This Matters

Before the fix, managers would create temporary assignments but wouldn't see those employees on their roster. Now:
- **Complete visibility:** All scheduled staff appear, regardless of home store
- **Clear indication:** Badge shows who's temporary
- **No confusion:** Managers see everyone working that week

---

**Status:** ✅ Server running with roster fix applied!  
**URL:** http://localhost:3000  
**Week to check:** Sep 29 - Oct 5, 2026
