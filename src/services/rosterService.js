const { pool } = require('../config/database');

/**
 * Roster Service
 * Handles weekly roster generation with store isolation.
 */

// ─── Pure Helper Functions ───────────────────────────────────────────────────

/**
 * Calculate the Monday-Sunday Roster_Week containing a given date.
 * @param {Date} date - Any date within the desired week
 * @returns {{ start: Date, end: Date }} Monday 00:00:00 to Sunday 23:59:59
 */
function getRosterWeek(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun, 1=Mon, ...
  const diffToMonday = day === 0 ? -6 : 1 - day;

  const monday = new Date(d);
  monday.setDate(d.getDate() + diffToMonday);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { start: monday, end: sunday };
}

/**
 * Validate a roster request.
 * @param {{ date: string|null|undefined, hasManagedStore: boolean }} facts
 * @returns {{ valid: true, week: { start: Date, end: Date } } | { valid: false, error: string }}
 */
function validateRosterRequest(facts) {
  if (facts.date === null || facts.date === undefined || facts.date === '') {
    // Default to current week
    const week = getRosterWeek(new Date());
    return { valid: true, week };
  }

  const parsed = new Date(facts.date);
  if (isNaN(parsed.getTime())) {
    return { valid: false, error: 'Invalid date: could not determine roster week' };
  }

  const week = getRosterWeek(parsed);
  return { valid: true, week };
}

/**
 * Check if a given week is within navigation bounds (±12 weeks from current).
 * @param {Date} weekStart - Monday of the week to check
 * @param {Date} currentDate - Current date
 * @returns {{ canGoPrev: boolean, canGoNext: boolean }}
 */
function isWithinNavigationBounds(weekStart, currentDate) {
  const currentWeek = getRosterWeek(currentDate);
  const currentMonday = currentWeek.start.getTime();
  const targetMonday = weekStart.getTime();

  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const diffWeeks = Math.round((targetMonday - currentMonday) / weekMs);

  return {
    canGoPrev: diffWeeks > -12,
    canGoNext: diffWeeks < 12
  };
}

/**
 * Sort roster entries: employees alphabetically by (last_name, first_name),
 * shifts within each employee chronologically by start_time.
 * @param {Array} entries - Array of { employee: { first_name, last_name }, shifts: [...] }
 * @returns {Array} Sorted entries
 */
function sortRosterEntries(entries) {
  return entries
    .map(entry => ({
      ...entry,
      shifts: [...entry.shifts].sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    }))
    .sort((a, b) => {
      const lastCmp = a.employee.last_name.localeCompare(b.employee.last_name);
      if (lastCmp !== 0) return lastCmp;
      return a.employee.first_name.localeCompare(b.employee.first_name);
    });
}

/**
 * Filter bookings to only those from assigned stores with confirmed status.
 * @param {Array} bookings - Array of booking objects with store_id and booking_status
 * @param {Array} assignedStoreIds - Array of store UUIDs the manager is assigned to
 * @returns {Array} Filtered bookings
 */
function filterRosterBookings(bookings, assignedStoreIds) {
  const storeSet = new Set(assignedStoreIds);
  return bookings.filter(b =>
    b.store_id != null &&
    storeSet.has(b.store_id) &&
    b.booking_status === 'confirmed'
  );
}

// ─── Database Functions ──────────────────────────────────────────────────────

/**
 * Fetch confirmed bookings for a manager's stores during a Roster_Week.
 * @param {string} managerId - The user UUID of the store manager
 * @param {Date} weekStart - Monday 00:00:00
 * @param {Date} weekEnd - Sunday 23:59:59
 * @returns {Promise<{ hasManagedStore: boolean, roster: Array }>}
 */
async function getRoster(managerId, weekStart, weekEnd) {
  // Find manager's assigned stores
  const storeRes = await pool.query(
    `SELECT store_id FROM store_manager_assignments WHERE manager_id = $1`,
    [managerId]
  );

  if (storeRes.rows.length === 0) {
    return { hasManagedStore: false, roster: [] };
  }

  const storeIds = storeRes.rows.map(r => r.store_id);

  // Fetch confirmed bookings for those stores in the week
  const bookingsRes = await pool.query(
    `SELECT
       u.id AS employee_id, u.first_name, u.last_name,
       s.start_time, s.end_time, s.store_location,
       sb.booking_status, s.store_id
     FROM shift_bookings sb
     JOIN shifts s ON s.id = sb.shift_id
     JOIN users u ON u.id = sb.employee_id
     WHERE s.store_id = ANY($1)
       AND sb.booking_status = 'confirmed'
       AND s.start_time >= $2
       AND s.start_time <= $3
       AND s.store_id IS NOT NULL
     ORDER BY u.last_name, u.first_name, s.start_time`,
    [storeIds, weekStart, weekEnd]
  );

  // Group by employee
  const employeeMap = new Map();
  for (const row of bookingsRes.rows) {
    const key = row.employee_id;
    if (!employeeMap.has(key)) {
      employeeMap.set(key, {
        employee: {
          id: row.employee_id,
          first_name: row.first_name,
          last_name: row.last_name
        },
        shifts: []
      });
    }
    employeeMap.get(key).shifts.push({
      start_time: row.start_time,
      end_time: row.end_time,
      store_location: row.store_location
    });
  }

  const roster = sortRosterEntries(Array.from(employeeMap.values()));
  return { hasManagedStore: true, roster };
}

module.exports = {
  getRosterWeek,
  validateRosterRequest,
  isWithinNavigationBounds,
  sortRosterEntries,
  filterRosterBookings,
  getRoster
};
