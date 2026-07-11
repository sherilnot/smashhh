# Web Push Notifications - Quick Start

## 🎯 What You Get

**Push notifications that work EVEN WHEN BROWSER IS CLOSED!**

- ✅ Automatic reminders 3x/day (9 AM, 2 PM, 6 PM) on Wed-Sat
- ✅ Server pushes to employees' devices
- ✅ Full tracking & monitoring
- ✅ Manager dashboard

---

## ⚡ 5-Minute Setup

### **Step 1: Run Setup Script**

```bash
./setup-webpush.sh
```

This:
- ✅ Adds VAPID keys to `.env`
- ✅ Runs database migration
- ✅ Verifies configuration

### **Step 2: Start Server**

```bash
npm start
```

### **Step 3: Test It**

1. **Login as employee**
2. **Go to dashboard** → Click "Enable Notifications"
3. **Grant permission** when browser asks
4. **Open console** (F12) and run:
   ```javascript
   await window.webPushManager.testPushNotification()
   ```
5. **Close your browser completely**
6. **Notification still appears!** 🎉

---

## 📅 How It Works

### **Automatic Schedule:**

```
Wednesday  →  9 AM, 2 PM, 6 PM  →  Send reminders
Thursday   →  9 AM, 2 PM, 6 PM  →  Send reminders
Friday     →  9 AM, 2 PM, 6 PM  →  Send reminders
Saturday   →  9 AM, 2 PM, 6 PM  →  Send reminders (urgent!)
Sunday-Tue →  No reminders (booking closed)
```

### **Who Gets Reminded:**

- ✅ Employees with 0 bookings for next week
- ✅ Haven't been reminded in last 2 hours
- ✅ Have Web Push enabled

### **What Happens:**

```
Server checks who needs reminders
    ↓
Sends push notification via Web Push API
    ↓
Browser push service delivers to device
    ↓
Notification appears ON SCREEN
    ↓
Click → Opens /employee/shifts page
```

---

## 🎛️ Manager Dashboard

**See everything happening:**

Visit: `http://localhost:3000/manager/notification-monitor`

Shows:
- 📊 Total notifications sent
- 👀 View/click rates
- 👥 Which employees need reminders NOW
- 📜 Recent notification history

---

## 🧪 Testing Commands

### **Test from Browser Console:**

```javascript
// Check status
await window.webPushManager.getStatus()

// Send test notification
await window.webPushManager.testPushNotification()

// Check subscription
await window.webPushManager.getSubscription()
```

### **Test from Server:**

```javascript
const { sendPushNotification } = require('./src/services/webPushService');

// Send to specific employee
await sendPushNotification('employee-uuid', {
  title: 'Test',
  message: 'This is a test!'
});

// Send to all who need reminders
const { sendShiftBookingReminders } = require('./src/services/webPushService');
await sendShiftBookingReminders();
```

### **Check Database:**

```sql
-- See who's subscribed
SELECT u.first_name, u.last_name, wps.created_at
FROM web_push_subscriptions wps
JOIN users u ON u.id = wps.employee_id;

-- See notification logs
SELECT sent_at, u.first_name, message, channel
FROM notification_logs nl
JOIN users u ON u.id = nl.employee_id
WHERE channel = 'webpush'
ORDER BY sent_at DESC
LIMIT 20;
```

---

## 🔧 Configuration

### **Change Schedule:**

Edit `src/app.js`:

```javascript
// Current: 9 AM, 2 PM, 6 PM
scheduleNightlyJob('send-shift-reminders-morning', '0 9 * * 3-6', sendShiftBookingReminders);
scheduleNightlyJob('send-shift-reminders-afternoon', '0 14 * * 3-6', sendShiftBookingReminders);
scheduleNightlyJob('send-shift-reminders-evening', '0 18 * * 3-6', sendShiftBookingReminders);

// Change to: 10 AM, 3 PM, 7 PM
scheduleNightlyJob('send-shift-reminders-morning', '0 10 * * 3-6', sendShiftBookingReminders);
scheduleNightlyJob('send-shift-reminders-afternoon', '0 15 * * 3-6', sendShiftBookingReminders);
scheduleNightlyJob('send-shift-reminders-evening', '0 19 * * 3-6', sendShiftBookingReminders);
```

### **Change Message:**

Edit `src/services/webPushService.js` line ~190:

```javascript
payload: {
  title: '🍔 Book Your Shifts',  // ← Change here
  message: `It's ${dayNames[currentDay]}! Don't forget...`,  // ← Change here
}
```

---

## 🚨 Troubleshooting

### **"Service worker registration failed"**
- ✅ Using localhost or HTTPS?
- ✅ Service workers require secure context

### **"No subscriptions found"**
- ✅ Employee enabled notifications?
- ✅ Check: `SELECT * FROM web_push_subscriptions`

### **"Notifications not sending"**
- ✅ VAPID keys in `.env`?
- ✅ Database migration ran?
- ✅ Server logs show errors?

### **Check Server Logs:**

```bash
npm start
```

Look for:
```
[WebPush] VAPID keys configured successfully
[WebPush] Sending reminders to 5 employees
[WebPush] Notification sent to...
```

---

## 📊 Success Metrics

**Good indicators:**

- ✅ 70%+ employees subscribe
- ✅ 90%+ delivery rate
- ✅ Fewer late bookings
- ✅ "Employees needing reminder" decreases over time

**Check dashboard:**
- `/manager/notification-monitor`

---

## 📚 More Info

- **Full Guide:** `WEBPUSH_GUIDE.md`
- **System Architecture:** `NOTIFICATION_SYSTEM.md`
- **Testing:** `TESTING_NOTIFICATIONS.md`
- **Monitoring:** `HOW_TO_MONITOR_NOTIFICATIONS.md`

---

## ✅ Checklist

- [ ] Run `./setup-webpush.sh`
- [ ] Start server: `npm start`
- [ ] Login as employee
- [ ] Enable notifications
- [ ] Run test: `window.webPushManager.testPushNotification()`
- [ ] Close browser → notification still arrives!
- [ ] Check manager dashboard
- [ ] Verify database has subscriptions

---

## 🎉 Done!

**Web Push is now active!**

Employees will receive reminders at:
- **9 AM** - Morning reminder
- **2 PM** - Afternoon reminder
- **6 PM** - Evening reminder

Only on **Wednesday through Saturday**, only if they **haven't booked shifts yet**.

🚀 **Enjoy your automated notification system!**
