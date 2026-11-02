// UI check with all four expansions: menu toggles, setup with preludes, the prelude phase, the
// table with the Venus gauge and the Colonies/Turmoil panels, then a random-click fuzz that also
// hits the panels' trade and delegate buttons. Fails on page errors.
// Usage: node scripts/ui-expansions.mjs <url> <outdir> [clicks]
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5173/';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const d = await ctx.newPage();
d.on('pageerror', (e) => errors.push(String(e)));
d.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text())) errors.push(m.text()); });
await d.goto(url);
await d.evaluate(() => localStorage.clear());
await d.goto(url);
for (const name of ['Prelude', 'Venus Next', 'Colonies', 'Turmoil']) await d.locator('.exp-opt', { hasText: name }).locator('input').check();
await d.locator('.exp-pick').scrollIntoViewIfNeeded();
await d.screenshot({ path: `${out}/x1-menu.png` });
await d.getByRole('button', { name: 'Start game' }).click();
await d.waitForSelector('.dialog');
await d.screenshot({ path: `${out}/x2-setup.png`, fullPage: false });
// two preludes, three cards
const grids = d.locator('.dialog .pick-grid:not(.corps)');
await grids.nth(0).locator('.card').nth(0).click();
await grids.nth(0).locator('.card').nth(1).click();
for (let i = 0; i < 3; i++) await grids.nth(1).locator('.card').nth(i).click();
await d.getByRole('button', { name: /^Start with/ }).click();
// prelude phase: wait for our dialog
await d.waitForSelector('.dialog >> text=play your preludes', { timeout: 20000 });
await d.screenshot({ path: `${out}/x3-preludes.png` });
for (let k = 0; k < 2; k++) {
  await d.locator('.dialog .pick-grid .card').first().click();
  await d.waitForTimeout(600);
  // answer any follow-up (tile placement, choices) at random
  for (let j = 0; j < 6; j++) {
    const hex = d.locator('.hex.pickable, .offworld-space.pickable');
    if (await hex.count()) { await hex.first().click(); await d.waitForTimeout(300); continue; }
    const btn = d.locator('.dialog .choice-list button:not([disabled]), .dialog .pick-grid .card');
    if (await d.locator('.dialog >> text=play your preludes').count()) break;
    if (await btn.count()) { await btn.first().click(); await d.waitForTimeout(300); continue; }
    break;
  }
}
await d.waitForTimeout(5000);
await d.screenshot({ path: `${out}/x4-table.png` });
await d.locator('.xpanel.colonies').screenshot({ path: `${out}/x5-colonies.png` }).catch(() => {});
await d.locator('.xpanel.turmoil').screenshot({ path: `${out}/x6-turmoil.png` }).catch(() => {});

let clicks = 0;
for (let i = 0; i < Number(process.argv[4] ?? 600); i++) {
  await d.waitForTimeout(15);
  if (await d.locator('.scores').count()) break;
  const targets = d.locator('.dialog button:not([disabled]), .dialog .card, .hex.pickable, .offworld-space.pickable, .actionbar button:not([disabled]), .final-bar button:not([disabled]), .xpanel button:not([disabled])');
  const n = await targets.count();
  if (!n) { await d.waitForTimeout(150); continue; }
  const pick = targets.nth(Math.floor(Math.random() * n));
  const label = ((await pick.textContent().catch(() => '')) ?? '').trim();
  if (/^Menu$/.test(label)) continue;
  await pick.click({ timeout: 1000 }).catch(() => {});
  clicks++;
}
await d.screenshot({ path: `${out}/x7-after-fuzz.png` });
console.log('clicks', clicks, 'generation', await d.locator('.gen b').textContent().catch(() => '?'), 'over', await d.locator('.scores').count());

const m = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
m.on('pageerror', (e) => errors.push(String(e)));
await m.goto(url);
await m.getByRole('button', { name: /Resume/ }).first().click().catch(() => {});
await m.waitForTimeout(1500);
await m.screenshot({ path: `${out}/x8-phone.png`, fullPage: true });
console.log('phone overflow px', await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth));
console.log('errors', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
