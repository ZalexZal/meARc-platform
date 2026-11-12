// Round 4 (12 Nov 2026): the city search above the map, the model box with its
// compass dial, the STL wording and the stop summary. Screenshots at 1280 and
// 390, light and dark, go to tests/lab/shots/r4-*.png.
import path from 'path';
import { fileURLToPath } from 'url';
import { browser, BASE, SHOTS, check, done, makeUser, cleanUsers, signIn, sql } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const b = await browser();
const errs = [];
const shot = async (p, name, opts = {}) => p.screenshot({ path: `${SHOTS}/r4-${name}.png`, ...opts });

async function page(u, width, scheme) {
  const ctx = await b.newContext({ viewport: { width, height: width > 600 ? 900 : 844 }, colorScheme: scheme, permissions: ['clipboard-read', 'clipboard-write'] });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`${width}/${scheme}: ${e.message}`));
  p.on('dialog', (d) => d.accept().catch(() => {}));
  await signIn(p, u);
  // The cookie note sits over the bottom of every shot until it is closed.
  await p.click('[data-cookie-ok]', { timeout: 3000 }).catch(() => {});
  return p;
}

try {
  const u = await makeUser('round4');
  const p = await page(u, 1280, 'light');
  await p.goto(`${BASE}/my-trails/?new=1`);
  await p.waitForSelector('[data-create]:not([hidden])', { timeout: 15000 });
  await p.fill('[data-new-name]', 'Лаб кръг 4');
  await p.click('[data-create-submit]');
  await p.waitForURL(/trail/, { timeout: 20000 });
  const [w] = await sql(`select id from worlds where owner_id = $1`, [u.id]);
  await p.waitForSelector('[data-trail-mode]', { timeout: 15000 });
  await p.waitForTimeout(2500);

  // 1. Under the map: no hint lines; the heading stays.
  const body = await p.textContent('[data-ed-panel=stops]');
  check('no "click the map" hint under the map', !body.includes('Щракни върху картата, за да поставиш'));
  check('no "no stops yet" line', !body.includes('Няма спирки. Щракни'));
  check('Stops heading kept', await p.isVisible('text=Спирки'));

  // 2. City search.
  check('city search above the map', await p.isVisible('[data-city-find]'));
  await p.fill('[data-city-find]', 'Пловдив');
  await p.waitForSelector('[data-city-list] .city-opt', { timeout: 12000 }).catch(() => {});
  const opts = await p.$$eval('[data-city-list] .city-opt', (l) => l.map((x) => x.textContent));
  check('suggestions as you type', opts.length > 0 && opts[0].includes('Пловдив'), opts.slice(0, 2).join(' | '));
  check('combobox roles', (await p.getAttribute('[data-city-find]', 'role')) === 'combobox'
    && (await p.getAttribute('[data-city-find]', 'aria-expanded')) === 'true');
  await shot(p, 'city-1280-light');
  await p.keyboard.press('ArrowDown');
  await p.keyboard.press('ArrowUp');
  await p.keyboard.press('Enter');
  check('Enter closes the list', await p.isHidden('[data-city-list]'));
  await p.waitForTimeout(1600);
  const cityAfter = await sql(`select city from worlds where id = $1`, [w.id]);
  check('moving the map does not change the saved city', !cityAfter[0]?.city, JSON.stringify(cityAfter[0]?.city));
  await p.fill('[data-city-find]', 'Ямбол');
  await p.waitForSelector('[data-city-list] .city-opt', { timeout: 12000 }).catch(() => {});
  await p.keyboard.press('Escape');
  check('Escape closes the list', await p.isHidden('[data-city-list]'));
  await p.keyboard.press('ArrowDown');
  await p.waitForSelector('[data-city-list] .city-opt', { timeout: 3000 }).catch(() => {});
  await p.keyboard.press('Enter');
  await p.waitForTimeout(1600);

  // 3. A stop, its model box and the dial.
  const box = await p.locator('[data-map]').boundingBox();
  await p.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForSelector('[data-marker-form]:not(.hidden)', { timeout: 15000 });
  await p.fill('[name=titleBg]', 'Безистен');
  await p.fill('[name=bodyBg]', 'Ямболският безистен е един от малкото запазени покрити пазари на Балканите.');
  await p.click('[data-step=visual]');
  await p.click('label.shape-option:has(input[value=model])');
  await p.waitForSelector('[data-model-fields]:not(.hidden)');
  check('label says .glb or .stl', (await p.textContent('[data-src-panel=file]')).includes('.glb или .stl'));
  check('STL hint shown', (await p.textContent('[data-src-panel=file]')).includes('цвета на спирката'));
  check('size label is Размер', (await p.textContent('.model-size')).includes('Размер, m'));
  // Round 5: file, size and facing in the right column, the preview on the left.
  const rect = (sel) => p.locator(sel).first().boundingBox();
  const [fileBox, sizeBox, facingBox, stageBox] = await Promise.all([rect('[data-src-panel=file]'), rect('.model-size'), rect('.model-facing'), rect('[data-model-stage]')]);
  check('file, size and facing stack in one column, preview beside them',
    Math.abs(fileBox.x - sizeBox.x) < 2 && Math.abs(sizeBox.x - facingBox.x) < 2 && fileBox.y < sizeBox.y && sizeBox.y < facingBox.y && stageBox.x < fileBox.x);
  check('no whose-model question or rights box', !(await p.$('[data-model-credit], [data-model-rights], input[name=modelCredit]')));
  const dial = p.locator('[data-model-dial]');
  check('dial is a slider', (await dial.getAttribute('role')) === 'slider' && (await dial.getAttribute('aria-valuenow')) === '0');
  await dial.focus();
  await p.keyboard.press('ArrowRight');
  check('arrow turns 5°', (await dial.getAttribute('aria-valuenow')) === '5' && (await p.inputValue('[data-model-heading-num]')) === '5');
  await p.keyboard.press('Shift+ArrowRight');
  check('Shift+arrow turns 1°', (await dial.getAttribute('aria-valuenow')) === '6');
  await p.fill('[data-model-heading-num]', '200');
  check('number drives the dial', (await dial.getAttribute('aria-valuenow')) === '200');
  await dial.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await p.waitForTimeout(400);
  const db = await dial.boundingBox();
  await p.mouse.move(db.x + db.width / 2, db.y + db.height / 2);
  await p.mouse.down();
  await p.mouse.move(db.x + db.width - 4, db.y + db.height / 2 + 1, { steps: 4 });
  await p.mouse.up();
  check('drag to East = 90, snapped', (await dial.getAttribute('aria-valuenow')) === '90' && (await p.inputValue('[data-model-heading-num]')) === '90',
    await dial.getAttribute('aria-valuenow'));
  await p.setInputFiles('[data-model-file]', path.join(here, 'fixtures/house.stl'));
  await p.waitForSelector('[data-model-stage] model-viewer', { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(2500);
  check('STL shows in the preview', Boolean(await p.$('[data-model-stage] model-viewer')));
  await p.fill('[data-model-height]', '0.1');
  await p.click('[data-marker-save]');
  await p.waitForTimeout(1500);
  const err = (await p.textContent('[data-marker-error]')) ?? '';
  check('size message says Размерът', err.includes('Размерът е между 0,2 и 200 m'), err.trim());
  await p.fill('[data-model-height]', '6');
  await p.locator('[data-model-fields]').scrollIntoViewIfNeeded();
  await shot(p, 'model-1280-light', { clip: await p.locator('[data-model-fields]').boundingBox() });

  // 4. Finish the stop: the summary replaces the form.
  for (let i = 0; i < 8 && !(await p.isVisible('[data-report] .rep-head')); i++) {
    await p.click('[data-marker-save]');
    await p.waitForTimeout(2500);
  }
  check('stop summary after Done', await p.isVisible('[data-report] .rep-head'));
  check('summary title', (await p.textContent('[data-report] .rep-title')).includes('Безистен'));
  const rep = await p.textContent('[data-report]');
  check('summary warns: no EN, no photo', rep.includes('Няма текст на английски') && rep.includes('Няма снимка'));
  check('summary has the model at 6 m, 90°', rep.includes('6 m') && rep.includes('90°'), '');
  check('summary map drawn', Boolean(await p.$('[data-report] [data-rep-map] canvas')));
  check('Next is "Нова спирка" on the last stop', (await p.textContent('[data-ready-next]')).includes('Нова спирка'));
  const [mm] = await sql(`select heading_deg, height_m from marker_models mm join markers m on m.id = mm.marker_id where m.world_id = $1`, [w.id]);
  check('facing saved as before (heading_deg)', mm?.heading_deg === 90 && Number(mm?.height_m) === 6, JSON.stringify(mm));
  await p.waitForTimeout(2500);
  await shot(p, 'report-1280-light', { fullPage: true });

  await p.click('[data-ready-again]');
  check('Edit goes back to the form', await p.isVisible('[data-panel=basics]'));
  check('stops list has a summary link', await p.isVisible('[data-rep]'));
  await p.click('[data-rep]');
  await p.waitForTimeout(1500);
  check('summary opens from the list', await p.isVisible('[data-report] .rep-head'));
  await p.click('[data-ready-next]');
  await p.waitForTimeout(800);
  check('Нова спирка returns to the map prompt', await p.isVisible('[data-no-selection]'));

  // 5. The other widths and themes, for the eye.
  for (const [width, scheme] of [[1280, 'dark'], [390, 'light'], [390, 'dark']]) {
    const q = await page(u, width, scheme);
    const tag = `${width}-${scheme}`;
    await q.goto(`${BASE}/trail/?id=${w.id}`);
    await q.waitForSelector('[data-trail-mode]', { timeout: 15000 });
    await q.waitForTimeout(3000);
    const sw = await q.evaluate(() => document.documentElement.scrollWidth);
    check(`no horizontal scroll ${tag}`, sw <= width, String(sw));
    await q.fill('[data-city-find]', 'Сливен');
    await q.waitForSelector('[data-city-list] .city-opt', { timeout: 12000 }).catch(() => {});
    await shot(q, `city-${tag}`);
    await q.keyboard.press('Escape');
    await q.click('[data-rep]');
    await q.waitForTimeout(3500);
    await shot(q, `report-${tag}`, { fullPage: true });
    await q.click('[data-ready-again]');
    await q.click('[data-step=visual]');
    await q.waitForTimeout(2500);
    await q.locator('[data-model-fields]').scrollIntoViewIfNeeded();
    await shot(q, `model-${tag}`, { clip: await q.locator('[data-model-fields]').boundingBox() });
    await q.context().close();
  }

  // 6. V's surfaces, for the eye: header visibility, Sharing with the QR, My trails.
  for (const [width, scheme] of [[1280, 'light'], [1280, 'dark'], [390, 'light'], [390, 'dark']]) {
    const q = await page(u, width, scheme);
    const tag = `${width}-${scheme}`;
    await q.goto(`${BASE}/trail/?id=${w.id}`);
    await q.waitForSelector('[data-trail-mode]', { timeout: 15000 });
    await q.waitForTimeout(3000);
    await q.evaluate(() => scrollTo(0, 0));
    await shot(q, `header-${tag}`, { clip: { x: 0, y: 0, width, height: width > 600 ? 300 : 460 } });
    check(`header has two levels ${tag}`, (await q.$$('[data-levels] [data-level]')).length === 2);
    await q.click('[data-ed-tab=share]');
    await q.waitForTimeout(1200);
    check(`QR drawn ${tag}`, await q.isVisible('[data-share-qr]'));
    await shot(q, `share-${tag}`, { fullPage: true });
    await q.goto(`${BASE}/my-trails/`);
    await q.waitForSelector('[data-card]', { timeout: 15000 });
    await q.waitForTimeout(1000);
    const sw = await q.evaluate(() => document.documentElement.scrollWidth);
    check(`my trails fits ${tag}`, sw <= width, String(sw));
    await q.click('[data-copy]').catch(() => {});
    await q.waitForTimeout(200);
    check(`copy shows Copied ${tag}`, ((await q.textContent('[data-copy-label]')) ?? '').includes('Копиран'), await q.textContent('[data-copy-label]'));
    await shot(q, `mytrails-${tag}`, { fullPage: true });
    await q.context().close();
  }
} finally {
  await cleanUsers();
  await b.close();
}
check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
done();
