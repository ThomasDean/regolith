// Clicks through the hub, a Fathom game, next-game and forfeit, failing on any page error.
// Usage: node scripts/hub-check.mjs <url> <outdir>
import { chromium } from 'playwright';

const url = (process.argv[2] ?? 'http://localhost:4173').replace(/\/$/, '');
const out = process.argv[3] ?? '.';
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome' });
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error' && !/fonts\.g|Failed to load resource/.test(m.text())) errors.push(m.text()); });
const shot = (name) => p.screenshot({ path: `${out}/${name}.png`, fullPage: false });

await p.goto(`${url}/`);
await p.waitForSelector('.hub');
await shot('01-hub-empty');
await p.getByRole('button', { name: 'Play Fathom' }).click();
await p.waitForSelector('.fm-menu');
await shot('02-fathom-menu');
await p.getByRole('button', { name: 'Start game' }).click();
await p.waitForSelector('.ocean');
await p.waitForTimeout(600);
await shot('03-fathom-start');

// play our own turns for a while: release what we can, otherwise dive; answer prompts
let released = 0, dives = 0;
for (let step = 0; step < 120; step++) {
  if (await p.locator('.dialog[aria-label$="wins"]').count()) break;
  const skip = p.locator('.fm-banner button', { hasText: 'Skip' });
  const can = p.locator('.slot.can');
  if (await p.locator('.dialog').count()) {
    // recover / cycle / pay dialogs
    const pick = p.locator('.dialog .fm-pick-cards .fm-hand-card');
    const releaseBtn = p.locator('.dialog .btn', { hasText: /^Release at/ });
    if (await releaseBtn.count()) { await releaseBtn.click(); continue; }
    if (await pick.count()) { await pick.first().click(); continue; }
    await p.keyboard.press('Escape');
    continue;
  }
  if (await skip.count()) {
    if (await can.count()) await can.first().click(); else await skip.click();
    await p.waitForTimeout(80);
    continue;
  }
  const dive = p.locator('.dive-btn');
  if (!(await dive.count())) { await p.waitForTimeout(300); continue; }
  // try a hand card
  const cards = p.locator('.fm-hand-row .fm-hand-card');
  let done = false;
  if (step % 3 !== 2) {
    for (let i = 0; i < (await cards.count()) && !done; i++) {
      await cards.nth(i).click();
      const rel = p.locator('.dialog .btn', { hasText: 'Release this fish' });
      if (await rel.count() && await rel.isEnabled()) {
        await rel.click();
        await p.locator('.slot.can').first().click();
        const payBtn = p.locator('.dialog .btn', { hasText: /^Release at/ });
        if (await payBtn.count()) await payBtn.click();
        released++; done = true;
      } else await p.keyboard.press('Escape');
    }
  }
  if (!done) { await dive.nth(step % 3).click(); dives++; }
  if (released + dives === 3) await shot('04-fathom-midturn');
  await p.waitForTimeout(150);
  if (await p.locator('.fm-topbar .gen b').innerText() === '2' && !(await p.locator('.fm-toasts .seen').count())) { await shot('05-fathom-tide2'); break; }
}
console.log({ released, dives });

// the hub lists the game; Regolith's game offers it as the next one
await p.getByRole('button', { name: 'Menu' }).click();
await p.getByRole('button', { name: '← All games' }).click();
await p.waitForSelector('.active-list');
await shot('06-hub-with-game');
await p.getByRole('button', { name: 'Play Regolith' }).click();
await p.getByRole('button', { name: 'Start game' }).click();
await p.waitForSelector('.dialog');
await p.waitForTimeout(400);
await shot('07-regolith-setup');
const next = p.locator('.next-game');
console.log('next game enabled in Regolith:', await next.isEnabled(), await next.getAttribute('aria-label'));
await p.keyboard.press('Escape');
await next.evaluate((b) => b.click());
await p.waitForSelector('.fm-game');
await shot('08-back-in-fathom');

// forfeit: one human against CPUs ends the game
await p.getByRole('button', { name: 'Forfeit' }).click();
await shot('09-forfeit-confirm');
await p.locator('.dialog .btn.danger').click();
await p.waitForSelector('.dialog[aria-label$="wins"]');
await shot('10-forfeit-over');

// desktop look
await p.setViewportSize({ width: 1440, height: 960 });
await p.goto(`${url}/fathom`);
await p.getByRole('button', { name: 'Start game' }).click();
await p.waitForSelector('.ocean');
await p.waitForTimeout(2500);
await p.screenshot({ path: `${out}/11-fathom-desktop.png` });
await p.goto(`${url}/`);
await p.waitForSelector('.hub');
await p.screenshot({ path: `${out}/12-hub-desktop.png` });

await browser.close();
if (errors.length) { console.error('page errors:\n' + errors.join('\n')); process.exit(1); }
console.log('ok');
