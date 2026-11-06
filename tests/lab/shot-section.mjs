// Scroll to a section so its reveal animation runs, then screenshot it.
// node tests/lab/shot-section.mjs <path> <selector> <out-name> [width]
import { browser, BASE, SHOTS } from './lib.mjs';
const [path, sel, name, width = '1440'] = process.argv.slice(2);
const b = await browser();
const p = await b.newPage({ viewport: { width: Number(width), height: 900 } });
await p.goto(BASE + path);
await p.waitForTimeout(1200);
const el = await p.$(sel);
await el.scrollIntoViewIfNeeded();
await p.mouse.wheel(0, 200);
await p.waitForTimeout(2200);
await el.screenshot({ path: `${SHOTS}/${name}.png` });
await b.close();
