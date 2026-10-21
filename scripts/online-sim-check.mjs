// Drives the dev-only online simulation (#online-sim): two human seats in one tab plus a CPU,
// all moves going through the real referee. Checks simultaneous corporation picks, that each
// seat only sees its own hand, and clicks through a stretch of play without page errors.
// Usage: node scripts/online-sim-check.mjs <dev-url> <outdir> [clicks]
import { chromium } from 'playwright';

const url = (process.argv[2] ?? 'http://localhost:5173/') + '#online-sim';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g/.test(m.text())) errors.push(m.text()); });
await p.goto(url);
const seat = (u) => p.locator(`[data-seat=${u}]`);
const viewAs = async (name) => { await p.locator('.sim-bar').getByRole('button', { name }).click(); await p.waitForTimeout(150); };

// both players get their corporation choice at once, whoever's turn it is
await seat('u0').locator('.dialog').first().waitFor();
await p.screenshot({ path: `${out}/sim-01-tom-setup.png` });
await viewAs('Ana');
await seat('u1').locator('.dialog').first().waitFor();
const anaCards = await seat('u1').locator('.dialog .pick-grid:not(.corps) .card').count();
console.log('Ana sees her own 10 starting cards:', anaCards);
await seat('u1').locator('.dialog .pick-grid:not(.corps) .card').first().click();
await seat('u1').getByRole('button', { name: /^Start with/ }).click();
await p.waitForTimeout(400);
await p.screenshot({ path: `${out}/sim-02-ana-waiting.png` });
console.log('Ana status after picking:', await seat('u1').locator('.status').textContent());
await viewAs('Tom');
for (let i = 0; i < 2; i++) await seat('u0').locator('.dialog .pick-grid:not(.corps) .card').nth(i).click();
await seat('u0').getByRole('button', { name: /^Start with/ }).click();
await p.waitForTimeout(3500);
await p.screenshot({ path: `${out}/sim-03-table.png` });
console.log('Tom status:', await seat('u0').locator('.status').textContent());
console.log('Tom hand:', await seat('u0').locator('.hand-cards .card').count(), '· Ana hand count shown to Tom:', await seat('u0').locator('.players').getByText(/Hand/).allTextContents());

// click through play: act for whichever seat has something to do
let clicks = 0;
const targets = (u) => seat(u).locator('.dialog button:not([disabled]), .dialog .card, .hex.pickable, .offworld-space.pickable, .actionbar button:not([disabled]), .final-bar button:not([disabled])');
for (let i = 0; i < Number(process.argv[4] ?? 400); i++) {
  await p.waitForTimeout(20);
  if (await seat('u0').locator('.scores').count()) break;
  let u = null;
  for (const c of ['u0', 'u1']) {
    const st = (await seat(c).locator('.status').textContent().catch(() => '')) ?? '';
    if (/Your|you/.test(st) || (await seat(c).locator('.dialog').count())) { u = c; break; }
  }
  if (!u) { await p.waitForTimeout(150); continue; }
  await viewAs(u === 'u0' ? 'Tom' : 'Ana');
  const t = targets(u);
  const n = await t.count();
  if (!n) { await p.waitForTimeout(100); continue; }
  const pick = t.nth(Math.floor(Math.random() * n));
  const label = ((await pick.textContent().catch(() => '')) ?? '').trim();
  if (/^(Menu|Seats)$/.test(label)) continue;
  await pick.click({ timeout: 1000 }).catch(() => {});
  clicks++;
}
await p.screenshot({ path: `${out}/sim-04-later.png` });
console.log('clicks', clicks, 'generation', await seat('u0').locator('.gen b').textContent(), 'over', await seat('u0').locator('.scores').count());

// host hands Ana's seat to a CPU
await viewAs('Tom');
const seatsBtn = seat('u0').getByRole('button', { name: 'Seats' });
if (await seatsBtn.count()) {
  await seatsBtn.click();
  await seat('u0').getByLabel('Who plays Ana').selectOption('hard');
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${out}/sim-05-seats.png` });
  console.log('Ana seat now:', await seat('u0').getByLabel('Who plays Ana').inputValue());
}
console.log('errors:', errors.length ? errors : 'none');
await browser.close();
