/**
 * Generate simple PNG icons for the PWA manifest.
 * Run: node scripts/generate-icons.js
 *
 * This creates minimal burger-themed icons. Replace with real assets when ready.
 */
const fs = require('fs');
const path = require('path');

// Simple SVG burger icon with the brand colors
function makeSVG(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${Math.round(size * 0.18)}" fill="#1a1a1a"/>
  <g transform="translate(${size * 0.2}, ${size * 0.2}) scale(${size * 0.6 / 24})">
    <path d="M6 13.87A4 4 0 0 1 7.41 6a5.11 5.11 0 0 1 1.05-1.54 5 5 0 0 1 7.08 0A5.11 5.11 0 0 1 16.59 6 4 4 0 0 1 18 13.87V21H6Z" fill="none" stroke="#f4a300" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <line x1="6" x2="18" y1="17" y2="17" stroke="#f4a300" stroke-width="2" stroke-linecap="round"/>
  </g>
</svg>`;
}

const iconsDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

// Write SVG files (browsers accept SVG icons, and we provide these as fallback)
[192, 512].forEach(size => {
  const svg = makeSVG(size);
  fs.writeFileSync(path.join(iconsDir, `icon-${size}.svg`), svg);
  console.log(`Created icon-${size}.svg`);
});

console.log('\nNote: For production, convert these SVGs to PNG using any image tool.');
console.log('For now, update manifest.json to use SVG or provide real PNG files.');
