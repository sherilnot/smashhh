# 🚀 Quick Test Reference - Temporary Assignments

## 🔐 Manager Login Credentials

| Manager | User ID | Store |
|---------|---------|-------|
| Carol White | `mgr001` | Rizin's Seaford |
| Frank Garcia | `mgr002` | Store B |
| Grace Lee | `mgr003` | Store C |

**URL:** http://localhost:3000

---

## 📅 Test Week: Sep 29 - Oct 5, 2026

To see the test data, navigate to **next week** (use → arrow)

---

## 🎯 What to Test

### 1️⃣ TEMPORARY ASSIGNMENTS PAGE

**Login as any manager → Click "Temp Assignments"**

**What you'll see:**
- 📥 **Incoming:** Employees coming TO your store
- 📤 **Outgoing:** YOUR employees going to other stores
- Form to create new assignments

**Carol (Seaford) sees:**
- Incoming: Mia Chen, Noah Kumar, Liam Nguyen (from Store B)
- Outgoing: Ashin Das (to Store B), Javad Ali (to Store C)

---

### 2️⃣ WEEKLY ROSTER

**Any manager → Click "Weekly Roster" → Navigate to Sep 29**

**Carol (Seaford) Monday Sep 29:**
```
Harry          11:00-15:00  [Regular]
Mia Chen       11:00-15:00  [📥 From Store B]
Thejus         15:00-21:00  [Regular]
Liam Nguyen    15:00-21:00  [📥 From Store B]
Noah Kumar     15:00-21:00  [📥 From Store B]
```

**Frank (Store B) Tuesday Sep 30:**
```
Ashin Das      15:00-21:00  [📥 From Rizin's Seaford]
```

**Grace (Store C) Wednesday Oct 1:**
```
Javad Ali      11:00-15:00  [📥 From Rizin's Seaford]
```

---

### 3️⃣ TIMESHEET

**Any manager → Click "Timesheet" → Navigate to Sep 29**

**Carol (Seaford) - Monday Sep 29:**
```
Employee         | Hours | Indicator
----------------|-------|----------
Harry           | 4.0h  | Regular
Mia Chen        | 4.0h  | 📥 Temp
Thejus          | 6.0h  | Regular
Liam Nguyen     | 6.0h  | 📥 Temp
Noah Kumar      | 6.0h  | 📥 Temp
----------------|-------|----------
TOTAL           | 26h   |
```

**Frank (Store B) - Tuesday Sep 30:**
```
Employee         | Hours | Indicator
----------------|-------|----------
Ashin Das       | 6.0h  | 📥 Temp
----------------|-------|----------
TOTAL           | 6h    |
```

---

## ✅ Success Checklist

- [ ] Temp Assignments page loads without errors
- [ ] Can create new temporary assignments
- [ ] Incoming/Outgoing lists show correct data
- [ ] Roster shows temporary employees with badges
- [ ] Timesheet shows temp employees with 📥 indicator
- [ ] Hover over badge shows source store
- [ ] Hours calculate correctly
- [ ] Can submit timesheet normally

---

## 🐛 Troubleshooting

**Don't see employees on roster?**
- Make sure you're on week of Sep 29 (navigate with →)
- Current week is Sep 22-28, test data is Sep 29-Oct 5

**Don't see temp indicator?**
- Check you're looking at the RIGHT store's timesheet
- Mia works at Seaford → Only on Seaford's timesheet
- Ashin works at Store B → Only on Store B's timesheet

**Timesheet is empty?**
- Shifts must be marked as "completed"
- Current test data has 7 completed shifts
- If you created new assignments, you need to complete them

---

## 📊 Summary

**Total Test Data Created:**
- ✅ 10 shifts (Sep 29 - Oct 3)
- ✅ 7 completed shifts
- ✅ 5 temporary assignments (4 completed)
- ✅ 3 stores with data
- ✅ Both incoming and outgoing assignments

**Managers to Test:**
1. Carol White (mgr001) - Most data, best for testing
2. Frank Garcia (mgr002) - Has both incoming and outgoing
3. Grace Lee (mgr003) - Has one incoming assignment

---

**All systems ready! 🎉**  
Server: ✅ | Database: ✅ | Test Data: ✅
