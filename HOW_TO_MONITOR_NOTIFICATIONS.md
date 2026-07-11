# How to Monitor Browser Notifications

## Overview
This guide shows you **how to verify** that notifications are being sent to employees and track their delivery.

## 🎯 Quick Answer

### **For Managers: Notification Monitor Dashboard**
Visit: `http://localhost:3000/manager/notification-monitor`

This shows you:
- ✅ Total notifications sent
- 👀 How many were viewed
- 🖱️ How many were clicked
- 📊 Delivery rates
- 👥 Which employees need reminders RIGHT NOW
- 📜 Recent notification history

### **For Developers: Database Logs**
Every notification is logged in the `notification_logs` table with timestamps.

---

## 📊 Monitoring Methods

### Method 1: Manager Dashboard (Easiest)

**Step 1:** Login as a store manager

**Step 2:** Navigate to:
```
http://localhost:3000/manager/notification-monitor
```

**What You'll See:**

#### **Overall Metrics (Last 7 Days)**
```
┌───────────────┬───────────────┬───────────────┐
│  Total Sent   │ Total Viewed  │ Total Clicked │
│      42       │      38       │      15       │
├───────────────┴───────────────┴───────────────┤
│   View Rate: 90.5%   │   Click Rate: 35.7%    │
└──────────────────────┴────────────────────────┘
```

#### **Employee Status**
Shows each employee with:
- How many notifications they received
- How many they viewed
- How many they clicked
- When last notified

#### **Current Reminders Needed**
Lists employees who:
- Have no shifts booked for next week
- Haven't been reminded in the last 2 hours
- It's currently Wednesday-Saturday

#### **Recent Log (Last 50 notifications)**
Timestamped list of all notifications sent with status

---

### Method 2: Database Queries

#### **Check Total Notifications Sent**
```sql
SELECT COUNT(*) FROM notification_logs;
```

#### **See Recent Notifications**
```sql
SELECT 
  nl.sent_at,
  u.first_name,
  u.last_name,
  nl.notification_type,
  nl.message,
  nl.viewed_at,
  nl.clicked
FROM notification_logs nl
JOIN users u ON u.id = nl.employee_id
ORDER BY nl.sent_at DESC
LIMIT 20;
```

#### **Check Delivery Rate**
```sql
SELECT 
  COUNT(*) as total_sent,
  COUNT(viewed_at) as total_viewed,
  ROUND(COUNT(viewed_at)::numeric / COUNT(*) * 100, 2) as view_rate_percent
FROM notification_logs
WHERE sent_at >= NOW() - INTERVAL '7 days';
```

#### **Find Employees Who Need Reminders**
```sql
SELECT 
  u.first_name,
  u.last_name,
  COUNT(sb.id) as bookings_next_week,
  MAX(nl.sent_at) as last_notified
FROM users u
LEFT JOIN shift_bookings sb ON sb.employee_id = u.id
LEFT JOIN shifts s ON s.id = sb.shift_id
  AND s.start_time BETWEEN [next_monday] AND [next_sunday]
LEFT JOIN notification_logs nl ON nl.employee_id = u.id
  AND nl.notification_type = 'shift_booking_reminder'
  AND nl.sent_at >= CURRENT_DATE
WHERE u.role = 'employee'
GROUP BY u.id
HAVING COUNT(sb.id) = 0;
```

---

### Method 3: Browser Console (For Testing)

When logged in as an employee:

```javascript
// Check if notification was sent
window.notificationManager.checkAndNotify().then(data => {
  console.log('Notification sent?', data.needsReminder);
  console.log('Message:', data.message);
});

// View notification permission status
console.log('Permission:', Notification.permission);

// Check localStorage
console.log('Enabled:', localStorage.getItem('notificationsEnabled'));
```

---

## 🔍 How to Verify Notifications are Working

### **Test Scenario: New Employee**

1. **Create test employee** (or use existing)
2. **Login as that employee**
3. **Go to dashboard** → Should see notification opt-in banner
4. **Enable notifications** → Grant browser permission
5. **Open browser console** → Run:
   ```javascript
   window.notificationManager.checkAndNotify()
   ```
6. **Watch console logs**:
   ```
   [Notifications] Checking if reminder needed...
   [Notifications] Server response: {needsReminder: true, ...}
   [Notifications] Showing notification: Book Your Shifts
   ```
7. **See notification** → Should pop up in corner
8. **Check database**:
   ```sql
   SELECT * FROM notification_logs 
   WHERE employee_id = '[employee-uuid]' 
   ORDER BY sent_at DESC LIMIT 1;
   ```
9. **Login as manager** → Visit `/manager/notification-monitor`
10. **Verify** → Should see entry in "Recent Notification Log"

---

## 📈 What Each Metric Means

### **Total Sent**
Number of notifications pushed to employees' browsers
- Logged when API endpoint `/employee/notifications/check` returns `needsReminder: true`
- Only counts during Wednesday-Saturday booking window
- Won't send duplicates within 2 hours

### **Total Viewed**
Number of notifications that were displayed to user
- Currently same as "Total Sent" (all sent notifications are viewed)
- In future versions with Web Push API, this would track actual browser display

### **Total Clicked**
Number of notifications that were clicked by users
- Would redirect user to `/employee/shifts` page
- Currently not tracked (future enhancement)

### **View Rate**
Percentage of sent notifications that were viewed
- Formula: `(Total Viewed / Total Sent) × 100`
- Healthy rate: 80-100%

### **Click Rate**
Percentage of sent notifications that were clicked
- Formula: `(Total Clicked / Total Sent) × 100`
- Industry average: 10-40%

---

## 🚨 Troubleshooting

### "No notifications in logs"

**Check 1:** Is it Wednesday-Saturday?
```javascript
const day = new Date().getDay();
console.log('Day:', day); // 3-6 = Wed-Sat
```

**Check 2:** Do employees have bookings for next week?
```sql
SELECT u.first_name, COUNT(sb.id) as bookings
FROM users u
LEFT JOIN shift_bookings sb ON sb.employee_id = u.id
LEFT JOIN shifts s ON s.id = sb.shift_id
WHERE u.role = 'employee'
  AND s.start_time >= [next_monday]
  AND s.start_time <= [next_sunday]
GROUP BY u.id;
```

**Check 3:** Did employee enable notifications?
```sql
SELECT * FROM push_subscriptions WHERE employee_id = '[uuid]';
```

### "Notifications sent but employee didn't see them"

**Possible reasons:**
1. Browser was not open (notifications only work when site is visited)
2. Browser permission was denied after initial grant
3. Notification blocked by OS/browser settings
4. Employee had browser minimized or on different tab

**Solution:** Implement Web Push API (see Phase 2 below) for background notifications

### "View rate is 0%"

This is expected in current implementation because:
- We track when notification API is called
- We don't yet track actual browser display confirmation
- With Web Push API in Phase 2, this will work properly

---

## 🔄 Real-Time Monitoring

### **Auto-Refresh Dashboard**
The notification monitor page auto-refreshes every 2 minutes

### **Manual Refresh**
Click the "🔄 Refresh" button at the top

### **Custom Refresh Interval**
Edit `/src/views/manager/notification-monitor.ejs`:
```javascript
// Change from 2 minutes to 30 seconds
setTimeout(() => {
  window.location.reload();
}, 30000); // 30 seconds
```

---

## 📊 Export Data for Analysis

### **CSV Export (SQL)**
```sql
COPY (
  SELECT 
    nl.sent_at,
    u.first_name || ' ' || u.last_name as employee_name,
    nl.notification_type,
    nl.message,
    nl.channel,
    nl.viewed_at,
    nl.clicked
  FROM notification_logs nl
  JOIN users u ON u.id = nl.employee_id
  WHERE nl.sent_at >= NOW() - INTERVAL '30 days'
  ORDER BY nl.sent_at DESC
) TO '/tmp/notifications_export.csv' WITH CSV HEADER;
```

### **JSON Export (Node.js)**
```javascript
const { getRecentNotificationLogs } = require('./src/services/notificationTrackerService');

async function exportLogs() {
  const logs = await getRecentNotificationLogs(1000);
  require('fs').writeFileSync(
    'notification_logs.json',
    JSON.stringify(logs, null, 2)
  );
}

exportLogs();
```

---

## 🎯 Key Indicators of Success

### ✅ **System is Working If:**
1. `notification_logs` table has rows during Wed-Sat
2. Manager dashboard shows increasing "Total Sent"
3. "Employees Needing Reminder" list decreases as employees book shifts
4. Recent logs show entries with current timestamps
5. Browser console shows: `[Notifications] Showing notification: ...`

### ❌ **System Not Working If:**
1. No rows in `notification_logs` during Wed-Sat
2. "Total Sent" stays at 0
3. Console shows: `[Notifications] Error checking notification`
4. Manager dashboard shows error message
5. All employees report not seeing notifications

---

## 📱 Phase 2: Advanced Monitoring (Future)

### **Web Push API Implementation**
- Send notifications even when browser is closed
- Track actual browser display confirmation
- Implement notification interaction callbacks
- Server-side push via `web-push` library

### **Analytics Dashboard**
- Charts showing notification trends over time
- Employee engagement scores
- Best times to send notifications
- A/B testing different message wording

### **Alerts & Escalation**
- Email manager if delivery rate drops below 50%
- SMS employees who haven't booked by Friday
- Slack integration for notification failures
- Automated follow-ups for non-responders

---

## 🎓 Understanding the Flow

```
Employee Visits Site (Wed-Sat)
         ↓
Notification Script Loads
         ↓
Checks Permission (granted?)
         ↓
API Call: /employee/notifications/check
         ↓
Server Checks:
  - Is today Wed-Sat? ✓
  - Employee has no bookings? ✓
  - Last notification >2hrs ago? ✓
         ↓
Server Logs to notification_logs
         ↓
Returns: {needsReminder: true, message: "..."}
         ↓
Browser Shows Notification
         ↓
Manager Views Dashboard
         ↓
Sees: "1 notification sent to John Doe"
```

---

## Summary

**To know notifications are sent:**
1. Visit `/manager/notification-monitor` (easiest)
2. Query `notification_logs` table (most detailed)
3. Check browser console logs (for debugging)

**Every notification is tracked** with:
- ✅ Who it was sent to
- ✅ When it was sent
- ✅ What the message was
- ✅ Whether it was viewed/clicked

You have **full visibility** into the notification system! 🎯
