#!/usr/bin/env node
/**
 * Generate the iOS app icon from the brand SVG.
 *
 * Why this exists rather than just committing a PNG:
 *
 *   - Capacitor's template ships its own logo as a placeholder, which would be
 *     an obvious mistake to upload.
 *   - App Store Connect rejects app icons that carry an alpha channel
 *     (validation error ITMS-90717), and every rasteriser available on macOS
 *     (`sips`, Preview, Quick Look) writes RGBA PNGs. So the alpha channel has
 *     to be stripped as a separate step.
 *   - The brand mark is defined as vector geometry in scripts/generate-icons.js,
 *     so rendering it at 1024px is lossless. Upscaling the existing 512px PNG
 *     would soften the strokes.
 *
 * Run: node scripts/generate-ios-icon.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const SIZE = 1024;
const OUTPUT = path.join(
  __dirname, '..', 'ios', 'App', 'App',
  'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon-512@2x.png'
);

/**
 * The brand mark, matching scripts/generate-icons.js (which produces the PWA
 * icons) so the native icon and the web icon stay identical.
 *
 * @param {number} size - Square canvas size in pixels.
 * @returns {string} SVG markup.
 */
function brandSvg(size) {
  const radius = Math.round(size * 0.18);
  const offset = size * 0.2;
  const scale = size * 0.6 / 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${radius}" fill="#1a1a1a"/>
  <g transform="translate(${offset}, ${offset}) scale(${scale})">
    <path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z" fill="none" stroke="#f4a300" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="6" x2="18" y1="17" y2="17" stroke="#f4a300" stroke-width="2" stroke-linecap="round"/>
  </g>
</svg>`;
}

/**
 * Split a PNG buffer into its chunks.
 *
 * @param {Buffer} buffer - Raw PNG file contents.
 * @returns {Array<{type: string, data: Buffer}>}
 */
function readChunks(buffer) {
  const chunks = [];
  let offset = 8; // skip the 8-byte PNG signature
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length; // length + type + data + crc
  }
  return chunks;
}

/**
 * Reverse PNG scanline filtering in place and return the raw pixel rows.
 *
 * Implements the five filter types from the PNG spec (None, Sub, Up, Average,
 * Paeth).
 *
 * @param {Buffer} raw - Decompressed IDAT data, one filter byte per scanline.
 * @param {number} width
 * @param {number} height
 * @param {number} bpp - Bytes per pixel.
 * @returns {Buffer} Unfiltered pixel data, width * height * bpp bytes.
 */
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y++) {
    const filterType = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;

    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;      // left
      const b = prev ? prev[x] : 0;               // above
      const c = prev && x >= bpp ? prev[x - bpp] : 0; // upper-left
      let value;

      switch (filterType) {
        case 0: value = line[x]; break;
        case 1: value = line[x] + a; break;
        case 2: value = line[x] + b; break;
        case 3: value = line[x] + ((a + b) >> 1); break;
        case 4: {
          // Paeth predictor
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : (pb <= pc ? b : c);
          value = line[x] + pred;
          break;
        }
        default:
          throw new Error(`Unsupported PNG filter type: ${filterType}`);
      }

      cur[x] = value & 0xff;
    }
  }

  return out;
}

/**
 * Build a length-prefixed, CRC-suffixed PNG chunk.
 *
 * @param {string} type - Four-character chunk type.
 * @param {Buffer} data
 * @returns {Buffer}
 */
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

/**
 * Re-encode an 8-bit RGBA PNG as 8-bit RGB, discarding the alpha channel.
 *
 * The brand icon is fully opaque, so dropping alpha is a lossless operation
 * here; it exists purely to satisfy App Store icon validation.
 *
 * @param {Buffer} input - RGBA PNG.
 * @returns {Buffer} RGB PNG.
 */
function stripAlpha(input) {
  const chunks = readChunks(input);

  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('PNG has no IHDR chunk.');

  const width = ihdr.data.readUInt32BE(0);
  const height = ihdr.data.readUInt32BE(4);
  const bitDepth = ihdr.data[8];
  const colorType = ihdr.data[9];
  const interlace = ihdr.data[12];

  if (colorType === 2) return input; // already RGB, nothing to do
  if (bitDepth !== 8 || colorType !== 6) {
    throw new Error(`Expected an 8-bit RGBA PNG, got bit depth ${bitDepth} / color type ${colorType}.`);
  }
  if (interlace !== 0) {
    throw new Error('Interlaced PNGs are not supported.');
  }

  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const pixels = unfilter(zlib.inflateSync(idat), width, height, 4);

  // Rebuild scanlines as RGB with filter type 0 (None).
  const rgbStride = width * 3;
  const rows = Buffer.alloc((rgbStride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (rgbStride + 1);
    rows[rowStart] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 4;
      const dst = rowStart + 1 + x * 3;
      rows[dst] = pixels[src];
      rows[dst + 1] = pixels[src + 1];
      rows[dst + 2] = pixels[src + 2];
    }
  }

  const newIhdr = Buffer.alloc(13);
  newIhdr.writeUInt32BE(width, 0);
  newIhdr.writeUInt32BE(height, 4);
  newIhdr[8] = 8; // bit depth
  newIhdr[9] = 2; // color type: truecolour, no alpha
  newIhdr[10] = 0; // deflate
  newIhdr[11] = 0; // adaptive filtering
  newIhdr[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', newIhdr),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function main() {
  if (process.platform !== 'darwin') {
    throw new Error('This script uses macOS `sips` to rasterise the SVG.');
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rizins-icon-'));
  const svgPath = path.join(tmp, 'icon.svg');
  const pngPath = path.join(tmp, 'icon.png');

  try {
    fs.writeFileSync(svgPath, brandSvg(SIZE), 'utf8');
    execFileSync('sips', ['-s', 'format', 'png', svgPath, '--out', pngPath], { stdio: 'ignore' });

    const flattened = stripAlpha(fs.readFileSync(pngPath));
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, flattened);

    console.log(`[capacitor] wrote ${SIZE}x${SIZE} opaque app icon to ${path.relative(process.cwd(), OUTPUT)}`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (error) {
  console.error(`[capacitor] ${error.message}`);
  process.exit(1);
}
