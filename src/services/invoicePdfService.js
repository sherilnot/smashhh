const PDFDocument = require('pdfkit');

/**
 * Generate a professional invoice PDF matching the Flavio PTY LTD Excel format.
 * Returns a readable stream.
 * @param {object} invoice
 * @param {object} [options]
 * @param {string} [options.watermark] - Optional watermark text (e.g. 'DRAFT')
 */
function generateInvoicePdf(invoice, options = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 50 });

  const navy = '#1b2a5e';
  const black = '#1a1a2e';
  const gray = '#555555';
  const lightBg = '#f4f6fb';
  const white = '#ffffff';

  const pageWidth = doc.page.width - 100; // margins
  const leftX = 50;
  const rightX = doc.page.width - 50;

  // ─── Header: Company Name + INVOICE ───────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(20).fillColor(navy)
    .text('FLAVIO PTY LTD', leftX, 50);

  doc.font('Helvetica-Bold').fontSize(28).fillColor(navy)
    .text('INVOICE', leftX, 50, { align: 'right' });

  // ─── Address ──────────────────────────────────────────────────────────────
  doc.font('Helvetica').fontSize(10).fillColor(gray)
    .text('16 Adelaide st', leftX, 78)
    .text('Dandenong VIC 3175', leftX, 91);

  // ─── Separator line ───────────────────────────────────────────────────────
  doc.moveTo(leftX, 112).lineTo(rightX, 112).strokeColor(navy).lineWidth(2).stroke();

  // ─── Bill To + Invoice # + Date ───────────────────────────────────────────
  const metaY = 125;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(navy)
    .text('BILL TO', leftX, metaY);

  // Store address mapping
  const storeAddresses = {
    'Seaford': '6/366 Frankston-Dandenong Rd, Seaford VIC 3198',
    'Dandenong': '16 Adelaide St, Dandenong VIC 3175',
    'Mitcham': '454 Whitehorse Rd, Mitcham VIC 3132',
    'Frankston': '123 Wells St, Frankston VIC 3199'
  };

  const storeName = invoice.store_name || invoice.storeName || '';
  const billTo = `Rizins Burgers ${storeName}`;
  const address = storeAddresses[storeName] || '';

  doc.font('Helvetica').fontSize(10).fillColor(black)
    .text(billTo, leftX, metaY + 14)
    .text(address, leftX, metaY + 27);

  // Invoice # and Date on the right
  const invoiceNum = invoice.invoice_number || invoice.id.substring(0, 8).toUpperCase();
  const invoiceDate = (() => {
    const d = invoice.invoice_date;
    if (!d) return '';
    // Handle both Date object and ISO string (YYYY-MM-DD)
    const parsed = typeof d === 'string' ? new Date(d + 'T00:00:00') : new Date(d);
    return parsed.toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  })();

  const metaRightX = 380;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(navy)
    .text('INVOICE #', metaRightX, metaY);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(navy)
    .text('DATE', metaRightX + 120, metaY);

  doc.font('Helvetica').fontSize(10).fillColor(black)
    .text(invoiceNum, metaRightX, metaY + 14);
  doc.font('Helvetica').fontSize(10).fillColor(black)
    .text(invoiceDate, metaRightX + 120, metaY + 14);

  // ─── Table ────────────────────────────────────────────────────────────────
  const tableTop = metaY + 55;
  const colWidths = {
    desc: 180,
    qty: 60,
    price: 90,
    gst: 60,
    amount: 100
  };
  const colX = {
    desc: leftX,
    qty: leftX + colWidths.desc,
    price: leftX + colWidths.desc + colWidths.qty,
    gst: leftX + colWidths.desc + colWidths.qty + colWidths.price,
    amount: leftX + colWidths.desc + colWidths.qty + colWidths.price + colWidths.gst
  };
  const tableWidth = colWidths.desc + colWidths.qty + colWidths.price + colWidths.gst + colWidths.amount;
  const rowHeight = 22;

  // Header row
  doc.rect(leftX, tableTop, tableWidth, rowHeight + 4).fill(navy);
  doc.font('Helvetica-Bold').fontSize(8).fillColor(white);
  doc.text('DESCRIPTION', colX.desc + 6, tableTop + 7);
  doc.text('QTY', colX.qty + 6, tableTop + 7, { width: colWidths.qty - 12, align: 'center' });
  doc.text('UNIT PRICE', colX.price + 6, tableTop + 7, { width: colWidths.price - 12, align: 'center' });
  doc.text('GST', colX.gst + 6, tableTop + 7, { width: colWidths.gst - 12, align: 'center' });
  doc.text('AMOUNT', colX.amount + 6, tableTop + 7, { width: colWidths.amount - 12, align: 'right' });

  // Data rows
  let y = tableTop + rowHeight + 4;
  let grandTotal = 0;
  let rowIdx = 0;

  const items = (invoice.items || []).filter(item => {
    // Include all items — even qty=0 ones (manager may not have filled them yet)
    return item.item_notes !== 'NOT SELECTED';
  });

  items.forEach((item) => {
    const price = parseFloat(item.unit_price) || 0;
    const qty = parseFloat(item.quantity_received) || 0;
    const lineTotal = price * qty;
    grandTotal += lineTotal;

    // Alternating row background
    const bg = rowIdx % 2 === 0 ? lightBg : white;
    doc.rect(leftX, y, tableWidth, rowHeight).fill(bg);

    doc.font('Helvetica').fontSize(9).fillColor(black);
    doc.text(item.product_name || '', colX.desc + 6, y + 6, { width: colWidths.desc - 12 });
    doc.text(qty ? String(qty) : '', colX.qty + 6, y + 6, { width: colWidths.qty - 12, align: 'center' });
    doc.text(`$ ${price.toFixed(2)}`, colX.price + 6, y + 6, { width: colWidths.price - 12, align: 'center' });
    doc.fillColor('#999999').text('-', colX.gst + 6, y + 6, { width: colWidths.gst - 12, align: 'center' });
    doc.fillColor(black).font('Helvetica-Bold')
      .text(lineTotal > 0 ? lineTotal.toFixed(2) : '-', colX.amount + 6, y + 6, { width: colWidths.amount - 12, align: 'right' });

    // Row border
    doc.moveTo(leftX, y + rowHeight).lineTo(leftX + tableWidth, y + rowHeight)
      .strokeColor('#e0e4ef').lineWidth(0.5).stroke();

    y += rowHeight;
    rowIdx++;
  });

  // Total row
  y += 4;
  doc.moveTo(leftX, y).lineTo(leftX + tableWidth, y).strokeColor(navy).lineWidth(2).stroke();
  y += 8;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(navy)
    .text('TOTAL', leftX, y, { width: tableWidth - colWidths.amount - 12, align: 'right' });
  doc.text(`$ ${grandTotal.toFixed(2)}`, colX.amount + 6, y, { width: colWidths.amount - 12, align: 'right' });

  // Notes
  if (invoice.notes) {
    y += 35;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(navy).text('Notes:', leftX, y);
    doc.font('Helvetica').fontSize(9).fillColor(gray).text(invoice.notes, leftX + 40, y, { width: pageWidth - 40 });
  }

  // Watermark (e.g. "DRAFT")
  if (options.watermark) {
    doc.save();
    doc.opacity(0.08);
    doc.font('Helvetica-Bold').fontSize(110).fillColor(navy);
    doc.rotate(-45, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.text(options.watermark, 0, doc.page.height / 2 - 60, {
      width: doc.page.width,
      align: 'center'
    });
    doc.restore();
  }

  doc.end();
  return doc;
}

module.exports = { generateInvoicePdf };
