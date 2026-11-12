// Phones that turn toward the cursor (lib/tilt.ts): the home page's "in its
// place" phones, the app page's step screens and the get-the-app phones.
// node tests/lab/tilt.mjs <outdir>   (preview on :4399)
import { browser, BASE, check, done } from './lib.mjs';
const out = process.argv[2] || '/tmp';
const b = await browser();
const tf = (p, sel) => p.$eval(sel, (e) => e.style.transform);

async function page(w, h, scheme, motion = 'no-preference') {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, reducedMotion: motion });
  const p = await ctx.newPage();
  return { ctx, p };
}
async function near(p, sel, dx, dy) {
  const el = await p.$(sel);
  await el.scrollIntoViewIfNeeded();
  await p.waitForTimeout(900);
  const r = await el.boundingBox();
  // Start far away, then come in beside the phone.
  await p.mouse.move(5, 5);
  await p.mouse.move(r.x + r.width / 2 + dx, r.y + r.height / 2 + dy, { steps: 8 });
  await p.waitForTimeout(700);
  return r;
}

for (const scheme of ['light', 'dark']) {
  for (const [w, h] of [[1280, 800], [390, 844]]) {
    const tag = `${w}-${scheme}`;
    // Home: "Whatever you want to show — in its place."
    let { ctx, p } = await page(w, h, scheme);
    await p.goto(BASE + '/en/'); await p.waitForTimeout(800);
    await p.click('[data-cookie-ok]', { timeout: 3000 }).catch(() => {});
    if (w > 960) {
      await near(p, '#what .tilt.w2', -60, -330);
      const t = await tf(p, '#what .tilt.w2');
      check(`home ${tag} phone turns toward a cursor above it`, /rotateX\(\d/.test(t) && !/rotateX\(0deg/.test(t), t);
      await p.screenshot({ path: `${out}/what-${tag}-near.png` });
      await p.mouse.move(5, 5, { steps: 4 }); await p.waitForTimeout(1200);
      check(`home ${tag} phone settles back when the cursor leaves`, (await tf(p, '#what .tilt.w2')) === '');
      const ri = await p.$eval('#what .w2-shot', (e) => getComputedStyle(e).transform);
      check(`home ${tag} phone keeps its own lean`, ri !== 'none', ri);
    } else {
      await p.$eval('#what', (e) => e.scrollIntoView()); await p.waitForTimeout(1200);
      await p.screenshot({ path: `${out}/what-${tag}.png` });
    }
    await ctx.close();
    // The app page.
    ({ ctx, p } = await page(w, h, scheme));
    await p.goto(BASE + '/en/play/'); await p.waitForTimeout(800);
    await p.click('[data-cookie-ok]', { timeout: 3000 }).catch(() => {});
    if (w > 960) {
      await near(p, '.play-step:nth-child(2) .play-shot', -260, 40);
      const t = await tf(p, '.play-step:nth-child(2) .play-shot');
      check(`play ${tag} step screen turns toward the cursor`, /rotateY\(-\d/.test(t), t);
      await p.screenshot({ path: `${out}/play-${tag}-near.png` });
      const far = await tf(p, '.play-step:nth-child(4) .play-shot');
      check(`play ${tag} far screens stay still`, far === '', far);
      await near(p, '.get-shots .s1', 200, 0);
      const g = await tf(p, '.get-shots .s1');
      check(`play ${tag} get-the-app phone turns`, g !== '', g);
      await p.screenshot({ path: `${out}/getapp-${tag}-near.png` });
    } else {
      await p.screenshot({ path: `${out}/play-${tag}.png`, fullPage: false });
    }
    await ctx.close();
  }
}
// Reduced motion: nothing turns.
const { ctx, p } = await page(1280, 800, 'light', 'reduce');
await p.goto(BASE + '/en/play/'); await p.waitForTimeout(800);
await near(p, '.play-step:nth-child(2) .play-shot', -200, 0);
check('play reduced motion: no tilt', (await tf(p, '.play-step:nth-child(2) .play-shot')) === '');
await ctx.close();
await b.close();
done();
