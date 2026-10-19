/**
 * Capacitor configuration for the native iOS shell around the deployed
 * Rizins Smash web app.
 *
 * The app is server-rendered (Express + EJS), so there are no client bundles to
 * ship inside the binary. The shell therefore loads the deployed site over
 * HTTPS and keeps a small local page (capacitor/shell) for the launch and
 * offline states.
 *
 * Run `npm run cap:sync` after changing anything here to push the values into
 * the native project.
 */

const { resolveAppUrl, isBuildCommand } = require('./capacitor/app-url');

// Only hard-fail on commands that bake config into the native project, so
// harmless commands like `cap --version` still work without an env file.
const appUrl = resolveAppUrl({ required: isBuildCommand() });

/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  // NOTE: the bundle identifier is permanent once the app record exists in App
  // Store Connect. Change it here before the first upload if you want another.
  appId: 'com.rizins.smash',
  appName: 'Rizins Smash',

  // Ships inside the binary: the launch screen and the offline page that
  // `server.errorPath` falls back to.
  webDir: 'capacitor/shell',

  server: {
    // Point the web view at the deployed app.
    ...(appUrl ? { url: appUrl } : {}),

    // Never allow unencrypted traffic.
    cleartext: false,

    // Served from the local bundle (capacitor://localhost/offline.html) when the
    // remote site cannot be reached. See CAPInstanceConfiguration.errorPathURL.
    errorPath: 'offline.html',

    // Only our own host stays inside the web view. Anything else (external
    // links, mailto, and so on) is handed off to Safari.
    allowNavigation: appUrl ? [new URL(appUrl).hostname] : []
  },

  ios: {
    // Matches manifest.json so there is no white flash behind the web view or
    // when rubber-band scrolling past the content.
    backgroundColor: '#1a1a1a',

    // Inset the web view so content clears the notch and the home indicator.
    // The web app was written for browser chrome and does not manage the safe
    // area itself.
    contentInset: 'always',

    // A shift-management tool has no reason to be pinch-zoomed, and disabling it
    // keeps the layout stable.
    zoomEnabled: false,

    // Suppress the long-press link preview popover, which reads as "browser".
    allowsLinkPreview: false,

    // Keep bridge logging out of release builds.
    loggingBehavior: 'production',

    preferredContentMode: 'mobile'
  },

  plugins: {
    SplashScreen: {
      // Auto-hide deliberately left on. The server-rendered pages do not bundle
      // @capacitor/core, so nothing on the web side can call SplashScreen.hide()
      // — with launchAutoHide off the splash would never clear.
      launchAutoHide: true,
      launchShowDuration: 1500,
      backgroundColor: '#1a1a1aff',
      showSpinner: false
    },
    StatusBar: {
      // "DARK" means light glyphs, which is what we want on the dark chrome.
      // backgroundColor/overlaysWebView are Android-only, so they are omitted.
      style: 'DARK'
    }
  }
};

module.exports = config;
