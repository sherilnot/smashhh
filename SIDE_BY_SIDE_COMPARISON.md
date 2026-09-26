# Side-by-Side Comparison - Regular vs Temp Assignments

## 📅 Monday, September 29, 2026 at Rizin's Seaford

### Who's Working at Seaford:
- **Morning (11:00-15:00):** Harry, Kyra (Seaford), Mia Chen (Store B)
- **Afternoon (15:00-21:00):** Thejus, Sabin (Seaford), Noah Kumar, Liam Nguyen (Store B)

---

## 🎯 Store B Timesheet (Frank Garcia - mgr002)

**What Frank sees on HIS timesheet:**

```
MONDAY, SEPTEMBER 29

┌─────────────────────────────────┐
│ Mia Chen                        │
│ ┌───────────────────────────┐   │
│ │ 11:00 AM      🟠 ORANGE   │   │  ← Different color!
│ │ 3:00 PM       BACKGROUND  │   │
│ │ 4.0h                      │   │
│ │ (Rizin's Seaford)         │   │  ← Shows where she worked
│ └───────────────────────────┘   │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ Noah Kumar                      │
│ ┌───────────────────────────┐   │
│ │ 3:00 PM       🟠 ORANGE   │   │
│ │ 9:00 PM       BACKGROUND  │   │
│ │ 6.0h                      │   │
│ │ (Rizin's Seaford)         │   │
│ └───────────────────────────┘   │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ Liam Nguyen                     │
│ ┌───────────────────────────┐   │
│ │ 3:00 PM       🟠 ORANGE   │   │
│ │ 9:00 PM       BACKGROUND  │   │
│ │ 6.0h                      │   │
│ │ (Rizin's Seaford)         │   │
│ └───────────────────────────┘   │
└─────────────────────────────────┘

TOTAL: 16 hours
```

**What Frank sees:**
- ✅ His 3 employees (they're Store B employees)
- 🟠 Orange background on all (they worked elsewhere)
- 📍 "(Rizin's Seaford)" shows the location
- 💰 16 hours to pay (his employees, his cost)

**Note:** Frank does NOT see Harry, Kyra, Thejus, or Sabin - they're not his employees!

---

## 🎯 Seaford Timesheet (Carol White - mgr001)

**What Carol sees on HER timesheet:**

```
MONDAY, SEPTEMBER 29

┌─────────────────────────────────┐
│ Harry                           │
│ ┌───────────────────────────┐   │
│ │ 11:00 AM      💙 NORMAL   │   │  ← Regular color (blue/green)
│ │ 3:00 PM       COLOR       │   │
│ │ 4.0h                      │   │
│ │                           │   │  ← No store name (worked here)
│ └───────────────────────────┘   │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ Kyra                            │
│ ┌───────────────────────────┐   │
│ │ 11:00 AM      💙 NORMAL   │   │
│ │ 3:00 PM       COLOR       │   │
│ │ 4.0h                      │   │
│ │                           │   │
│ └───────────────────────────┘   │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ Thejus                          │
│ ┌───────────────────────────┐   │
│ │ 3:00 PM       💙 NORMAL   │   │
│ │ 9:00 PM       COLOR       │   │
│ │ 6.0h                      │   │
│ │                           │   │
│ └───────────────────────────┘   │
└─────────────────────────────────┘

┌─────────────────────────────────┐
│ Sabin                           │
│ ┌───────────────────────────┐   │
│ │ 3:00 PM       💙 NORMAL   │   │
│ │ 9:00 PM       COLOR       │   │
│ │ 6.0h                      │   │
│ │                           │   │
│ └───────────────────────────┘   │
└─────────────────────────────────┘

TOTAL: 20 hours
```

**What Carol sees:**
- ✅ Her 4 employees (they're Seaford employees)
- 💙 Normal background (they worked at their home store)
- 📍 No store name shown (worked at Seaford)
- 💰 20 hours to pay (her employees, her cost)

**Note:** Carol does NOT see Mia, Noah, or Liam - they're not her employees!

---

## 🔍 Key Differences You'll See

### Color Coding:
| Scenario | Background | Store Name | Why |
|----------|------------|------------|-----|
| **Regular shift** | Normal color (blue/green) | None shown | Employee at their home store |
| **Temp assignment** | 🟠 Orange (#FFE0B2) | "(Store Name)" | Employee worked elsewhere |

### Payroll Logic:
- **Store B pays:** Mia (4h), Noah (6h), Liam (6h) = 16h
- **Seaford pays:** Harry (4h), Kyra (4h), Thejus (6h), Sabin (6h) = 20h

**Total labor at Seaford that day:** 36 hours  
**But split between two stores' payrolls!**

---

## 📊 What This Shows

### On Frank's Timesheet (Store B):
```
Employee    | Hours | Color  | Location
------------|-------|--------|------------------
Mia Chen    | 4.0h  | 🟠     | (Rizin's Seaford)
Noah Kumar  | 6.0h  | 🟠     | (Rizin's Seaford)
Liam Nguyen | 6.0h  | 🟠     | (Rizin's Seaford)
```
All his employees worked elsewhere that day!

### On Carol's Timesheet (Seaford):
```
Employee | Hours | Color | Location
---------|-------|-------|----------
Harry    | 4.0h  | 💙    | (none)
Kyra     | 4.0h  | 💙    | (none)
Thejus   | 6.0h  | 💙    | (none)
Sabin    | 6.0h  | 💙    | (none)
```
All her employees worked at home that day!

---

## 🧪 How to Test This

### Step 1: Login as Frank Garcia (Store B Manager)
```
URL: http://localhost:3000
User: mgr002
Click: Timesheet
Navigate to: Sep 29 (use → arrow)
```

**Look for Monday column:**
- ✅ Should see Mia, Noah, Liam
- 🟠 All with ORANGE background
- 📍 All showing "(Rizin's Seaford)"
- ❌ Should NOT see Harry, Kyra, Thejus, Sabin

### Step 2: Login as Carol White (Seaford Manager)
```
User: mgr001
Click: Timesheet
Navigate to: Sep 29
```

**Look for Monday column:**
- ✅ Should see Harry, Kyra, Thejus, Sabin
- 💙 All with NORMAL background colors
- 📍 No store names shown
- ❌ Should NOT see Mia, Noah, Liam

---

## 💡 The Pattern

**TIMESHEET RULE:**
> Employees appear on their HOME store's timesheet.
> Orange background + store name = worked elsewhere.
> Normal background + no store = worked at home.

**ROSTER RULE:**
> Employees appear on the DESTINATION store's roster.
> "📥 From [Store]" badge = temporary help.

Different views, different purposes:
- **Roster** = Who's working HERE today?
- **Timesheet** = What did MY employees do this week?

---

**Server:** ✅ Running at http://localhost:3000  
**Test Data:** ✅ Ready with mixed regular and temp employees  
**Perfect for side-by-side comparison!** 🎉
