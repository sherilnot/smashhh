/**
 * Export Service
 * Builds CSV (Excel-compatible) exports for timesheets and invoices.
 */

const FULL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Escape a value for CSV. */
function esc(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Turn a 2D array into a CSV string with a UTF-8 BOM (so Excel opens it correctly). */
function toCsv(rows) {
  return '\uFEFF' + rows.map(r => r.map(esc).join(',')).join('\r\n');
}

function shortDate(dateStr) {
  const dp = String(dateStr).substring(0, 10).split('-');
  const d = new Date(Number(dp[0]), Number(dp[1]) - 1, Number(dp[2]));
  return String(d.getDate()).padStart(2, '0') + '-' + d.toLocaleDateString('en-AU', { month: 'short' });
}

function auDate(dateStr) {
  const dp = String(dateStr).substring(0, 10).split('-');
  return `${dp[2]}/${dp[1]}/${dp[0]}`;
}

/**
 * Build a weekly timesheet CSV matching the Excel layout:
 * S.no | Employee name | Mon(Start,Finish) ... Sun(Start,Finish) | Mon-Fri Hours/Pay | Weekend Hours/Pay
 */
function buildTimesheetCsv(timesheet) {
  const rows = [];

  rows.push([`${timesheet.store_name} — Timesheet`]);
  rows.push([`Week: ${auDate(timesheet.week_start)} to ${auDate(timesheet.week_end)}`]);
  rows.push([`Status: ${timesheet.status || 'submitted'}`]);
  rows.push([]);

  // Header row 1 — dates
  const h1 = ['', ''];
  timesheet.dayDates.forEach(d => { h1.push(shortDate(d), ''); });
  h1.push('Total Hours', '', 'Total Hours', '');
  rows.push(h1);

  // Header row 2 — day names
  const h2 = ['S.no', 'Employee name'];
  FULL_DAYS.forEach(dn => { h2.push(dn, ''); });
  h2.push('Monday to Friday', '', 'Weekends', '');
  rows.push(h2);

  // Header row 3 — Start/Finish
  const h3 = ['', ''];
  for (let i = 0; i < 7; i++) h3.push('Start', 'Finish');
  h3.push('Hours', 'Pay', 'Hours', 'Pay');
  rows.push(h3);

  // Data rows
  let gWdH = 0, gWeH = 0, gWdP = 0, gWeP = 0;

  (timesheet.timesheetRows || []).forEach((row, idx) => {
    const rate = parseFloat(row.hourly_wage || 0);
    const wkndRate = row.hasOverride ? row.overrideRate : rate;
    const wdPay = row.weekdayHours * rate;
    const wePay = row.weekendHours * wkndRate;

    gWdH += row.weekdayHours;
    gWeH += row.weekendHours;
    gWdP += wdPay;
    gWeP += wePay;

    const line = [idx + 1, row.name];
    row.byDay.forEach(cell => {
      line.push(cell ? cell.startLabel : '', cell ? cell.endLabel : '');
    });
    line.push(
      row.weekdayHours > 0 ? row.weekdayHours.toFixed(2) : '',
      wdPay > 0 ? wdPay.toFixed(2) : '',
      row.weekendHours > 0 ? row.weekendHours.toFixed(2) : '',
      wePay > 0 ? wePay.toFixed(2) : ''
    );
    rows.push(line);
  });

  // Totals
  const tot = ['', 'TOTAL'];
  for (let i = 0; i < 14; i++) tot.push('');
  tot.push(gWdH.toFixed(2), gWdP.toFixed(2), gWeH.toFixed(2), gWeP.toFixed(2));
  rows.push(tot);

  rows.push([]);
  rows.push(['Grand Total Hours', (gWdH + gWeH).toFixed(2)]);
  rows.push(['Grand Total Pay', (gWdP + gWeP).toFixed(2)]);

  return toCsv(rows);
}

/**
 * Build a monthly summary CSV across many timesheets.
 * byStore: { storeName: [ { week_start, week_end, rows: [...] } ] }
 */
function buildMonthlyTimesheetCsv(monthLabel, weeks) {
  const rows = [];
  rows.push([`Monthly Timesheet Summary — ${monthLabel}`]);
  rows.push([]);

  let grandHours = 0, grandPay = 0;

  weeks.forEach(wk => {
    rows.push([`${wk.store_name} — Week ${auDate(wk.week_start)} to ${auDate(wk.week_end)}`]);

    const h1 = ['', ''];
    wk.dayDates.forEach(d => { h1.push(shortDate(d), ''); });
    h1.push('Total Hours', '', 'Total Hours', '');
    rows.push(h1);

    const h2 = ['S.no', 'Employee name'];
    FULL_DAYS.forEach(dn => { h2.push(dn, ''); });
    h2.push('Monday to Friday', '', 'Weekends', '');
    rows.push(h2);

    const h3 = ['', ''];
    for (let i = 0; i < 7; i++) h3.push('Start', 'Finish');
    h3.push('Hours', 'Pay', 'Hours', 'Pay');
    rows.push(h3);

    let wWdH = 0, wWeH = 0, wWdP = 0, wWeP = 0;

    (wk.timesheetRows || []).forEach((row, idx) => {
      const rate = parseFloat(row.hourly_wage || 0);
      const wkndRate = row.hasOverride ? row.overrideRate : rate;
      const wdPay = row.weekdayHours * rate;
      const wePay = row.weekendHours * wkndRate;

      wWdH += row.weekdayHours; wWeH += row.weekendHours;
      wWdP += wdPay; wWeP += wePay;

      const line = [idx + 1, row.name];
      row.byDay.forEach(cell => {
        line.push(cell ? cell.startLabel : '', cell ? cell.endLabel : '');
      });
      line.push(
        row.weekdayHours > 0 ? row.weekdayHours.toFixed(2) : '',
        wdPay > 0 ? wdPay.toFixed(2) : '',
        row.weekendHours > 0 ? row.weekendHours.toFixed(2) : '',
        wePay > 0 ? wePay.toFixed(2) : ''
      );
      rows.push(line);
    });

    const wTot = ['', 'Week Total'];
    for (let i = 0; i < 14; i++) wTot.push('');
    wTot.push(wWdH.toFixed(2), wWdP.toFixed(2), wWeH.toFixed(2), wWeP.toFixed(2));
    rows.push(wTot);
    rows.push([]);

    grandHours += wWdH + wWeH;
    grandPay += wWdP + wWeP;
  });

  rows.push(['MONTH TOTAL HOURS', grandHours.toFixed(2)]);
  rows.push(['MONTH TOTAL PAY', grandPay.toFixed(2)]);

  return toCsv(rows);
}

/**
 * Build an invoice CSV for a set of invoices (one store, a date range).
 */
function buildInvoicesCsv(title, invoices) {
  const rows = [];
  rows.push([title]);
  rows.push([]);

  let grandTotal = 0;

  invoices.forEach(inv => {
    rows.push([`Invoice ${String(inv.id).substring(0, 8).toUpperCase()}`, `Date: ${auDate(inv.invoice_date)}`, `Store: ${inv.store_name}`]);
    rows.push(['#', 'Description', 'Ordered', 'Received', 'Unit Price', 'Amount']);

    let invTotal = 0;
    (inv.items || []).forEach((item, idx) => {
      const price = parseFloat(item.unit_price) || 0;
      const qty = parseFloat(item.quantity_received) || 0;
      const line = price * qty;
      invTotal += line;
      rows.push([
        idx + 1,
        item.product_name + (item.is_emergency ? ' (Emergency)' : ''),
        item.quantity_ordered || '',
        qty,
        price.toFixed(2),
        line.toFixed(2)
      ]);
    });

    rows.push(['', '', '', '', 'Invoice Total', invTotal.toFixed(2)]);
    rows.push([]);
    grandTotal += invTotal;
  });

  rows.push(['', '', '', '', 'GRAND TOTAL', grandTotal.toFixed(2)]);

  return toCsv(rows);
}

module.exports = {
  toCsv,
  buildTimesheetCsv,
  buildMonthlyTimesheetCsv,
  buildInvoicesCsv
};
