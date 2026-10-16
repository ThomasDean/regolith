// UI smoke test: screenshots at desktop and phone widths, then a random-click fuzz through a
// game against CPUs, failing on any page error. Usage: node scripts/ui-check.mjs <url> <outdir>
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:4173/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];

async function page(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
  await p.goto(url);
  return p;
}

// --- desktop: menu, setup, first turn
const d = await page(1440, 960);
await d.screenshot({ path: `${out}/01-menu.png` });
await d.getByRole('button', { name: 'Start game' }).click();
await d.waitForSelector('.dialog');
await d.screenshot({ path: `${out}/02-setup.png` });
// keep three starting cards and start
const cards = d.locator('.dialog .pick-grid:not(.corps) .card');
for (let i = 0; i < 3; i++) await cards.nth(i).click();
await d.getByRole('button', { name: /^Start with/ }).click();
await d.waitForTimeout(4000);
await d.screenshot({ path: `${out}/03-table.png` });
const firstCard = d.locator('.hand-cards .card').first();
if (await firstCard.count()) { await firstCard.click(); await d.waitForTimeout(200); await d.screenshot({ path: `${out}/04-card.png` }); await d.keyboard.press('Escape'); }

// --- fuzz: click random enabled controls for a while
let clicks = 0;
for (let i = 0; i < Number(process.argv[4] ?? 700); i++) {
  await d.waitForTimeout(15);
  const over = await d.locator('.scores').count();
  if (over) break;
  const targets = d.locator('.dialog button:not([disabled]), .dialog .card, .hex.pickable, .offworld-space.pickable, .actionbar button:not([disabled]), .final-bar button:not([disabled])');
  const n = await targets.count();
  if (!n) { await d.waitForTimeout(150); continue; }
  const pick = targets.nth(Math.floor(Math.random() * n));
  const label = (await pick.textContent().catch(() => '')) ?? '';
  if (/^Menu$/.test(label.trim())) continue;
  await pick.click({ timeout: 1000 }).catch(() => {});
  clicks++;
}
await d.screenshot({ path: `${out}/05-after-fuzz.png` });
const gen = await d.locator('.gen b').textContent().catch(() => '?');
console.log('fuzz clicks', clicks, 'generation', gen, 'game over', await d.locator('.scores').count());

// --- phone
const m = await page(390, 844);
await m.screenshot({ path: `${out}/06-phone-menu.png`, fullPage: true });
await m.getByRole('button', { name: /Resume|Start game/ }).first().click();
await m.waitForTimeout(1500);
await m.screenshot({ path: `${out}/07-phone-table.png`, fullPage: false });
const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
console.log('phone horizontal overflow px', overflow);

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
await browser.close();
