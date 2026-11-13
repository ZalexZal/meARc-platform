// Round 7 (was round 5 E2): the Question step opens with the stop's own text
// fields - the BG/EN body and the AI translate row - where the read-only box
// used to be, and the question below them. Shots at 1280 and 390, light and
// dark, to <outdir>.
// node tests/lab/question-read.mjs <outdir>
import { browser, BASE, check, done, makeUser, cleanUsers, signIn, sql } from './lib.mjs';
const out = process.argv[2] || '/tmp';
const b = await browser();
const errs = [];
const body = 'Ямболският безистен е един от малкото запазени покрити пазари на Балканите.';
try {
  const u = await makeUser('round7q', { work: 'teacher' });
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
      await p.fill('[data-new-name]', 'Лаб кръг 7');
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
    await p.fill('[name=titleBg]', `Безистен ${n}`);
    await p.click('[data-step=question]');
    // The step bar saves first, then shows the pane.
    await p.waitForSelector('[data-panel=question]:not(.hidden)', { timeout: 15000 });
    await p.waitForTimeout(400);
    check(`no read-only box ${tag}`, !(await p.$('[data-read-box]')));
    check(`text fields in the Question step ${tag}`,
      await p.isVisible('[data-panel=question] [data-text-block] [name=bodyBg]')
      && await p.isVisible('[data-panel=question] [data-text-block] [name=bodyEn]')
      && await p.isVisible('[data-panel=question] [data-ai-translate]'));
    const order = await p.evaluate(() => {
      const t = document.querySelector('[data-panel=question] [data-text-block]');
      const k = document.querySelector('[data-panel=question] .kinds');
      return Boolean(t && k && (t.compareDocumentPosition(k) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    check(`text above the question ${tag}`, order);
    check(`one set of body fields ${tag}`, (await p.$$('[name=bodyBg]')).length === 1);
    await p.fill('[name=bodyBg]', body);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    check(`no horizontal scroll ${tag}`, sw <= width, String(sw));
    await p.locator('[data-panel=question]').scrollIntoViewIfNeeded();
    await p.screenshot({ path: `${out}/question-${tag}.png` });
    // Skipping the question keeps (and saves) the text.
    await p.click('[data-wiz-skip]');
    await p.waitForTimeout(2500);
    const rows = await sql(`select content from markers where world_id = $1 and content->'bg'->>'title' = $2`, [worldId, `Безистен ${n}`]);
    check(`text saved through Skip ${tag}`, rows[0]?.content?.bg?.body === body, JSON.stringify(rows[0]?.content ?? null));
    await ctx.close();
  }
} finally {
  await cleanUsers();
  await b.close();
}
check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
done();
