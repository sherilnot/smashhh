/**
 * Generate a hosting charges PDF for the client
 * Run: node scripts/generate-client-invoice.js
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const doc = new PDFDocument({ margin: 50, size: 'A4' });
const output = path.join(__dirname, '../CLIENT_HOSTING_CHARGES.pdf');
doc.pipe(fs.createWriteStream(output));

// ─── Header ─────────────────────────────────────────────────────────────────
doc.fontSize(24).font('Helvetica-Bold').text('App Hosting & Store Charges', { align: 'center' });
doc.moveDown(0.3);
doc.fontSize(11).font('Helvetica').fillColor('#666666').text('Rizins Smash — Employee Management App', { align: 'center' });
doc.moveDown(0.3);
doc.fontSize(10).text('Prepared: 22 July 2026', { align: 'center' });
doc.moveDown(1.5);

// ─── Divider ─────────────────────────────────────────────────────────────────
doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
doc.moveDown(1);

// ─── Section 1: Monthly Hosting (AWS) ───────────────────────────────────────
doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a1a').text('Monthly Hosting Charges (AWS — Sydney, Australia)');
doc.moveDown(0.5);
doc.fontSize(10).font('Helvetica').fillColor('#333333').text('Hosted on Amazon Web Services — Sydney Region (ap-southeast-2)');
doc.text('Low latency for Australian users. Enterprise-grade infrastructure.');
doc.moveDown(0.8);

// Table header
const tableTop = doc.y;
const col1 = 50, col2 = 280, col3 = 400, col4 = 490;

doc.font('Helvetica-Bold').fontSize(10).fillColor('#444444');
doc.text('Item', col1, tableTop);
doc.text('Specs', col2, tableTop);
doc.text('Frequency', col3, tableTop);
doc.text('Cost (USD)', col4, tableTop);
doc.moveDown(0.3);
doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#dddddd');
doc.moveDown(0.5);

// Table rows
const rows = [
  ['EC2 Application Server', '1 vCPU, 1GB RAM, 8GB SSD', 'Monthly', '$8.50'],
  ['RDS PostgreSQL Database', '1 vCPU, 1GB RAM, 20GB storage', 'Monthly', '$13.00'],
  ['Automated Daily Backups', 'Database snapshots, 7-day retention', 'Included', '$0.00'],
  ['SSL Certificate (Let\'s Encrypt)', 'HTTPS encryption, auto-renews', 'Included', '$0.00'],
  ['Data Transfer (outbound)', '100GB/month included', 'Included', '$0.00'],
  ['Push Notifications (VAPID)', 'Unlimited notifications', 'Included', '$0.00'],
];

doc.font('Helvetica').fontSize(9.5).fillColor('#333333');
rows.forEach(row => {
  const y = doc.y;
  doc.text(row[0], col1, y, { width: 220 });
  doc.text(row[1], col2, y, { width: 110 });
  doc.text(row[2], col3, y);
  doc.text(row[3], col4, y);
  doc.moveDown(0.9);
});

// Subtotal
doc.moveDown(0.3);
doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#dddddd');
doc.moveDown(0.5);
doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a1a1a');
doc.text('Monthly Hosting Total', col1, doc.y);
doc.text('$21.50 USD/month', col4 - 30, doc.y);
doc.moveDown(0.3);
doc.font('Helvetica').fontSize(9).fillColor('#666666');
doc.text('(Approximately AUD $33/month)', col1);
doc.moveDown(1.5);

// ─── Section 2: Annual Charges ──────────────────────────────────────────────
doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a1a').text('Annual Charges');
doc.moveDown(0.5);

const annualTop = doc.y;
doc.font('Helvetica-Bold').fontSize(10).fillColor('#444444');
doc.text('Item', col1, annualTop);
doc.text('Description', col2, annualTop);
doc.text('Frequency', col3, annualTop);
doc.text('Cost (USD)', col4, annualTop);
doc.moveDown(0.3);
doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#dddddd');
doc.moveDown(0.5);

const annualRows = [
  ['Domain Name (.com.au)', 'Custom URL + privacy policy host', 'Annual', '~$15.00'],
  ['Apple Developer Program', 'iOS App Store listing', 'Annual', '$99.00'],
];

doc.font('Helvetica').fontSize(9.5).fillColor('#333333');
annualRows.forEach(row => {
  const y = doc.y;
  doc.text(row[0], col1, y, { width: 220 });
  doc.text(row[1], col2, y, { width: 110 });
  doc.text(row[2], col3, y);
  doc.text(row[3], col4, y);
  doc.moveDown(0.9);
});

doc.moveDown(0.3);
doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#dddddd');
doc.moveDown(0.5);
doc.font('Helvetica-Bold').fontSize(11).fillColor('#1a1a1a');
doc.text('Annual Charges Total', col1, doc.y);
doc.text('~$114.00 USD/year', col4 - 30, doc.y);
doc.moveDown(0.3);
doc.font('Helvetica').fontSize(9).fillColor('#666666');
doc.text('(Approximately AUD $175/year)', col1);
doc.moveDown(1.5);

// ─── Section 3: Total Summary ───────────────────────────────────────────────
doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a1a').text('Annual Total');
doc.moveDown(0.8);

// Summary box
const boxY = doc.y;
doc.rect(50, boxY, 495, 85).fill('#f8f8f8').stroke('#e0e0e0');

doc.font('Helvetica').fontSize(10).fillColor('#333333');
doc.text('Monthly hosting ($21.50 × 12 months):', 70, boxY + 15);
doc.font('Helvetica-Bold').text('$258.00 USD', 420, boxY + 15);

doc.font('Helvetica').text('Annual fees (domain + Apple):', 70, boxY + 35);
doc.font('Helvetica-Bold').text('$114.00 USD', 420, boxY + 35);

doc.moveTo(70, boxY + 55).lineTo(525, boxY + 55).stroke('#cccccc');

doc.font('Helvetica-Bold').fontSize(13).fillColor('#1a1a1a');
doc.text('Total per year:', 70, boxY + 63);
doc.text('~$372 USD (~AUD $573)', 370, boxY + 63);

doc.y = boxY + 100;
doc.moveDown(1.5);

// ─── Section 4: What's Included ─────────────────────────────────────────────
doc.fontSize(14).font('Helvetica-Bold').fillColor('#1a1a1a').text('What\'s Included');
doc.moveDown(0.5);

const included = [
  'Native app on iOS App Store and Google Play Store',
  'Application server running 24/7 in Sydney, Australia',
  'Managed PostgreSQL database with automated daily backups',
  'SSL/HTTPS encryption for all data transmission',
  'Push notifications for shift reminders and roster updates',
  'Employee shift booking and manager approval system',
  'Weekly roster, timesheet generation, and wage calculation',
  'Invoices, cash reports, and maintenance reports',
  'Supports 100+ concurrent users',
  'All data stored securely in Australia (Sydney region)',
  'Data exportable at any time — no vendor lock-in'
];

doc.font('Helvetica').fontSize(9.5).fillColor('#333333');
included.forEach(item => {
  doc.text(`  ✓  ${item}`, col1);
  doc.moveDown(0.4);
});

doc.moveDown(1);

// ─── Footer ─────────────────────────────────────────────────────────────────
doc.moveTo(50, doc.y).lineTo(545, doc.y).stroke('#cccccc');
doc.moveDown(0.5);
doc.fontSize(8).font('Helvetica').fillColor('#999999');
doc.text('Notes:', col1);
doc.text('• All prices in USD. AUD estimates based on 1 USD ≈ 1.54 AUD.', col1);
doc.text('• AWS hosting billed monthly to card on file.', col1);
doc.text('• Apple Developer Program billed annually by Apple directly.', col1);
doc.text('• Google Play Store: one-time $25 USD fee (already paid).', col1);
doc.text('• No lock-in contracts. Infrastructure can be migrated at any time.', col1);
doc.text('• App updates, new features, and ongoing maintenance billed separately.', col1);

doc.end();
console.log(`PDF generated: ${output}`);
