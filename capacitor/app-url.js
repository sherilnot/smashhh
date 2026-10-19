/**
 * Single source of truth for the deployed web app URL that the native iOS
 * shell loads.
 *
 * Both `capacitor.config.js` (which bakes the URL into the native project on
 * `cap sync`) and `scripts/build-capacitor-shell.js` (which bakes it into the
 * bundled offline page) read from here, so the two can never drift apart.
 *
 * Set it via the environment, e.g. in `.env`:
 *   APP_URL=https://app.yourdomain.com
 */

require('dotenv').config();

/** Capacitor CLI commands that bake configuration into the native project. */
const BUILD_COMMANDS = ['sync', 'copy', 'update', 'build', 'open', 'run'];

/**
 * Resolve the deployed app URL from the environment.
 *
 * @param {object} [options]
 * @param {boolean} [options.required] - When true, throw instead of returning
 *   null if the URL is missing or invalid.
 * @returns {string|null} Origin-normalised HTTPS URL, or null when unset and
 *   not required.
 * @throws {Error} When required and the value is missing, non-HTTPS, or unparseable.
 */
function resolveAppUrl(options = {}) {
  const raw = (process.env.APP_URL || process.env.CAPACITOR_APP_URL || '').trim();

  if (!raw) {
    if (options.required) {
      throw new Error(
        'APP_URL is not set.\n' +
        'The iOS shell needs the HTTPS URL of your deployed app.\n' +
        'Add it to .env (or export it), for example:\n' +
        '  APP_URL=https://app.yourdomain.com'
      );
    }
    return null;
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new Error(`APP_URL is not a valid URL: ${raw}`);
  }

  // iOS App Transport Security blocks cleartext HTTP, and the session cookie in
  // src/routes/auth.js is set with `secure: true` in production, so it would
  // never be stored over HTTP. Fail loudly rather than shipping a build that
  // cannot log in.
  if (parsed.protocol !== 'https:') {
    throw new Error(
      `APP_URL must use https:// (got "${parsed.protocol}//").\n` +
      'iOS blocks cleartext HTTP, and the session cookie requires a secure connection.'
    );
  }

  // Strip any trailing slash so callers can safely concatenate paths.
  return parsed.origin;
}

/**
 * Whether the current Capacitor CLI invocation will write configuration into
 * the native project. Used to decide if a missing APP_URL is fatal, so that
 * harmless commands like `cap --version` still work without an env file.
 *
 * @param {string[]} [argv] - Process arguments to inspect.
 * @returns {boolean}
 */
function isBuildCommand(argv = process.argv) {
  return argv.some((arg) => BUILD_COMMANDS.includes(arg));
}

module.exports = { resolveAppUrl, isBuildCommand };
