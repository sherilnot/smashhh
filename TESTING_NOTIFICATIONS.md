# Testing Browser Notifications

## Quick Start

### 1. **Start the App**
```bash
npm start
```

### 2. **Access Test Page**
Open in browser:
```
http://localhost:3000/test-notifications.html
```

### 3. **Run Tests in Order**

Click the buttons in sequence:

1. **"Check Permission"** → See current browser permission status
2. **"Request Permission"** → Browser will ask for permission, click "Allow"
3. **"Show Test Notification"** → Test basic notification (should pop up!)
4. **"Check If Reminder Needed"** → See server response about booking status
5. **"Force Show Reminder"** → Force show the actual booking reminder

### 4. **Check Console Logs**
- Colored logs appear on the test page
- Green = Success
- Yellow = Warning
- Red = Error

## Understanding the Response

When you click **"Check If Reminder Needed"**, you'll see a JSON response:

### ✅ **Needs Reminder** (Wed-Sat, no bookings)
```json
{
  "needsReminder": true,
  "message": "🍔 Shift Reminder: It's Thursday! Don't forget...",
  "title": "Book Your Shifts",
  "urgency": "normal",
  "timestamp": "2026-07-09T..."
}
```

### ❌ **No Reminder** (Outside Wed-Sat)
```json
{
  "needsReminder": false,
  "message": "Outside booking window",
  "timestamp": "2026-07-09T..."
}
```

### ❌ **No Reminder** (Already has bookings)
```json
{
  "needsReminder": false,
  "message": "Already has bookings for next week",
  "timestamp": "2026-07-09T..."
}
```

## Testing in Production Flow

### **Option A: Employee Dashboard**

1. Login as employee
2. Go to: `http://localhost:3000/employee/dashboard`
3. You'll see a notification settings card
4. Click "Enable Notifications"
5. Grant permission
6. Open browser console (F12)
7. Type:
   ```javascript
   window.notificationManager.checkAndNotify()
   ```
8. Check console output:
   ```
   [Notifications] Checking if reminder needed...
   [Notifications] Server response: {needsReminder: true, ...}
   [Notifications] Permission status: granted
   [Notifications] Showing notification: Book Your Shifts
   ```

### **Option B: Browser Console Debug**

```javascript
// Check current day (0=Sun, 3=Wed, 6=Sat)
new Date().getDay()

// Manually check the API
fetch('/employee/notifications/check')
  .then(r => r.json())
  .then(d => console.log(d))

// Check permission
Notification.permission

// Request permission
Notification.requestPermission().then(p => console.log(p))

// Show test notification
new Notification('Test', { body: 'Hello!' })
```

## Troubleshooting

### **Promise stays pending**
This is normal! The promise resolves when the server responds. To see the result:
```javascript
window.notificationManager.checkAndNotify().then(data => console.log(data))
```

### **No notification shows**
Check these:
1. Permission granted? `Notification.permission === 'granted'`
2. Today is Wed-Sat? `new Date().getDay() >= 3 && <= 6`
3. No bookings for next week? (Check database)
4. Console has no errors?

### **"Outside booking window"**
The current day is not Wednesday-Saturday. To test:
- Wait until Wednesday, OR
- Temporarily modify the code in `notificationService.js`:
```javascript
// Change this line:
if (currentDay < 3 || currentDay > 6) {
// To this (always active):
if (false) {
```

### **Permission denied**
Browser blocked notifications. To reset:
- **Chrome**: Click 🔒 in address bar → Site settings → Notifications → Allow
- **Firefox**: Click 🔒 → Clear permissions → Reload page
- **Safari**: Safari → Settings → Websites → Notifications

## Manual Database Checks

### **Check subscriptions**
```sql
SELECT u.first_name, u.last_name, ps.created_at
FROM push_subscriptions ps
JOIN users u ON u.id = ps.employee_id;
```

### **Check employee bookings**
```sql
SELECT 
  u.first_name, 
  u.last_name, 
  COUNT(sb.id) as bookings
FROM users u
LEFT JOIN shift_bookings sb ON sb.employee_id = u.id
WHERE u.role = 'employee'
GROUP BY u.id;
```

### **Manually trigger reminder check**
```javascript
// In browser console (logged in as employee)
fetch('/employee/notifications/check')
  .then(r => r.json())
  .then(data => {
    console.log('Response:', data);
    if (data.needsReminder && Notification.permission === 'granted') {
      new Notification(data.title, { body: data.message });
    }
  });
```

## Simulating Different Scenarios

### **Scenario 1: First-time user during booking window**
1. Clear localStorage: `localStorage.clear()`
2. Visit employee dashboard
3. Should see colorful opt-in banner
4. Click "Enable Notifications"

### **Scenario 2: Returning user with notifications enabled**
1. Set localStorage: `localStorage.setItem('notificationsEnabled', 'true')`
2. Grant permission (if not already granted)
3. Visit employee dashboard
4. Periodic checks start automatically
5. Open console to see hourly check logs

### **Scenario 3: Saturday urgency**
Only works on actual Saturday, or modify code:
```javascript
// In notificationService.js, temporarily change:
urgency: currentDay === 6 ? 'high' : 'normal'
// To:
urgency: 'high' // Always urgent for testing
```

## Expected Console Output

### **Successful Check (needs reminder):**
```
[Notifications] Checking if reminder needed...
[Notifications] Server response: {needsReminder: true, message: "...", ...}
[Notifications] Permission status: granted
[Notifications] Showing notification: Book Your Shifts
```

### **No reminder needed:**
```
[Notifications] Checking if reminder needed...
[Notifications] Server response: {needsReminder: false, message: "Already has bookings for next week"}
[Notifications] No reminder needed: Already has bookings for next week
```

### **Permission not granted:**
```
[Notifications] Checking if reminder needed...
[Notifications] Server response: {needsReminder: true, ...}
[Notifications] Reminder needed but permission not granted
```

## What Success Looks Like

✅ **Test page shows:**
- Browser Support: ✅ Yes
- Permission: granted
- Current Day: Thursday (Day 4)
- Booking Window: ✅ Active (Wed-Sat)

✅ **When clicking "Force Show Reminder":**
- Notification pops up in corner of screen
- Has burger emoji and message
- Clicking it would navigate to shifts page
- Auto-closes after 10 seconds

✅ **In employee dashboard:**
- Status shows: "✅ Enabled - You'll receive reminders during Wed-Sat"
- Button says: "Disable Notifications"
- Button is red

That's it! The system is working. 🎉
