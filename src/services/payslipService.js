const { pool } = require('../config/database');
const PDFDocument = require('pdfkit');

/**
 * Payslip Service
 *
 * Generates weekly payslips for employees based on timesheet data.
 * Payroll manager can edit tax per employee before sending.
 * Employees download their payslip PDFs.
 */

/** Australian financial year runs 1 Jul → 30 Jun. */
function fyBounds() {
  const now = new Date();
  const year = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return {
    start: `${year}-07-01`,
    end: `${year + 1}-06-30`
  };
}

/**
 * Generate payslips for all employees in a given week.
 * Uses timesheet entries to calculate hours. Tax is computed from the
 * employee's stored rate but can be overridden afterwards.
 */
async function generateWeeklyPayslips(weekStart, weekEnd, paymentDate, generatedBy) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get all employees with completed timesheet entries for this week
    const entriesRes = await client.query(
      `SELECT u.id AS employee_id, u.first_name, u.last_name,
              u.hourly_wage, u.annual_salary, u.tax_rate, u.address,
              u.bsb, u.account_number, u.super_fund_name, u.super_fund_usi,
              sea.store_id,
              SUM(te.hours_worked) AS total_hours
       FROM timesheet_entries te
       JOIN timesheets t ON t.id = te.timesheet_id
       JOIN users u ON u.id = te.employee_id
       JOIN store_employee_assignments sea ON sea.employee_id = u.id
       WHERE t.week_start = $1
       GROUP BY u.id, u.first_name, u.last_name, u.hourly_wage, u.annual_salary,
                u.tax_rate, u.address, u.bsb, u.account_number,
                u.super_fund_name, u.super_fund_usi, sea.store_id`,
      [weekStart]
    );

    if (entriesRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, error: 'No timesheet entries found for this week' };
    }

    const fy = fyBounds();
    const payslips = [];

    for (const emp of entriesRes.rows) {
      const hours = Math.round((parseFloat(emp.total_hours) || 0) * 100) / 100;
      const rate = parseFloat(emp.hourly_wage) || 0;
      const gross = Math.round(hours * rate * 100) / 100;
      const taxRate = parseFloat(emp.tax_rate) || 0;
      const tax = Math.round(gross * taxRate * 100) / 100;
      const superRate = 0.115;
      const superAmt = Math.round(gross * superRate * 100) / 100;
      const net = Math.round((gross - tax) * 100) / 100;

      // YTD: sum all prior payslips in this FY + current
      const ytdRes = await client.query(
        `SELECT COALESCE(SUM(gross_pay), 0) AS ytd_gross,
                COALESCE(SUM(tax_amount), 0) AS ytd_tax,
                COALESCE(SUM(super_amount), 0) AS ytd_super
         FROM payslips
         WHERE employee_id = $1
           AND week_start >= $2 AND week_start <= $3
           AND week_start != $4`,
        [emp.employee_id, fy.start, fy.end, weekStart]
      );

      const ytdGross = Math.round((parseFloat(ytdRes.rows[0].ytd_gross) + gross) * 100) / 100;
      const ytdTax = Math.round((parseFloat(ytdRes.rows[0].ytd_tax) + tax) * 100) / 100;
      const ytdSuper = Math.round((parseFloat(ytdRes.rows[0].ytd_super) + superAmt) * 100) / 100;

      // Upsert payslip
      await client.query(
        `INSERT INTO payslips (employee_id, store_id, week_start, week_end, payment_date,
                               ordinary_hours, hourly_rate, gross_pay,
                               tax_amount, super_rate, super_amount, net_pay,
                               ytd_gross, ytd_tax, ytd_super,
                               status, generated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'draft', $16)
         ON CONFLICT (employee_id, week_start)
         DO UPDATE SET
           week_end = $4, payment_date = $5,
           ordinary_hours = $6, hourly_rate = $7, gross_pay = $8,
           tax_amount = $9, super_rate = $10, super_amount = $11, net_pay = $12,
           ytd_gross = $13, ytd_tax = $14, ytd_super = $15,
           status = 'draft', generated_by = $16`,
        [emp.employee_id, emp.store_id, weekStart, weekEnd, paymentDate,
         hours, rate, gross, tax, superRate, superAmt, net,
         ytdGross, ytdTax, ytdSuper, generatedBy]
      );

      payslips.push({
        employeeId: emp.employee_id,
        name: `${emp.first_name} ${emp.last_name || ''}`.trim(),
        hours, rate, gross, tax, superAmt, net
      });
    }

    await client.query('COMMIT');
    return { success: true, payslips, count: payslips.length };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[PayslipService] generateWeeklyPayslips error', error);
    return { success: false, error: 'Failed to generate payslips' };
  } finally {
    client.release();
  }
}

/**
 * Get all payslips for a given week (for payroll manager review/edit).
 */
async function getWeekPayslips(weekStart) {
  const res = await pool.query(
    `SELECT p.*, u.first_name, u.last_name, u.address, u.bsb, u.account_number,
            u.super_fund_name, u.super_fund_usi, u.annual_salary,
            s.name AS store_name
     FROM payslips p
     JOIN users u ON u.id = p.employee_id
     JOIN stores s ON s.id = p.store_id
     WHERE p.week_start = $1
     ORDER BY s.name, u.first_name`,
    [weekStart]
  );
  return res.rows;
}

/**
 * Update tax amount for a single payslip (payroll manager edits).
 * Recalculates net pay automatically.
 */
async function updatePayslipTax(payslipId, newTaxAmount) {
  const tax = Math.round((parseFloat(newTaxAmount) || 0) * 100) / 100;
  const res = await pool.query(
    `UPDATE payslips SET
       tax_amount = $1,
       net_pay = gross_pay - $1
     WHERE id = $2 RETURNING *`,
    [tax, payslipId]
  );
  if (res.rows.length === 0) return { success: false, error: 'Payslip not found' };
  return { success: true, payslip: res.rows[0] };
}

/**
 * Update super rate for a single payslip.
 */
async function updatePayslipSuper(payslipId, newSuperRate) {
  const rate = Math.min(1, Math.max(0, parseFloat(newSuperRate) || 0.115));
  const res = await pool.query(
    `UPDATE payslips SET
       super_rate = $1,
       super_amount = ROUND(gross_pay * $1, 2)
     WHERE id = $2 RETURNING *`,
    [rate, payslipId]
  );
  if (res.rows.length === 0) return { success: false, error: 'Payslip not found' };
  return { success: true, payslip: res.rows[0] };
}

/**
 * Mark payslips as sent for a given week.
 */
async function sendWeekPayslips(weekStart) {
  const res = await pool.query(
    `UPDATE payslips SET status = 'sent', sent_at = NOW()
     WHERE week_start = $1 AND status = 'draft'
     RETURNING id`,
    [weekStart]
  );
  return { success: true, count: res.rowCount };
}

/**
 * Get payslips for a specific employee (their history).
 */
async function getEmployeePayslips(employeeId) {
  const res = await pool.query(
    `SELECT p.*, s.name AS store_name
     FROM payslips p
     JOIN stores s ON s.id = p.store_id
     WHERE p.employee_id = $1 AND p.status = 'sent'
     ORDER BY p.week_start DESC
     LIMIT 52`,
    [employeeId]
  );
  return res.rows;
}

/**
 * Get a single payslip by ID (for PDF generation).
 */
async function getPayslipById(payslipId) {
  const res = await pool.query(
    `SELECT p.*, u.first_name, u.last_name, u.address, u.bsb, u.account_number,
            u.super_fund_name, u.super_fund_usi, u.annual_salary,
            s.name AS store_name
     FROM payslips p
     JOIN users u ON u.id = p.employee_id
     JOIN stores s ON s.id = p.store_id
     WHERE p.id = $1`,
    [payslipId]
  );
  if (res.rows.length === 0) return null;
  return res.rows[0];
}

/**
 * Generate a PDF payslip matching the Rizins format.
 */
function generatePayslipPdf(slip) {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });

  const black = '#1a1a1a';
  const gray = '#555';
  const lightGray = '#888';
  const lineColor = '#ccc';
  const leftX = 40;
  const rightX = doc.page.width - 40;
  const pageWidth = rightX - leftX;

  const storeName = slip.store_name || 'Rizins';
  const empName = `${slip.first_name} ${slip.last_name || ''}`.trim();

  // ─── Paid By box (top right) ─────────────────────────────────────
  const paidByX = 340;
  const paidByY = 50;
  doc.fontSize(8).font('Helvetica-Bold').fillColor(black)
    .text('PAID BY', paidByX, paidByY);
  doc.fontSize(8).font('Helvetica').fillColor(gray)
    .text(`Rizins burgers ${storeName.toLowerCase()} pty ltd`, paidByX, paidByY + 12)
    .text('16 Adelaide St', paidByX, paidByY + 23)
    .text('DANDENONG VIC 3175', paidByX, paidByY + 34)
    .text('ABN 53 462 892 383', paidByX, paidByY + 45);

  // ─── Employment Details box ──────────────────────────────────────
  const empDetY = paidByY + 70;
  doc.fontSize(8).font('Helvetica-Bold').fillColor(black)
    .text('EMPLOYMENT DETAILS', paidByX, empDetY);
  doc.fontSize(8).font('Helvetica').fillColor(gray)
    .text('Pay Frequency: Weekly', paidByX, empDetY + 12)
    .text(`Annual Salary: $${Number(slip.annual_salary || 0).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`, paidByX, empDetY + 23);

  // ─── Employee details (left) ─────────────────────────────────────
  const empY = 120;
  doc.fontSize(11).font('Helvetica-Bold').fillColor(black)
    .text(empName, leftX, empY);
  doc.fontSize(9).font('Helvetica').fillColor(gray)
    .text(slip.address || '', leftX, empY + 16);

  // ─── Pay period bar ──────────────────────────────────────────────
  const barY = 220;
  doc.moveTo(leftX, barY).lineTo(rightX, barY).strokeColor(lineColor).lineWidth(0.5).stroke();

  const formatAU = (d) => {
    if (!d) return '';
    const dt = new Date(d);
    return `${String(dt.getDate()).padStart(2, '0')}/${String(dt.getMonth() + 1).padStart(2, '0')}/${dt.getFullYear()}`;
  };

  doc.fontSize(7.5).font('Helvetica').fillColor(lightGray);
  doc.text(`Pay Period: ${formatAU(slip.week_start)} - ${formatAU(slip.week_end)}`, leftX, barY + 6);
  doc.text(`Payment Date: ${formatAU(slip.payment_date)}`, leftX + 160, barY + 6);
  doc.font('Helvetica-Bold').fillColor(black);
  doc.text(`Total Earnings: $${Number(slip.gross_pay).toFixed(2)}`, leftX + 310, barY + 6);
  doc.text(`Net Pay: $${Number(slip.net_pay).toFixed(2)}`, leftX + 430, barY + 6);

  doc.moveTo(leftX, barY + 20).lineTo(rightX, barY + 20).strokeColor(lineColor).lineWidth(0.5).stroke();

  // ─── Column headers ──────────────────────────────────────────────
  let y = barY + 30;
  const colRate = 240;
  const colThis = 360;
  const colYtd = 450;

  doc.fontSize(7).font('Helvetica-Bold').fillColor(lightGray)
    .text('THIS PAY', colThis, y, { width: 70, align: 'right' })
    .text('YTD', colYtd, y, { width: 70, align: 'right' });

  // ─── Salary & Wages ──────────────────────────────────────────────
  y += 18;
  doc.fontSize(9).font('Helvetica-Bold').fillColor(black)
    .text('SALARY & WAGES', leftX, y);
  y += 16;
  doc.fontSize(8).font('Helvetica').fillColor(gray)
    .text('Ordinary Hours', leftX + 10, y)
    .text(`${Number(slip.ordinary_hours).toFixed(4)}`, leftX + 130, y)
    .text(`RATE`, colRate - 40, y)
    .text(`$${Number(slip.hourly_rate).toFixed(4)}`, colRate, y);
  doc.font('Helvetica').fillColor(black)
    .text(`$${Number(slip.gross_pay).toFixed(2)}`, colThis, y, { width: 70, align: 'right' })
    .text(`$${Number(slip.ytd_gross).toFixed(2)}`, colYtd, y, { width: 70, align: 'right' });

  y += 20;
  doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor(lineColor).lineWidth(0.3).stroke();
  y += 6;
  doc.fontSize(8).font('Helvetica-Bold').fillColor(black)
    .text('TOTAL', colRate, y)
    .text(`$${Number(slip.gross_pay).toFixed(2)}`, colThis, y, { width: 70, align: 'right' })
    .text(`$${Number(slip.ytd_gross).toFixed(2)}`, colYtd, y, { width: 70, align: 'right' });

  // ─── Tax ─────────────────────────────────────────────────────────
  y += 25;
  doc.fontSize(9).font('Helvetica-Bold').fillColor(black)
    .text('TAX', leftX, y);
  y += 16;
  doc.fontSize(8).font('Helvetica').fillColor(gray)
    .text('PAYG', leftX + 10, y);
  doc.font('Helvetica').fillColor(black)
    .text(`$${Number(slip.tax_amount).toFixed(2)}`, colThis, y, { width: 70, align: 'right' })
    .text(`$${Number(slip.ytd_tax).toFixed(2)}`, colYtd, y, { width: 70, align: 'right' });

  y += 20;
  doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor(lineColor).lineWidth(0.3).stroke();
  y += 6;
  doc.fontSize(8).font('Helvetica-Bold').fillColor(black)
    .text('TOTAL', colRate, y)
    .text(`$${Number(slip.tax_amount).toFixed(2)}`, colThis, y, { width: 70, align: 'right' })
    .text(`$${Number(slip.ytd_tax).toFixed(2)}`, colYtd, y, { width: 70, align: 'right' });

  // ─── Superannuation ──────────────────────────────────────────────
  y += 25;
  doc.fontSize(9).font('Helvetica-Bold').fillColor(black)
    .text('SUPERANNUATION', leftX, y);
  y += 16;
  doc.fontSize(8).font('Helvetica').fillColor(gray)
    .text(`${slip.super_fund_name || 'SGC'} - ${slip.super_fund_usi || ''}`, leftX + 10, y);
  doc.font('Helvetica').fillColor(black)
    .text(`$${Number(slip.super_amount).toFixed(2)}`, colThis, y, { width: 70, align: 'right' })
    .text(`$${Number(slip.ytd_super).toFixed(2)}`, colYtd, y, { width: 70, align: 'right' });

  y += 20;
  doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor(lineColor).lineWidth(0.3).stroke();
  y += 6;
  doc.fontSize(8).font('Helvetica-Bold').fillColor(black)
    .text('TOTAL', colRate, y)
    .text(`$${Number(slip.super_amount).toFixed(2)}`, colThis, y, { width: 70, align: 'right' })
    .text(`$${Number(slip.ytd_super).toFixed(2)}`, colYtd, y, { width: 70, align: 'right' });

  // ─── Payment Details ─────────────────────────────────────────────
  y += 30;
  doc.moveTo(leftX, y).lineTo(rightX, y).strokeColor(lineColor).lineWidth(0.5).stroke();
  y += 8;
  doc.fontSize(9).font('Helvetica-Bold').fillColor(black)
    .text('PAYMENT DETAILS', leftX, y);

  const bsb = slip.bsb || '000-000';
  const acct = slip.account_number || '00000000';
  // Mask account: show last 4
  const masked = `(${bsb})****${acct.slice(-4)}`;

  doc.fontSize(7).font('Helvetica-Bold').fillColor(lightGray)
    .text('REFERENCE', colRate, y)
    .text('AMOUNT', colYtd, y, { width: 70, align: 'right' });

  y += 16;
  doc.fontSize(8).font('Helvetica').fillColor(gray)
    .text(masked, leftX + 10, y)
    .text(empName, leftX + 120, y)
    .text(`Rizins ${storeName}`, colRate, y);
  doc.font('Helvetica-Bold').fillColor(black)
    .text(`$${Number(slip.net_pay).toFixed(2)}`, colYtd, y, { width: 70, align: 'right' });

  doc.end();
  return doc;
}

module.exports = {
  generateWeeklyPayslips,
  getWeekPayslips,
  updatePayslipTax,
  updatePayslipSuper,
  sendWeekPayslips,
  getEmployeePayslips,
  getPayslipById,
  generatePayslipPdf
};
