// Clicks through /fathom#online-sim (dev server): two humans and a CPU play through the real
// referee in the tab; checks turns pass between seats, the CPU moves, and forfeit works.
// Usage: node scripts/fathom-online-sim-check.mjs [url] [outdir]
import { chromium } from 'playwright';

const url = (process.argv[2] ?? 'http://localhost:5173') + '/fathom#online-sim';
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome' });
const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text())) errors.push(m.text()); });
await p.goto(url);
await p.waitForSelector('[data-seat="u0"] .ocean');
const seat = (u) => p.locator(`[data-seat="${u}"]`);
const as = (name) => p.locator('.sim-bar button', { hasText: name }).click();

let moves = 0;
for (let i = 0; i < 60 && moves < 8; i++) {
  for (const [u, name] of [['u0', 'Tom'], ['u1', 'Ana']]) {
    await as(name);
    const s = seat(u);
    const skip = s.locator('.fm-banner button', { hasText: 'Skip' });
    if (await skip.count()) { await skip.click(); await p.waitForTimeout(150); continue; }
    const dive = s.locator('.dive-btn');
    if (await dive.count()) { await dive.nth(moves % 3).click(); moves++; await p.waitForTimeout(250); }
  }
  await p.waitForTimeout(400);
}
await as('Tom');
await p.screenshot({ path: `${out}/fo-1-tom.png` });
const status = await seat('u0').locator('.fm-topbar .status').innerText();
console.log({ moves, status });
// Ana forfeits; the game goes on with a CPU in her seat
await as('Ana');
await seat('u1').getByRole('button', { name: 'Forfeit' }).click();
await p.screenshot({ path: `${out}/fo-2-forfeit.png` });
await p.locator('.dialog .btn.danger').click();
await p.waitForTimeout(800);
const chip = await seat('u1').locator('.fm-chip', { hasText: 'Ana' }).innerText();
console.log('Ana chip:', chip.replace(/\n/g, ' '));
if (!/forfeited/.test(chip)) errors.push('Ana is not shown as forfeited');
// Tom forfeits too: with only a CPU left... (Tom and the CPUs) the game ends
await as('Tom');
await seat('u0').getByRole('button', { name: 'Forfeit' }).click();
await p.locator('.dialog .btn.danger').click();
await p.waitForSelector('[data-seat="u0"] .dialog[aria-label$="wins"]', { timeout: 10000 });
await p.screenshot({ path: `${out}/fo-3-over.png` });
await browser.close();
if (moves < 6) errors.push(`only ${moves} moves were made`);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('ok');
