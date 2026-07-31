const { pool } = require('../config/database');

/**
 * Weekly Submission Service
 * Tracks when employees submit their weekly shift preferences
 * Ensures they can only submit once per booking window (Wed-Sat)
 */

/**
 * Get the current roster week (Monday-Sunday for NEXT week)
 * @returns {{ start: Date, end: Date }}
 */
function getNextRosterWeek() {
  const now = new Date();
  const day = now.getDay();
  
  // Calculate next Monday (the week we're booking FOR)
  const diffToNextMonday = day === 0 ? 1 : 8 - day;
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + diffToNextMonday);
  nextMonday.setHours(0, 0, 0, 0);
  
  const nextSunday = new Date(nextMonday);
  nextSunday.setDate(nextMonday.getDate() + 6);
  nextSunday.setHours(23, 59, 59, 999);
  
  return { start: nextMonday, end: nextSunday };
}

/**
 * Check if employee has already submitted for next week
 * @param {string} employeeId - The user UUID
 * @returns {Promise<{ hasSubmitted: boolean, submittedAt?: Date }>}
 */
async function hasSubmittedThisWeek(employeeId) {
  try {
    // Ensure the weekly_submissions table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS weekly_submissions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        employee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        roster_week_start DATE NOT NULL,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, roster_week_start)
      )
    `);

    const { start: nextMonday } = getNextRosterWeek();
    // Bug 21 fix: nextMonday is already midnight in local time; converting
    // via toISOString() shifts it to UTC first, which can land on the wrong
    // calendar date (e.g. IST is UTC+5:30, so this was storing a date one
    // day earlier than what the UI shows the employee). Format directly from
    // the local getters instead.
    const weekStartDate = `${nextMonday.getFullYear()}-${String(nextMonday.getMonth() + 1).padStart(2, '0')}-${String(nextMonday.getDate()).padStart(2, '0')}`;

    const result = await pool.query(
      `SELECT submitted_at FROM weekly_submissions 
       WHERE employee_id = $1 AND roster_week_start = $2`,
      [employeeId, weekStartDate]
    );

    if (result.rows.length > 0) {
      return {
        hasSubmitted: true,
        submittedAt: result.rows[0].submitted_at
      };
    }

    return { hasSubmitted: false };
  } catch (error) {
    console.error('[WeeklySubmission] hasSubmittedThisWeek error:', error);
    return { hasSubmitted: false }; // Fail open - allow submission if error
  }
}

/**
 * Record that employee has submitted their shifts for next week
 * @param {string} employeeId - The user UUID
 * @returns {Promise<{ success: boolean }>}
 */
async function recordSubmission(employeeId) {
  try {
    const { start: nextMonday } = getNextRosterWeek();
    // Bug 21 fix: same local-date formatting fix as hasSubmittedThisWeek.
    const weekStartDate = `${nextMonday.getFullYear()}-${String(nextMonday.getMonth() + 1).padStart(2, '0')}-${String(nextMonday.getDate()).padStart(2, '0')}`;

    await pool.query(
      `INSERT INTO weekly_submissions (employee_id, roster_week_start)
       VALUES ($1, $2)
       ON CONFLICT (employee_id, roster_week_start) DO NOTHING`,
      [employeeId, weekStartDate]
    );

    console.log(`[WeeklySubmission] Recorded submission for employee ${employeeId} for week ${weekStartDate}`);
    return { success: true };
  } catch (error) {
    console.error('[WeeklySubmission] recordSubmission error:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Check if we're in the booking window (Mon-Sun — always open)
 * @returns {boolean}
 */
function isInBookingWindow() {
  return true; // Booking open every day
}

/**
 * Get when the next booking window opens (always open, so return next Monday)
 * @returns {Date}
 */
function getNextBookingWindowStart() {
  const now = new Date();
  const currentDay = now.getDay();
  const daysUntilMonday = currentDay === 0 ? 1 : 8 - currentDay;
  const nextMonday = new Date(now);
  nextMonday.setDate(now.getDate() + daysUntilMonday);
  nextMonday.setHours(0, 0, 0, 0);
  return nextMonday;
}

/**
 * Get comprehensive submission status for employee
 * @param {string} employeeId - The user UUID
 * @returns {Promise<object>}
 */
async function getSubmissionStatus(employeeId) {
  const inBookingWindow = isInBookingWindow();
  const { hasSubmitted, submittedAt } = await hasSubmittedThisWeek(employeeId);
  const { start: nextMonday, end: nextSunday } = getNextRosterWeek();
  
  // Always allow submission — employees can update their shifts anytime
  let canSubmit = inBookingWindow;
  let message = '';
  
  if (!inBookingWindow) {
    const nextWindow = getNextBookingWindowStart();
    message = `Booking opens on ${nextWindow.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`;
    canSubmit = false;
  } else if (hasSubmitted) {
    message = `Update your shifts for ${nextMonday.toLocaleDateString()} - ${nextSunday.toLocaleDateString()}. Previously submitted — you can change anytime.`;
    canSubmit = true;
  } else {
    message = `Book your shifts for ${nextMonday.toLocaleDateString()} - ${nextSunday.toLocaleDateString()}`;
    canSubmit = true;
  }
  
  return {
    canSubmit,
    hasSubmitted,
    submittedAt,
    inBookingWindow,
    nextWeek: {
      start: nextMonday,
      end: nextSunday
    },
    nextBookingWindow: inBookingWindow ? null : getNextBookingWindowStart(),
    message
  };
}

module.exports = {
  hasSubmittedThisWeek,
  recordSubmission,
  isInBookingWindow,
  getNextBookingWindowStart,
  getSubmissionStatus,
  getNextRosterWeek
};
