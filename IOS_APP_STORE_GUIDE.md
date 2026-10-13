# iOS App Store Guide

The iOS app is a Capacitor shell that loads the live site (`server.url` in
`capacitor.config.json`) and adds native push notifications through APNs.
The web app and server code are shared, so most changes don't need a new App Store build.
You only need to rebuild when native config, plugins, icons or the app version change.

Already done in the repo:
- `capacitor.config.json` - app ID `com.rizins.smash`, name, server URL
- `www/index.html` - offline fallback page bundled in the app
- `src/services/apnsService.js` - sends push to iPhones; `sendPushNotification` now delivers to web and iOS
- `public/js/native-push.js` - registers the device in the app; the dashboard Enable/Disable toggle works unchanged
- `db/27-native-push-tokens.sql` - device token table
- Logout removes that device's push token

---

## 0. Before the Mac (server side)

1. **HTTPS domain.** Apple requires HTTPS. Finish "Step 6: HTTPS" in `DEPLOY_AWS.md`.
2. Put the domain into `capacitor.config.json`:
   ```json
   "server": { "url": "https://your-domain.com/login", ... }
   ```
3. **If you want a different bundle ID**, change `appId` in `capacitor.config.json` now.
   It can't be changed after the first upload.
4. Run the migration on the server DB:
   ```bash
   psql -U <user> -d <db> -f db/27-native-push-tokens.sql
   ```

## 1. Apple Developer website (any computer)

1. **Identifiers** -> + -> App IDs -> App -> Bundle ID `com.rizins.smash` (explicit).
   Tick **Push Notifications**. Register.
2. **Keys** -> + -> name "APNs" -> tick **Apple Push Notifications service (APNs)** -> Register.
   Download the `.p8` file. You can only download it once, so keep it safe.
   Note the **Key ID**. Your **Team ID** is at the top right of the Membership page.
3. Copy the `.p8` to the server (never commit it), then add to the server `.env`:
   ```
   APNS_KEY_ID=XXXXXXXXXX
   APNS_TEAM_ID=YYYYYYYYYY
   APNS_BUNDLE_ID=com.rizins.smash
   APNS_KEY_PATH=/home/ubuntu/AuthKey_XXXXXXXXXX.p8
   APNS_ENV=production
   ```
   `pm2 restart smashhh`. The log should show `[APNs] Configured for com.rizins.smash`.
4. **App Store Connect** -> Apps -> + -> New App -> iOS, name "Rizins Smash", bundle ID
   `com.rizins.smash`, SKU anything (e.g. `rizins-smash`).

## 2. Mac setup (one time)

1. Install **Xcode** from the Mac App Store and open it once to install components.
2. Install Node.js LTS (nodejs.org) and git.
3. Xcode -> Settings -> Accounts -> + -> sign in with your Apple Developer account.
4. Clone the repo and install:
   ```bash
   git clone <repo-url> smashhh && cd smashhh
   npm install
   npx cap add ios
   npx cap sync ios
   ```
   If `cap add ios` complains about CocoaPods: `brew install cocoapods`, then retry.

## 3. Xcode project setup (one time)

`npm run ios:open` opens Xcode. Select the **App** target:

1. **Signing & Capabilities**
   - Team: your team. Leave "Automatically manage signing" ticked.
   - **+ Capability -> Push Notifications**
   - **+ Capability -> Background Modes** -> tick **Remote notifications**
2. **AppDelegate.swift** - add these two methods inside the `AppDelegate` class
   (needed for the push plugin):
   ```swift
   func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
       NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
   }

   func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
       NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
   }
   ```
3. **Info.plist** - add `ITSAppUsesNonExemptEncryption` (Boolean) = `NO`
   (the app only uses HTTPS, so you can skip the export compliance question on every upload).
4. **General** -> Display Name "Rizins Smash", Version `1.0.0`, Build `1`.
   Deployment target: leave the Capacitor default.
5. **App icon** - put a 1024x1024 PNG (no transparency, no rounded corners) at
   `assets/icon.png`, then:
   ```bash
   npx @capacitor/assets generate --ios
   ```
   (`public/icons/icon-512.svg` can be exported to 1024px for this.)

Commit the generated `ios/` folder.

## 4. Test on your iPhone

1. Plug in the iPhone and enable Developer Mode (Settings -> Privacy & Security).
2. In Xcode pick the phone as the run target, then press Run.
3. Check:
   - [ ] Login works and stays logged in after closing/reopening the app
   - [ ] Notification permission prompt appears on first employee login
   - [ ] Dashboard notification toggle shows "Enabled"
   - [ ] "Test push" / manager sends a notification -> it arrives; tapping it opens the right page
   - [ ] Payslip PDF download and the other file downloads work (if not, tell Claude, a fix may be needed)
   - [ ] Airplane mode on launch shows the offline page; Retry works
   - [ ] Logout -> notifications stop for that device

> Builds run from Xcode use Apple's **sandbox** push servers. To test push this way,
> temporarily set `APNS_ENV=sandbox` on the server. TestFlight and App Store builds use
> `production`, so switch back afterwards.

## 5. Upload to TestFlight

1. Xcode: run target **Any iOS Device (arm64)** -> **Product -> Archive**.
2. Organizer opens -> **Distribute App -> App Store Connect -> Upload**.
3. After ~10-30 min the build appears in App Store Connect -> TestFlight.
   Add yourself and staff as testers and install via the TestFlight app.
4. For each new upload, bump **Build** (2, 3, ...). Bump **Version** for App Store releases.

## 6. Submit for review

In App Store Connect -> your app -> the 1.0 version page:

- **Screenshots**: 6.9" iPhone (1320x2868 or 1290x2796) is required. Take them on a
  simulator (Xcode -> iPhone 16 Pro Max -> Cmd+S). Add iPad screenshots only if you keep iPad support.
- **Description, keywords, support URL, privacy policy URL** (the privacy policy can be a simple page on your site).
- **App Privacy**: declare data collected, e.g. name, email, contact info, employment and
  payroll info (linked to the user, used for app functionality, not tracking).
- **App Review Information -> Sign-in required**: give a working **demo employee login**
  with realistic data (shifts, a payslip). Reviewers reject apps they can't log in to.
  Add a note: *"Internal staff app for Rizins Smash employees. Accounts are created by
  managers; there is no public sign-up."*
- **Distribution**: this is an internal staff tool. Under Pricing and Availability you can
  choose **Unlisted App** distribution after requesting it from Apple
  (developer.apple.com/support/unlisted-app-distribution). This avoids "not for the general public"
  rejections and keeps it out of search.
- Click **Add for Review -> Submit**. Review usually takes 1-3 days.

## Updating later

- **Web/server changes** (views, routes, CSS): just deploy to EC2. The app picks them up immediately.
- **Native changes** (plugins, icons, `capacitor.config.json`):
  `npx cap sync ios` -> bump Build -> Archive -> Upload -> submit.
