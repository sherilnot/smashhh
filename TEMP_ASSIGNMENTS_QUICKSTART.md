# Quick Start - Temporary Assignments

## ✅ What It Does
Managers can temporarily **bring employees FROM other stores TO work at their own store**.

## 🔑 Login Credentials

| Store | User ID | Manager |
|-------|---------|---------|
| Rizin's Seaford | `mgr001` | Carol White |
| Store B | `mgr002` | Frank Garcia |
| Store C | `mgr003` | Grace Lee |
| Store D | `mgr004` | Henry Patel |

## 🚀 How to Use (3 Simple Steps)

### 1. Login and Navigate
- Go to **http://localhost:3000**
- Login with a manager account (e.g., `mgr001`)
- Click **"Temp Assignments"** in sidebar

### 2. Create Assignment
The form is straightforward:
1. **Select an employee** from another store (dropdown is grouped by store)
2. **Select a shift** at YOUR store (shows next 2 weeks with capacity)
3. **Add reason** (optional)
4. **Click "Assign Employee to My Store"**

### 3. View Results
- **Incoming** (📥): Employees coming TO your store
- **Outgoing** (📤): YOUR employees going to other stores

## 📊 Test Data Already Created

### Existing Assignments:
1. **Mia Chen** (Store B) → Rizin's Seaford
   - Sep 29, 11:00-15:00
   - Visible to Carol White (incoming) and Frank Garcia (outgoing)

2. **Ashin Das** (Seaford) → Store B
   - Sep 30, 15:00-21:00
   - Visible to Frank Garcia (incoming) and Carol White (outgoing)

### Available Shifts to Test:
- **Sep 29-30**: Multiple shifts at all stores
- **Oct 1-3**: More shifts available
- All have capacity for assignments

## ✨ What to Look For

### On Temp Assignments Page:
- ✅ Clean, numbered steps (1, 2, 3)
- ✅ Employee dropdown grouped by their home store
- ✅ Shift dropdown shows YOUR store's shifts only
- ✅ Incoming/Outgoing lists clearly separated

### On Weekly Roster:
- ✅ Temp employees appear with "📥 From [Store]" badge
- ✅ Navigate to week of Sep 29 to see existing assignments

### On Timesheet (after completing shifts):
- ✅ Temp employees' hours show with "📥 Temp" indicator
- ✅ Hours counted normally for payroll

## 🎯 Example Test Flow

**As Carol White (Seaford manager):**
1. Login with `mgr001`
2. Go to Temp Assignments
3. Select "Noah Kumar" from Store B
4. Pick any shift at Rizin's Seaford with capacity
5. Add note: "Need help for busy afternoon"
6. Submit
7. Check roster - Noah should appear on your schedule
8. Check incoming list - Noah should be there

**As Frank Garcia (Store B manager):**
1. Login with `mgr002`
2. Go to Temp Assignments
3. You'll see Noah in your OUTGOING list
4. You can also create your own incoming assignment

## 🔍 The Workflow is Now Clear:

**Old (confusing):**
"Select employee, select store, select shift at that store"

**New (intuitive):**
"Select employee from another store, select shift at MY store"

The manager is always assigning TO their own store, never sending employees elsewhere through this form!

## 💡 Pro Tips
- Employees grouped by store makes it easy to find who's available
- Only shifts with capacity show up
- Can't assign to past shifts (validation prevents it)
- Can't double-book employees (system checks)
- Cancel anytime before shift starts

---

**Server:** http://localhost:3000  
**Status:** ✅ Running and ready to test!
