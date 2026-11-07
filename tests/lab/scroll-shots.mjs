// Scroll a page one screen at a time and screenshot each, so sections that
// reveal on scroll (the home page) are actually drawn.
// node tests/lab/scroll-shots.mjs <path> <out-prefix> [width] [height] [scheme]
import { browser, BASE, SHOTS } from './lib.mjs';
const [path, name, width = '1440', height = '900', scheme = 'light'] = process.argv.slice(2);
const b = await browser();
const ctx = await b.newContext({ viewport: { width: Number(width), height: Number(height) }, colorScheme: scheme });
const p = await ctx.newPage();
await p.goto(BASE + path);
await p.waitForTimeout(1500);
// Dismiss the cookie card so it does not sit on every frame.
await p.click('[data-cookie-ok]', { timeout: 2000 }).catch(() => {});
const total = await p.evaluate(() => document.documentElement.scrollHeight);
let i = 0;
for (let y = 0; y < total; y += Number(height) * 0.9) {
  await p.mouse.wheel(0, i === 0 ? 0 : Number(height) * 0.9);
  await p.waitForTimeout(1400);
  await p.screenshot({ path: `${SHOTS}/${name}-${String(i).padStart(2, '0')}.png` });
  i++;
  if (i > 30) break;
}
console.log(i, 'frames');
await b.close();
