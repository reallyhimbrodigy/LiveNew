// This script creates placeholder icon files
// For production, replace these with your actual designed icons

const fs = require('fs');
const path = require('path');

const SVG_1024 = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="#0f0d0a"/>
  <text x="512" y="620" text-anchor="middle" font-family="Georgia, serif" font-size="480" font-weight="600" fill="#c4a86c">L</text>
</svg>`;

const SVG_SPLASH = `<svg xmlns="http://www.w3.org/2000/svg" width="1284" height="2778" viewBox="0 0 1284 2778">
  <rect width="1284" height="2778" fill="#0f0d0a"/>
  <text x="642" y="1340" text-anchor="middle" font-family="Georgia, serif" font-size="120" font-weight="500" letter-spacing="8" fill="#c4a86c">LiveNew</text>
  <text x="642" y="1420" text-anchor="middle" font-family="sans-serif" font-size="36" fill="#8a8070">Your daily cortisol regulation plan</text>
</svg>`;

// Write SVGs (you'll need to convert to PNG for production)
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'icon.svg'), SVG_1024);
fs.writeFileSync(path.join(__dirname, '..', 'assets', 'splash.svg'), SVG_SPLASH);

console.log('Icon SVGs generated in assets/');
console.log('');
console.log('IMPORTANT: Convert these to PNG before building:');
console.log('  assets/icon.svg  -> assets/icon.png (1024x1024)');
console.log('  assets/splash.svg -> assets/splash.png (1284x2778)');
console.log('  assets/icon.svg  -> assets/adaptive-icon.png (1024x1024)');
console.log('');
console.log('You can convert using any tool:');
console.log('  - https://cloudconvert.com/svg-to-png');
console.log('  - Figma (paste SVG, export as PNG)');
console.log('  - macOS Preview (open SVG, export as PNG)');
