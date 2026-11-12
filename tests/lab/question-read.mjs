// Round 5 (E2): the question step shows what the visitor reads, clamped with
// "show all". Shots at 1280 and 390, light and dark, to <outdir>.
// node tests/lab/question-read.mjs <outdir>
import { browser, BASE, check, done, makeUser, cleanUsers, signIn, sql } from './lib.mjs';
const out = process.argv[2] || '/tmp';
const b = await browser();
const errs = [];
const long = Array.from({ length: 14 }, (_, i) => `Ред ${i + 1}: Ямболският безистен е един от малкото запазени покрити пазари на Балканите.`).join('\n');
try {
  const u = await makeUser('round5q');
  let worldId = null, n = 0;
  for (const [width, scheme] of [[1280, 'light'], [1280, 'dark'], [390, 'light'], [390, 'dark']]) {
    const tag = `${width}-${scheme}`;
    const ctx = await b.newContext({ viewport: { width, height: width > 600 ? 900 : 844 }, colorScheme: scheme });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(`${tag}: ${e.message}`));
    p.on('dialog', (d) => d.accept().catch(() => {}));
    await signIn(p, u);
    await p.click('[data-cookie-ok]', { timeout: 3000 }).catch(() => {});
    if (!worldId) {
      await p.goto(`${BASE}/my-trails/?new=1`);
      await p.waitForSelector('[data-create]:not([hidden])', { timeout: 15000 });
      await p.fill('[data-new-name]', 'Лаб кръг 5');
      await p.click('[data-create-submit]');
      await p.waitForURL(/trail/, { timeout: 20000 });
      [{ id: worldId }] = await sql(`select id from worlds where owner_id = $1`, [u.id]);
    } else {
      await p.goto(`${BASE}/trail/?id=${worldId}`);
    }
    await p.waitForSelector('[data-trail-mode]', { timeout: 15000 });
    await p.waitForTimeout(2500);
    const box = await p.locator('[data-map]').boundingBox();
    await p.mouse.click(box.x + box.width / 2 - 90 + 60 * n, box.y + box.height / 2 + 50 * (n++ % 2));
    await p.waitForSelector('[data-marker-form]:not(.hidden)', { timeout: 15000 });
    await p.fill('[name=titleBg]', 'Безистен');
    // Empty first: the box points back to the basics.
    await p.click('[data-step=question]');
    const empty = await p.waitForSelector('[data-read-empty]', { state: 'visible', timeout: 4000 }).then(() => true, () => false);
    check(`empty hint ${tag}`, empty);
    await p.click('[data-step=basics]');
    await p.fill('[name=bodyBg]', long);
    await p.click('[data-step=question]');
    await p.waitForTimeout(400);
    check(`text shown ${tag}`, ((await p.textContent('[data-read-text]')) ?? '').includes('Ред 1'));
    check(`"show all" for long text ${tag}`, await p.waitForSelector('[data-read-more]', { state: 'visible', timeout: 4000 }).then(() => true, () => false));
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    check(`no horizontal scroll ${tag}`, sw <= width, String(sw));
    await p.locator('[data-panel=question]').scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${out}/question-${tag}.png` });
    await p.click('[data-read-more]');
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/question-${tag}-all.png`, fullPage: true });
    await ctx.close();
  }
} finally {
  await cleanUsers();
  await b.close();
}
check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
done();
