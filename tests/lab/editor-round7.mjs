// Round 7 (13 Nov 2026): the stop editor without Basics. Place, 3D visual,
// Question, Media, Review (a broker has no Question); the BG title edited in
// the header; the stop's text above the question or under the place; Review
// with the summary, the EN title and links back; the colour only for shapes;
// a delete dialog; the code box and levels on one row.
// LAB_BASE=http://localhost:4400 node tests/lab/editor-round7.mjs [shotdir]
import fs from 'fs';
import { browser, BASE, SHOTS, check, done, makeUser, cleanUsers, signIn, api, sql } from './lib.mjs';

const out = process.argv[2] || SHOTS;
fs.mkdirSync(out, { recursive: true });
const b = await browser();
const errs = [];
const BODY = 'Старата турска баня е строена през XV век и е най-старата сграда в града.';

async function trail(c, name, mode, category) {
  const { data: w, error } = await c.rpc('create_world', { p_name: name, p_mode: mode, p_language: 'bg', p_category: category });
  if (error) throw error;
  return typeof w === 'string' ? w : w.id;
}
async function open(user, id, width = 1280, scheme = 'light') {
  const ctx = await b.newContext({ viewport: { width, height: width > 600 ? 900 : 844 }, colorScheme: scheme });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`${width}/${scheme}: ${e.message}`));
  p.on('dialog', (d) => { errs.push('native dialog: ' + d.message()); d.accept().catch(() => {}); });
  await signIn(p, user);
  await p.click('[data-cookie-ok]', { timeout: 3000 }).catch(() => {});
  await p.goto(`${BASE}/trail/?id=${id}`);
  await p.waitForSelector('[data-guarded]:not([hidden])', { timeout: 20000 });
  await p.waitForSelector('[data-map] canvas', { timeout: 20000 });
  await p.waitForTimeout(1500);
  return p;
}
const steps = (p) => p.$$eval('[data-step]', (l) => l.map((x) => x.dataset.step));
const visible = (p, s) => p.isVisible(s);
async function goStep(p, s) {
  await p.click(`[data-step="${s}"]`);
  await p.waitForSelector(`[data-panel="${s}"]:not(.hidden)`, { timeout: 15000 });
  await p.waitForTimeout(300);
}

try {
  for (const role of ['teacher', 'broker']) {
    const asks = role !== 'broker';
    const u = await makeUser(`r7-${role}`, { work: role });
    const c = await api(u);
    const id = await trail(c, role === 'broker' ? 'Лаб брокер 7' : 'Лаб учител 7', role === 'broker' ? 'educational' : 'ctf', role === 'broker' ? 'estate' : 'education');
    const p = await open(u, id);
    const R = (name) => `${role}: ${name}`;

    // A new stop opens on Place, with the header waiting for a name.
    const box = await p.locator('[data-map]').boundingBox();
    for (let i = 0; i < 3 && !(await visible(p, '[data-marker-form]')); i++) {
      await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await p.waitForSelector('[data-marker-form]:not(.hidden)', { timeout: 8000 }).catch(() => {});
    }
    await p.waitForSelector('[data-marker-form]:not(.hidden)', { timeout: 15000 })
      .catch(async (e) => { await p.screenshot({ path: `${out}/fail-${role}.png` }); throw e; });
    await p.waitForTimeout(800);
    const want = asks ? 'place,visual,question,media,review' : 'place,visual,media,review';
    check(R('steps'), (await steps(p)).join() === want, (await steps(p)).join());
    check(R('step labels'), (await p.$$eval('[data-step] .st-l', (l) => l.map((x) => x.textContent.trim()))).at(-1) === 'Преглед');
    check(R('opens on Place'), await visible(p, '[data-panel=place]'));
    check(R('no Basics anywhere'), !(await p.$('[data-step=basics], [data-panel=basics]')));
    check(R('count says of N'), ((await p.textContent('[data-wiz-count]')) ?? '').includes(`1 от ${asks ? 5 : 4}`), await p.textContent('[data-wiz-count]'));
    const title = p.locator('[data-wiz-title]');
    check(R('header title is the titleBg input, focused, with placeholder'),
      (await title.getAttribute('name')) === 'titleBg' && (await title.getAttribute('placeholder')) === 'Именувай спирката'
      && await title.evaluate((e) => e === document.activeElement) && Boolean(await title.getAttribute('aria-label')));
    await title.fill('Стара баня');
    await title.press('Enter');
    check(R('Enter keeps the name and stays on the step'), (await title.inputValue()) === 'Стара баня' && await visible(p, '[data-panel=place]')
      && !(await title.evaluate((e) => e === document.activeElement)));
    await title.click();
    await title.fill('Нещо друго');
    await title.press('Escape');
    check(R('Escape puts the name back'), (await title.inputValue()) === 'Стара баня');
    check(R('one titleBg field'), (await p.$$('[name=titleBg]')).length === 1 && (await p.$$('[name=titleEn]')).length === 1);

    // Place: the gentle check, and (broker) the text under it.
    check(R('place check wording'), ((await p.textContent('[data-panel=place] .where')) ?? '').includes('Сигурен ли си в мястото, което избра?'));
    check(R(asks ? 'text not in Place' : 'text at the bottom of Place'), asks
      ? !(await p.$('[data-panel=place] [data-text-block]'))
      : await p.evaluate(() => document.querySelector('[data-panel=place]')?.lastElementChild?.matches('[data-text-block]') ?? false));
    check(R('one set of body fields'), (await p.$$('[name=bodyBg]')).length === 1 && (await p.$$('[data-ai-translate]')).length === 1);

    // The 3D visual: colour only for the shapes; no hex; the removed lines.
    await goStep(p, 'visual');
    const pick = async (k) => { await p.click(`label.shape-option:has(input[value=${k}])`); await p.waitForTimeout(200); };
    await pick('pin');
    check(R('colour shown for a shape'), await visible(p, '[data-colour-box]'));
    await pick('model');
    check(R('colour hidden for Upload a file'), !(await visible(p, '[data-colour-box]')));
    check(R('one file line'), ((await p.textContent('[data-src-panel=file]')) ?? '').includes('Можеш да качиш .glb и .stl файлове до 50 MB и 1 000 000 триъгълника.'));
    await pick('ai');
    check(R('colour hidden for Create with AI'), !(await visible(p, '[data-colour-box]')));
    await pick('cube');
    check(R('colour back for a shape'), await visible(p, '[data-colour-box]'));
    const page = await p.evaluate(() => document.querySelector('[data-guarded]').innerText + document.querySelector('[data-marker-form]').textContent);
    for (const [name, gone] of [['compass hint', /Shift завърта|Завърти стрелката/], ['Gemini note', /Безплатно\. От описание/],
      ['photo hint', /Предметът цял, на равен фон/], ['STL hint', /STL няма цветове/], ['Blender hint', /От Blender/], ['hex code', /#[0-9a-f]{6}\b|цветът по подразбиране/i]]) {
      check(R(`gone: ${name}`), !gone.test(page));
    }

    // The stop's text: above the question, or already seen under the place.
    if (asks) await goStep(p, 'question'); else await goStep(p, 'place');
    await p.fill('[name=bodyBg]', BODY);
    if (asks) check(R('no read-only box'), !(await p.$('[data-read-box]')));

    // On to Review with Next, then Done.
    for (let i = 0; i < 8 && !(await visible(p, '[data-panel=review]')); i++) {
      await p.click('[data-marker-save]');
      await p.waitForTimeout(2200);
    }
    check(R('Next reaches Review'), await visible(p, '[data-panel=review]'));
    check(R('Review: summary with the text itself'), ((await p.textContent('[data-report] .rep-body')) ?? '').includes(BODY));
    const gos = await p.$$eval('[data-report] [data-rep-go]', (l) => l.map((x) => x.dataset.repGo));
    check(R('Review: each part links to its step'), gos.join() === (asks ? 'place,visual,question,media,question' : 'place,visual,place,media'), gos.join());
    check(R('Review: EN title field'), await visible(p, '[data-panel=review] [name=titleEn]'));
    check(R('Review: no hex in the summary'), !/#[0-9a-f]{6}/i.test((await p.textContent('[data-report]')) ?? ''));
    await p.fill('[name=titleEn]', 'Old bath');
    await p.click('[data-marker-save]');
    await p.waitForSelector('[data-ready-box]:not([hidden])', { timeout: 15000 });
    check(R('Done shows what next'), await visible(p, '[data-ready-next]'));
    const [row] = await sql(`select content, status from markers where world_id = $1`, [id]);
    check(R('saved end to end'), row?.status === 'published' && row.content?.bg?.title === 'Стара баня'
      && row.content?.bg?.body === BODY && row.content?.en?.title === 'Old bath', JSON.stringify(row));
    await p.click('[data-report] [data-rep-go="visual"]');
    check(R('Edit in the summary opens the step'), await visible(p, '[data-panel=visual]'));

    // The header title, renamed and saved through the normal flow.
    await title.click();
    await title.fill('Турската баня');
    await title.press('Enter');
    await p.click('[data-marker-save]');
    await p.waitForTimeout(2500);
    const [row2] = await sql(`select content from markers where world_id = $1`, [id]);
    check(R('header rename saved'), row2?.content?.bg?.title === 'Турската баня', row2?.content?.bg?.title);
    check(R('list shows the new name'), ((await p.textContent('[data-stops]')) ?? '').includes('Турската баня'));

    // Still missing points at the header.
    await title.fill('');
    await p.waitForTimeout(200);
    const miss = p.locator('[data-missing-list] .miss-go').first();
    check(R('missing title listed'), await miss.isVisible());
    await miss.click();
    check(R('missing title goes to the header'), await title.evaluate((e) => e === document.activeElement));
    await title.fill('Турската баня');
    await title.press('Enter');

    // Delete asks first, in a dialog; Cancel keeps the stop.
    await p.click('[data-marker-delete]');
    await p.waitForSelector('[data-del-dialog][open]', { timeout: 5000 });
    check(R('delete dialog names the stop'), ((await p.textContent('[data-del-body]')) ?? '').includes('Турската баня'));
    await p.click('[data-del-cancel]');
    check(R('Cancel closes, stop kept'), !(await p.$('[data-del-dialog][open]')) && (await sql(`select 1 from markers where world_id = $1`, [id])).length === 1);

    // A second stop, deleted for real.
    await p.evaluate(() => scrollTo(0, 0));
    await p.locator('[data-map]').scrollIntoViewIfNeeded();
    const box2 = await p.locator('[data-map]').boundingBox();
    await p.mouse.click(box2.x + box2.width / 2 + 120, box2.y + box2.height / 2 + 60);
    await p.waitForFunction(() => document.querySelectorAll('[data-pick]').length === 2, null, { timeout: 15000 });
    await p.waitForTimeout(1500);
    await p.locator('[data-wiz-title]').fill('За триене');
    await p.click('[data-marker-delete]');
    await p.waitForSelector('[data-del-dialog][open]');
    await p.click('[data-del-go]');
    await p.waitForTimeout(2500);
    const left = await sql(`select content->'bg'->>'title' as t from markers where world_id = $1`, [id]);
    check(R('Изтрий deletes that stop only'), left.length === 1 && left[0].t === 'Турската баня' && !(await p.$('[data-del-dialog][open]')), JSON.stringify(left));
    await p.context().close();

    // Shots: every step, the header title in edit, the dialog, Sharing.
    for (const [width, scheme] of [[1280, 'light'], [1280, 'dark'], [390, 'light'], [390, 'dark']]) {
      const tag = `${role}-${width}-${scheme}`;
      const q = await open(u, id, width, scheme);
      const sw = await q.evaluate(() => document.documentElement.scrollWidth);
      check(`${tag}: no horizontal scroll`, sw <= width, String(sw));
      // The code box and the levels: one row, one height (desktop); stacked (phone).
      if (role === 'teacher') {
        const [cb, lb] = [await q.locator('.code-box').boundingBox(), await q.locator('.level-tabs').boundingBox()];
        if (width > 600) check(`${tag}: code and levels aligned`, Math.abs(cb.height - lb.height) <= 1 && Math.abs((cb.y + cb.height / 2) - (lb.y + lb.height / 2)) <= 1, JSON.stringify([cb, lb]));
        else check(`${tag}: code and levels stacked full width`, lb.y > cb.y + cb.height - 1 && Math.abs(cb.width - lb.width) <= 1 && cb.width > width - 40, JSON.stringify([cb, lb]));
        check(`${tag}: no level text under the toggle`, !(await q.$('[data-level-hint]')) && Boolean(await q.getAttribute('[data-level=code]', 'title')));
      }
      await q.click('[data-pick]');
      await q.waitForSelector('[data-marker-form]:not(.hidden)');
      for (const s of await steps(q)) {
        await goStep(q, s);
        await q.waitForTimeout(s === 'review' ? 2500 : 600);
        await q.locator('[data-marker-form]').screenshot({ path: `${out}/${tag}-step-${s}.png` });
      }
      await q.locator('[data-wiz-title]').click();
      await q.locator('.wiz-top').screenshot({ path: `${out}/${tag}-title-edit.png` });
      await q.keyboard.press('Escape');
      await q.click('[data-marker-delete]');
      await q.waitForSelector('[data-del-dialog][open]');
      await q.screenshot({ path: `${out}/${tag}-delete-dialog.png` });
      await q.click('[data-del-cancel]');
      await q.click('[data-ed-tab=share]');
      await q.waitForTimeout(1200);
      await q.evaluate(() => scrollTo(0, 0));
      await q.screenshot({ path: `${out}/${tag}-sharing.png`, fullPage: true });
      await q.context().close();
    }
  }
} finally {
  await cleanUsers();
  await b.close();
}
check('no page errors or native dialogs', errs.length === 0, errs.slice(0, 3).join(' | '));
done();
