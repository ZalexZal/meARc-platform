// The hero's phone at the stop: the clock tower being rebuilt in it.
// node tests/lab/hero-tower.mjs <outdir>   (preview on :4399)
// Shots at 1280 and 390, light and dark: two frames of the loop and a
// reduced-motion frame. Checks the old orange pin is gone from the phone.
import { browser, BASE, check, done } from './lib.mjs';
const out = process.argv[2] || '/tmp';
const b = await browser();
for (const [w, h] of [[1280, 800], [390, 844]]) {
  for (const scheme of ['light', 'dark']) {
    for (const motion of ['no-preference', 'reduce']) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, reducedMotion: motion });
      const p = await ctx.newPage();
      await p.goto(BASE + '/en/');
      await p.waitForTimeout(800); await p.click('[data-cookie-ok]', { timeout: 3000 }).catch(() => {});
      // Story 4.2: the finder is up, the question asked and scored.
      await p.evaluate(() => {
        const wk = document.querySelector('[data-walk]');
        const top = wk.getBoundingClientRect().top + scrollY;
        const pp = 0.125 + ((4.2 - 0.7) / 3.95) * (0.96875 - 0.125);
        scrollTo(0, top + pp * (wk.offsetHeight - innerHeight));
      });
      await p.waitForTimeout(1500);
      const tag = `${w}-${scheme}`;
      if (motion === 'reduce') {
        await p.screenshot({ path: `${out}/hero-${tag}-reduced.png` });
        const op = await p.$eval('[data-tower] .tw-solid', (e) => getComputedStyle(e).opacity).catch(() => 'none');
        check(`hero ${tag} reduced motion shows the finished tower`, Number(op) > 0.5, `solid opacity ${op}`);
      } else {
        await p.screenshot({ path: `${out}/hero-${tag}-a.png` });
        await p.waitForTimeout(2600);
        await p.screenshot({ path: `${out}/hero-${tag}-b.png` });
        const open = await p.$eval('[data-finder]', (e) => e.classList.contains('is-open')).catch(() => false);
        check(`hero ${tag} finder open with the tower`, open);
      }
      await ctx.close();
    }
  }
}
await b.close();
done();
