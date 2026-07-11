# Browser Notification System

## Overview
This system sends browser notifications to employees reminding them to book their shifts during the Wednesday-Saturday booking window.

## How It Works

### 1. Booking Window
- **Active Period**: Wednesday 00:00 - Saturday 23:59
- **Purpose**: Employees must book their shifts for the following week during this window
- **Notifications**: Only sent during this active period

### 2. Notification Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Employee visits dashboard or shifts page                │
│    → Notification script loads automatically                │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. First-time user during booking window                   │
│    → Opt-in banner appears at top of page                  │
│    → Employee clicks "Enable Notifications"                 │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Browser permission dialog                               │
│    → If granted: Subscription saved to database            │
│    → If denied: User can enable later in browser settings  │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Automatic checking begins                               │
│    → Checks immediately upon enabling                       │
│    → Then checks every hour during Wed-Sat                  │
│    → Stops automatically on Sunday                          │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Notification logic                                       │
│    → Checks if employee has bookings for next week         │
│    → If NO bookings: Show notification                      │
│    → If bookings exist: Skip notification                   │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│ 6. Notification displayed                                   │
│    → Title: "Book Your Shifts"                             │
│    → Body: Day reminder with urgency on Saturday           │
│    → Click: Navigate to /employee/shifts                    │
│    → Auto-closes after 10 seconds                           │
└─────────────────────────────────────────────────────────────┘
```

## Components

### Backend Components

#### 1. `src/services/notificationService.js`
Main service handling notification logic:

- **`savePushSubscription(employeeId, subscription)`**
  - Stores employee's notification subscription
  - Creates `push_subscriptions` table if not exists
  - Prevents duplicate subscriptions

- **`removePushSubscription(employeeId, subscription)`**
  - Removes subscription when employee disables notifications

- **`checkShiftBookingReminder(employeeId)`**
  - Checks if employee needs reminder
  - Only returns true during Wed-Sat
  - Returns false if employee already has bookings for next week
  - Provides different urgency levels (Saturday is "high")

- **`getNotificationData(employeeId)`**
  - Returns complete notification data for client

#### 2. `src/routes/employee.js` - API Endpoints

**POST `/employee/notifications/subscribe`**
- Saves subscription to database
- Called when employee enables notifications

**POST `/employee/notifications/unsubscribe`**
- Removes subscription from database
- Called when employee disables notifications

**GET `/employee/notifications/check`**
- Checks if employee needs reminder
- Returns: `{ needsReminder: boolean, message: string, title: string, urgency: string }`

### Frontend Components

#### 1. `public/js/notifications.js`
Client-side notification manager:

**NotificationManager Class**
- `checkSupport()` - Verifies browser support
- `requestPermission()` - Requests browser permission
- `subscribeToNotifications()` - Saves subscription to server
- `showNotification(title, options)` - Displays notification
- `checkAndNotify()` - Checks with server and shows notification if needed
- `startPeriodicChecks()` - Sets up hourly checks during booking window
- `showOptInBanner()` - Displays opt-in banner for new users

#### 2. View Integration
**`src/views/partials/header.ejs`**
- Loads notification script for employees only
- Script tag: `<script src="/js/notifications.js"></script>`

**`src/views/employee/dashboard.ejs`**
- Notification settings card
- Enable/disable toggle
- Status indicator
- Visual feedback on permission state

### Database

#### Table: `push_subscriptions`
```sql
CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY,
  employee_id UUID REFERENCES users(id),
  subscription_data JSONB,
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(employee_id, subscription_data)
);
```

## User Experience

### First-Time Flow
1. Employee visits dashboard during Wed-Sat
2. Colorful banner slides down from top
3. Banner says: "🔔 Stay Updated! Enable notifications to get reminders about booking your shifts"
4. Two buttons: "Enable Notifications" or "Maybe Later"
5. If enabled: Browser permission dialog appears
6. On approval: Confirmation notification + banner dismisses
7. Hourly checks begin automatically

### Recurring User
1. Notifications check hourly during Wed-Sat
2. If no bookings for next week: Notification appears
3. Notification includes:
   - Icon: Browser default or custom
   - Title: "Book Your Shifts"
   - Body: "🍔 Shift Reminder: It's [Day]! Don't forget to book your shifts for next week before Saturday ends."
   - Vibration: [200ms, 100ms, 200ms]
4. Click notification → Navigate to shifts page
5. Auto-closes after 10 seconds if not clicked

### Saturday Urgency
- Same flow but marked as "high" urgency
- Message emphasizes deadline
- Can be styled differently in future updates

## Technical Details

### Browser Compatibility
- **Required**: `Notification` API support
- **Works on**: Chrome, Firefox, Safari 16+, Edge
- **Mobile**: Android Chrome, iOS Safari (limited)
- **Graceful degradation**: Shows "not supported" message

### Permission States
- **granted**: Notifications enabled and working
- **denied**: User blocked, show browser settings message
- **default**: Not yet asked, show enable button

### Timing
- **Check frequency**: Every 60 minutes
- **Active window**: Wednesday 00:00 - Saturday 23:59
- **Next week calculation**: Monday-Sunday following current week
- **Auto-stop**: Checks cease on Sunday

### Storage
- **LocalStorage keys**:
  - `notificationsEnabled`: "true" or "false"
  - `notificationBannerDismissed`: Date string (for re-showing banner)

## Configuration Options

### Adjust Check Frequency
In `public/js/notifications.js`:
```javascript
// Change from 1 hour to 30 minutes
}, 30 * 60 * 1000); // Every 30 minutes
```

### Adjust Auto-Close Time
In `public/js/notifications.js`:
```javascript
// Change from 10 seconds to 15 seconds
setTimeout(() => {
  notification.close();
}, 15000);
```

### Change Active Days
In `src/services/notificationService.js`:
```javascript
// Currently: Wed-Sat (3-6)
if (currentDay < 3 || currentDay > 6) {
  return { needsReminder: false };
}
// Change to Mon-Fri (1-5):
if (currentDay < 1 || currentDay > 5) {
  return { needsReminder: false };
}
```

## Testing

### Test Notification Permissions
1. Visit `/employee/dashboard`
2. Look for notification settings card
3. Click "Enable Notifications"
4. Check status updates correctly

### Test Reminder Logic
1. Open browser console
2. Run: `window.notificationManager.checkAndNotify()`
3. Should show notification if:
   - Current day is Wed-Sat
   - No bookings for next week exist
   - Permission is granted

### Test Booking Window
```javascript
// In browser console
const now = new Date();
console.log('Current day:', now.getDay()); // 0=Sun, 3=Wed, 6=Sat
console.log('In booking window:', now.getDay() >= 3 && now.getDay() <= 6);
```

### Manual Database Check
```sql
-- Check subscriptions
SELECT u.first_name, u.last_name, ps.created_at, ps.subscription_data
FROM push_subscriptions ps
JOIN users u ON u.id = ps.employee_id;

-- Check who needs reminders
SELECT u.first_name, u.last_name, COUNT(sb.id) as next_week_bookings
FROM users u
LEFT JOIN shift_bookings sb ON sb.employee_id = u.id
LEFT JOIN shifts s ON s.id = sb.shift_id
WHERE u.role = 'employee'
  AND s.start_time >= [next_monday]
  AND s.start_time <= [next_sunday]
GROUP BY u.id;
```

## Privacy & Security

- Subscriptions are user-initiated (opt-in only)
- No tracking or analytics
- Subscriptions deleted when user is deleted (CASCADE)
- No personal data in notifications
- Works entirely on user's device
- No third-party services

## Future Enhancements

### Phase 2 - Web Push API
- Implement service workers
- Send notifications even when browser closed
- Use VAPID keys for push subscriptions
- Server-side push via web-push library

### Phase 3 - Advanced Features
- Custom notification times (e.g., daily at 9 AM)
- Multiple reminder types (shift starting soon, etc.)
- Notification history/logs
- Rich notifications with actions ("Book Now" button)
- Sound customization
- Do Not Disturb mode

### Phase 4 - Mobile App
- Native mobile notifications
- Push via FCM/APNS
- Background sync
- Location-based reminders

## Troubleshooting

### Notifications Not Showing
1. Check browser permission: Browser settings → Site settings → Notifications
2. Check localStorage: `localStorage.getItem('notificationsEnabled')`
3. Check current day: Must be Wed-Sat
4. Check if employee has bookings for next week
5. Open console for errors

### Permission Denied
- User must manually enable in browser settings
- Chrome: Settings → Privacy → Site Settings → Notifications
- Firefox: Preferences → Privacy → Permissions → Notifications
- Safari: Preferences → Websites → Notifications

### Banner Not Appearing
- Only shows during Wed-Sat
- Only shows if never enabled before
- Check if dismissed today: `localStorage.getItem('notificationBannerDismissed')`

### API Errors
Check server logs for:
- Database connection issues
- Missing `push_subscriptions` table
- Query errors in `notificationService.js`

## Support

For issues or questions:
1. Check browser console for JavaScript errors
2. Check server logs for backend errors
3. Verify database migrations ran: `db/11-push-notifications.sql`
4. Test with different browsers
5. Clear localStorage and try fresh subscription
