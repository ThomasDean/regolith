// Renders the PWA icons (public/icons/*.png) from the hex mark in index.html's favicon.
// Run `node scripts/make-icons.mjs` after changing the artwork; the PNGs are committed.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BG = '#1d2840';
const HEX = '#c79a62';

// `pad` is the empty margin around the hex as a fraction of the icon. Maskable icons need a
// bigger one: platforms crop them to a circle or rounded square, keeping the middle 80%.
const svg = (size, pad) => {
  const r = (size * (1 - pad * 2)) / 2;
  const c = size / 2;
  const pts = [-90, -30, 30, 90, 150, 210].map((d) => {
    const a = (d * Math.PI) / 180;
    return `${(c + r * Math.cos(a)).toFixed(1)},${(c + r * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  const inner = r * 0.46;
  const ipts = [-90, -30, 30, 90, 150, 210].map((d) => {
    const a = (d * Math.PI) / 180;
    return `${(c + inner * Math.cos(a)).toFixed(1)},${(c + inner * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" fill="${BG}"/>
    <polygon points="${pts}" fill="${HEX}" stroke="${BG}" stroke-width="${size * 0.012}" stroke-linejoin="round"/>
    <polygon points="${ipts}" fill="none" stroke="${BG}" stroke-width="${size * 0.03}" stroke-linejoin="round"/>
  </svg>`;
};

const OUT = 'public/icons';
const icons = [
  ['icon-192.png', 192, 0.14],
  ['icon-512.png', 512, 0.14],
  ['icon-maskable-512.png', 512, 0.26],
  ['apple-touch-icon.png', 180, 0.14], // iOS rounds the corners itself, so it wants full bleed
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
for (const [file, size, pad] of icons) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(`<body style="margin:0">${svg(size, pad)}</body>`);
  await page.screenshot({ path: `${OUT}/${file}`, omitBackground: false });
  await page.close();
  console.log('wrote', `${OUT}/${file}`);
}
await browser.close();
