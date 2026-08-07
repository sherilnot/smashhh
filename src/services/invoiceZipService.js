const archiver = require('archiver');
const { generateInvoicePdf } = require('./invoicePdfService');

/**
 * Invoice ZIP Service
 *
 * Bundles a set of invoices into a single ZIP download, one PDF per invoice,
 * organised into folders by store:
 *
 *   invoices_Seaford_2026-08.zip
 *     └── Seaford/
 *         ├── 2026-08-01_Seaford_A1B2C3D4.pdf
 *         ├── 2026-08-02_Seaford_E5F6G7H8.pdf
 *         └── ...
 *
 * The archive is streamed straight to the response, so memory use stays flat
 * regardless of how many invoices are in the range.
 */

/** Normalise a DB date (Date object or string) to YYYY-MM-DD. */
function toDateOnly(value) {
  if (!value) return 'unknown-date';
  if (typeof value === 'string') return value.substring(0, 10);
  const d = new Date(value);
  if (isNaN(d.getTime())) return 'unknown-date';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Strip characters that are awkward inside archive entry names. */
function safeName(value, fallback) {
  const cleaned = String(value || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

/**
 * Stream a ZIP of invoice PDFs to an Express response.
 *
 * @param {import('express').Response} res
 * @param {Array<object>} invoices - Each needs store_name, invoice_date, id, items
 * @param {string} filename - Download filename, e.g. invoices_Seaford_2026-08.zip
 * @param {object} [options]
 * @param {string} [options.period] - 'week' or 'month'; used in the folder name
 * @returns {Promise<void>} resolves once the archive has been fully written
 */
function streamInvoiceZip(res, invoices, filename, options = {}) {
  const periodWord = options.period === 'month' ? 'Month' : 'Week';
  return new Promise((resolve, reject) => {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });

    // A missing file inside the archive is worth logging but shouldn't abort
    // the whole download.
    archive.on('warning', (err) => {
      console.warn('[InvoiceZip] warning', err.message);
    });
    archive.on('error', reject);
    archive.on('end', resolve);

    archive.pipe(res);

    // Guard against duplicate entry names (two invoices same store + date).
    const usedNames = new Set();

    invoices.forEach((invoice) => {
      // Folder is "<Store> - Week" / "<Store> - Month". Spaces and the hyphen
      // are kept here because it's a display folder name, not a filename.
      const storeLabel = String(invoice.store_name || 'Store').trim() || 'Store';
      const folder = `${storeLabel} - ${periodWord}`;

      const store = safeName(invoice.store_name, 'store');
      const date = toDateOnly(invoice.invoice_date);
      const shortId = String(invoice.id || '').substring(0, 8).toUpperCase();

      let entry = `${folder}/${date}_${store}_${shortId}.pdf`;
      let suffix = 2;
      while (usedNames.has(entry)) {
        entry = `${folder}/${date}_${store}_${shortId}_${suffix}.pdf`;
        suffix++;
      }
      usedNames.add(entry);

      // generateInvoicePdf returns a readable stream (PDFKit document).
      archive.append(generateInvoicePdf(invoice), { name: entry });
    });

    // If there's nothing to bundle, include a short note so the user gets a
    // valid archive rather than a confusing empty or corrupt file.
    if (invoices.length === 0) {
      archive.append(
        'No submitted invoices were found for the selected period.\n',
        { name: 'README.txt' }
      );
    }

    archive.finalize();
  });
}

module.exports = { streamInvoiceZip, toDateOnly, safeName };
