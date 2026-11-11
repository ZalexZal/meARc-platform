// Task R3: what a viewer sees on My trails, in the builder and in Account
// settings, and the small seal next to the signed-in name.
import { browser, BASE, URL as SB, SHOTS, check, done, makeUser, cleanUsers, signIn, api, sql } from './lib.mjs';
import path from 'path';

const b = await browser();
const errs = [];
const profile = async (id) => (await sql(`select role, work from public.profiles where id = $1`, [id]))[0];
const visible = (p, sel) => p.$eval(sel, (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)).catch(() => false);
const badge = (p, scope = '[data-site-header]') => p.$eval(`${scope} [data-name-seal]`, (el) => {
  const s = el.querySelector('[data-seal]');
  return { hidden: el.hidden || getComputedStyle(el).display === 'none', label: el.getAttribute('aria-label'),
    role: el.getAttribute('role'), shape: s?.dataset.sealShape, glyph: s?.dataset.sealGlyph,
    size: Math.round(s?.getBoundingClientRect().width ?? 0), bg: s ? getComputedStyle(s).backgroundColor : '',
    fg: s ? getComputedStyle(s).color : '' };
}).catch(() => null);

async function page(width = 1280, height = 900, scheme = 'light') {
  const ctx = await b.newContext({ viewport: { width, height }, colorScheme: scheme });
  await ctx.addInitScript(() => { try { localStorage.setItem('artrail-cookies-ok', '1'); } catch {} });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`${p.url()}: ${e.message}`));
  return p;
}
async function mine(p, lang = '') {
  await p.goto(`${BASE}${lang}/my-trails/`);
  await p.waitForSelector('[data-guarded]:not([hidden])', { timeout: 20000 });
  await p.waitForTimeout(1200);
}
async function trail(user, name) {
  const c = await api(user);
  const { data: w, error } = await c.rpc('create_world', { p_name: name, p_mode: 'educational', p_language: 'bg', p_category: 'other' });
  if (error) throw error;
  return typeof w === 'string' ? w : w.id;
}
async function shot(p, name) {
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(SHOTS, name) });
}

try {
  // 1. A viewer on My trails: the "Стани създател" card, no create form.
  const v = await makeUser('vp-viewer', { role: 'viewer', work: 'broker' });
  const owned = await trail(v, 'Моят стар маршрут');
  const p = await page();
  await signIn(p, v);
  await mine(p);
  check('viewer: become-creator card shows', await visible(p, '[data-become]'));
  check('…titled Стани създател', (await p.textContent('[data-become] h2').catch(() => '')).trim() === 'Стани създател');
  check('…with the four job seals', (await p.$$('[data-become] input[name="work"]')).length === 4);
  check('viewer: no New trail tile', !(await visible(p, '[data-new-open]')));
  check('viewer: no create form', !(await visible(p, '[data-create]')));
  check("viewer's own trail still listed", (await p.$$(`[data-card="${owned}"]`)).length === 1);
  const vb = await badge(p);
  check('header badge: round for a viewer', vb && !vb.hidden && vb.shape === 'round' && vb.glyph === 'viewer', JSON.stringify(vb));
  check('header badge: aria-label Зрител', vb?.label === 'Зрител' && vb?.role === 'img', JSON.stringify(vb));
  check('header badge: 26px', vb?.size === 26, String(vb?.size));
  check('header badge: #1d1d1f with white glyph (light)', vb?.bg === 'rgb(29, 29, 31)' && vb?.fg === 'rgb(255, 255, 255)', JSON.stringify(vb));
  await shot(p, 'r3-mytrails-viewer-light.png');
  await p.screenshot({ path: path.join(SHOTS, 'r3-badge-viewer-light.png'), clip: { x: 900, y: 0, width: 380, height: 64 } });

  // Picking only marks a job: Continue is what saves (R3 fix I2).
  check('Continue disabled before a pick', await p.isDisabled('[data-become] [data-become-go]'));
  await p.click('[data-become] label:has(input[value="guide"])');
  await p.waitForTimeout(600);
  check('a pick alone saves nothing', (await profile(v.id)).role === 'viewer' && await visible(p, '[data-become]'));
  check('…and enables Continue', !(await p.isDisabled('[data-become] [data-become-go]')));

  // A failed save says so, inline, and keeps the card.
  await p.route(`${SB}/rest/v1/profiles*`, (route) => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' }) : route.continue());
  await p.click('[data-become] [data-become-go]');
  await p.waitForFunction(() => (document.querySelector('[data-become-error]')?.textContent ?? '').length > 0, null, { timeout: 10000 }).catch(() => {});
  check('failed save: error shown inline', (await p.textContent('[data-become-error]').catch(() => '')).length > 0);
  check('failed save: card stays, form stays hidden', await visible(p, '[data-become]') && !(await visible(p, '[data-create]')));
  check('failed save: still a viewer', (await profile(v.id)).role === 'viewer');
  await p.unroute(`${SB}/rest/v1/profiles*`);

  // Keyboard: guide is checked; ArrowLeft moves to Учител without saving,
  // then Enter on Continue saves role=creator, work=teacher - no reload.
  await p.evaluate(() => { window.__noReload = 1; });
  await p.focus('[data-become] input[value="guide"]');
  await p.keyboard.press('ArrowLeft');
  await p.waitForTimeout(600);
  check('keyboard: arrow moves the pick to Учител', await p.isChecked('[data-become] input[value="teacher"]'));
  check('keyboard: the arrow saved nothing', (await profile(v.id)).role === 'viewer' && await visible(p, '[data-become]'));
  await p.focus('[data-become] [data-become-go]');
  await p.keyboard.press('Enter');
  await p.waitForSelector('[data-create]:not([hidden])', { timeout: 10000 }).catch(() => {});
  check('picking Учител reveals the create form', await visible(p, '[data-create]'));
  check('…category preset to education', (await p.inputValue('[data-new-category]').catch(() => '')) === 'education');
  check('…teacher gets both questions', (await p.$$eval('[data-create] legend', (l) => l.length).catch(() => 0)) === 2);
  check('…card gone', !(await visible(p, '[data-become]')));
  check('…without a reload', await p.evaluate(() => window.__noReload === 1));
  const pv = await profile(v.id);
  check('DB: role=creator, work=teacher', pv.role === 'creator' && pv.work === 'teacher', JSON.stringify(pv));
  const cb = await badge(p);
  check('header badge repaints live: square teacher', cb?.shape === 'square' && cb?.glyph === 'teacher' && cb?.label === 'Образование · създател', JSON.stringify(cb));

  // 2. A viewer in the builder of their own trail: a notice, and the builder works.
  const w = await makeUser('vp-builder', { role: 'viewer', work: 'broker' });
  const wt = await trail(w, 'Строя като зрител');
  const [{ id: wstop }] = await sql(`insert into public.markers (world_id, location, style_key, colour_hex, content, status, step, radius_m, created_by)
    values ($1, extensions.st_makepoint(26.5035, 42.4842)::extensions.geography, 'pin', '#0066cc', '{"bg":{"title":"Стара"}}', 'published', 1, 30, $2) returning id`, [wt, w.id]);
  const bp = await page();
  await signIn(bp, w);
  await bp.goto(`${BASE}/trail/?id=${wt}`);
  await bp.waitForSelector('[data-guarded]:not([hidden])', { timeout: 20000 });
  await bp.waitForSelector('[data-map] canvas', { timeout: 20000 }).catch(() => {});
  await bp.waitForTimeout(800);
  check('builder: viewer notice shows', await visible(bp, '[data-viewer-notice]'));
  check('…with the notice copy', (await bp.textContent('[data-viewer-notice] p').catch(() => '')).trim()
    === 'Ти си зрител. Стани създател, за да виждаш инструментите за твоето занимание.');
  check('…an aside without role=status', await bp.$eval('[data-viewer-notice]', (el) => el.tagName === 'ASIDE' && !el.hasAttribute('role')));
  check('…button still Стани създател', (await bp.textContent('[data-viewer-notice] [data-become-open]')).trim() === 'Стани създател');
  check('builder: not blocked (name shown)', (await bp.textContent('[data-trail-name]')).trim() === 'Строя като зрител');
  check('builder: full tool set for a viewer (question step present)',
    (await bp.$$eval('[data-step]', (l) => l.map((x) => x.dataset.step))).includes('question'));
  await bp.click('[data-viewer-notice] [data-become-open]');
  await bp.waitForTimeout(400);
  check('builder: the button opens the four seals', await visible(bp, '[data-become-dialog] [data-become]')
    && (await bp.$$('[data-become-dialog] input[name="work"]')).length === 4);
  // An open stop with an unsaved title (R3 fix I1): kept through the reload.
  await bp.click('[data-become-dialog] [data-become-close]');
  await bp.click(`[data-pick="${wstop}"]`);
  await bp.waitForSelector('[data-marker-form]:not(.hidden)', { timeout: 15000 });
  await bp.fill('input[name=titleBg]', 'Неспасено заглавие');
  await bp.click('[data-viewer-notice] [data-become-open]');
  await bp.waitForTimeout(400);
  check('builder dialog: Continue disabled before a pick', await bp.isDisabled('[data-become-dialog] [data-become-go]'));
  await bp.click('[data-become-dialog] label:has(input[value="guide"])');
  await bp.waitForTimeout(400);
  check('builder dialog: a pick alone saves nothing', (await profile(w.id)).role === 'viewer');
  await bp.click('[data-become-dialog] [data-become-go]');
  await bp.waitForFunction(() => !document.querySelector('[data-viewer-notice]') || document.querySelector('[data-viewer-notice]').hidden, null, { timeout: 15000 }).catch(() => {});
  await bp.waitForSelector('[data-guarded]:not([hidden])', { timeout: 20000 });
  const pw = await profile(w.id);
  check('builder: picking guide makes a creator', pw.role === 'creator' && pw.work === 'guide', JSON.stringify(pw));
  check('builder: notice gone after', !(await visible(bp, '[data-viewer-notice]')));
  const [ms] = await sql(`select content from public.markers where id = $1`, [wstop]);
  check('builder: unsaved stop title was saved before the reload', ms.content?.bg?.title === 'Неспасено заглавие', JSON.stringify(ms.content));

  // A creator never sees the notice.
  const c = await makeUser('vp-creator', { role: 'creator', work: 'teacher' });
  const ct = await trail(c, 'Създателски');
  const cp = await page();
  await signIn(cp, c);
  await cp.goto(`${BASE}/trail/?id=${ct}`);
  await cp.waitForSelector('[data-guarded]:not([hidden])', { timeout: 20000 });
  await cp.waitForTimeout(800);
  check('builder: no notice for a creator', !(await visible(cp, '[data-viewer-notice]')));
  const cbadge = await badge(cp);
  check('header badge: square teacher for a creator', cbadge?.shape === 'square' && cbadge?.glyph === 'teacher' && cbadge?.label === 'Образование · създател', JSON.stringify(cbadge));
  await mine(cp);
  check('creator: no become card', !(await visible(cp, '[data-become]')));
  check('creator: New trail tile shows', await visible(cp, '[data-new-open]'));

  // 3. Account settings: creator -> viewer -> creator, with the badge live.
  const ap = await page();
  await signIn(ap, c);
  await ap.goto(`${BASE}/account/#settings`);
  await ap.waitForSelector('[data-role-settings] [data-role-picker]', { timeout: 20000 });
  await ap.waitForTimeout(1200);
  check('settings: section titled Как ползваш AR Trail', (await ap.textContent('[data-role-settings] h2').catch(() => '')).trim() === 'Как ползваш AR Trail');
  check('settings: creator pre-selected', await ap.isChecked('[data-role-settings] input[name="role"][value="creator"]'));
  check('settings: teacher pre-selected', await ap.isChecked('[data-role-settings] input[name="work"][value="teacher"]'));
  check('settings: old standalone work form gone', (await ap.$$('[data-work-form]')).length === 0);
  const hb = await badge(ap, '.hero-me');
  check('account header: badge beside the name', hb && hb.shape === 'square' && hb.glyph === 'teacher', JSON.stringify(hb));
  await ap.click('[data-role-settings] label:has(input[name="role"][value="viewer"])');
  check('settings: viewer hides the work question', !(await visible(ap, '[data-role-settings] [data-work-section]')));
  await ap.click('[data-role-settings] [data-role-save]');
  await ap.waitForFunction(() => document.querySelector('[data-role-msg]')?.textContent.includes('Запазено'), null, { timeout: 10000 }).catch(() => {});
  check('settings: Запазено after viewer', (await ap.textContent('[data-role-msg]')).includes('Запазено'));
  const pa = await profile(c.id);
  check('DB: role=viewer, work kept', pa.role === 'viewer' && pa.work === 'teacher', JSON.stringify(pa));
  const ab = await badge(ap);
  check('header badge live: round', ab?.shape === 'round' && ab?.label === 'Зрител', JSON.stringify(ab));
  check('account header badge live: round', (await badge(ap, '.hero-me'))?.shape === 'round');
  // A viewer's kept work is offered back on switching to creator (fix M3).
  await ap.reload();
  await ap.waitForSelector('[data-role-settings] [data-role-picker]', { timeout: 20000 });
  await ap.waitForTimeout(1200);
  check('settings reload: viewer pre-selected', await ap.isChecked('[data-role-settings] input[name="role"][value="viewer"]'));
  await ap.click('[data-role-settings] label:has(input[name="role"][value="creator"])');
  check('settings: viewer -> creator pre-fills the kept work (teacher)', await ap.isChecked('[data-role-settings] input[name="work"][value="teacher"]'));
  await ap.click('[data-role-settings] label:has(input[name="work"][value="broker"])');
  await ap.click('[data-role-settings] [data-role-save]');
  await ap.waitForTimeout(300);
  await ap.waitForFunction(() => document.querySelector('[data-role-msg]')?.textContent.includes('Запазено'), null, { timeout: 10000 }).catch(() => {});
  const pb = await profile(c.id);
  check('DB: back to creator + broker', pb.role === 'creator' && pb.work === 'broker', JSON.stringify(pb));
  const bb = await badge(ap);
  check('header badge live: square broker', bb?.shape === 'square' && bb?.glyph === 'broker' && bb?.label === 'Недвижими имоти · създател', JSON.stringify(bb));
  // Creator without a job: asked to choose, nothing stored.
  await ap.evaluate(() => document.querySelectorAll('[data-role-settings] input[name="work"]').forEach((r) => { r.checked = false; }));
  await ap.click('[data-role-settings] [data-role-save]');
  await ap.waitForTimeout(600);
  check('settings: creator with no job asks for one', (await ap.textContent('[data-role-msg]')).length > 0
    && !(await ap.textContent('[data-role-msg]')).includes('Запазено'));

  // EN copy.
  const e = await makeUser('vp-en', { role: 'viewer' });
  const ep = await page();
  await signIn(ep, e, '/en');
  await mine(ep, '/en');
  await ep.goto(`${BASE}/en/my-trails/?new=1`);
  await ep.waitForSelector('[data-guarded]:not([hidden])', { timeout: 20000 });
  await ep.waitForTimeout(1200);
  check('viewer: ?new=1 is cleared too', !ep.url().includes('new=1'), ep.url());
  check('EN: Become a creator', (await ep.textContent('[data-become] h2').catch(() => '')).trim() === 'Become a creator');
  check('EN: badge label Viewer', (await badge(ep))?.label === 'Viewer');
  await ep.goto(`${BASE}/en/account/#settings`);
  await ep.waitForSelector('[data-role-settings] h2', { timeout: 20000 });
  check('EN: settings title', (await ep.textContent('[data-role-settings] h2')).trim() === 'How you use AR Trail');

  // 4. No role yet: no badge (on the exempt choose-role screen).
  const n = await makeUser('vp-null', { role: null });
  const np = await page();
  await signIn(np, n);
  await np.goto(`${BASE}/choose-role/`);
  await np.waitForTimeout(2000);
  const nb = await badge(np);
  check('role null: no header badge', !nb || nb.hidden, JSON.stringify(nb));

  // 5. Dark: the badge stays readable; phone width: no sideways scroll.
  const dp = await page(1280, 900, 'dark');
  await signIn(dp, e);
  await mine(dp);
  const db = await badge(dp);
  check('dark: badge visible', db && !db.hidden, JSON.stringify(db));
  await shot(dp, 'r3-mytrails-viewer-dark.png');
  await dp.screenshot({ path: path.join(SHOTS, 'r3-badge-viewer-dark.png'), clip: { x: 900, y: 0, width: 380, height: 64 } });
  const dcp = await page(1280, 900, 'dark');
  await signIn(dcp, c);
  await dcp.goto(`${BASE}/account/`);
  await dcp.waitForSelector('[data-guarded]:not([hidden])', { timeout: 20000 });
  await shot(dcp, 'r3-account-creator-dark.png');
  const lcp = await page();
  await signIn(lcp, c);
  await lcp.goto(`${BASE}/account/#settings`);
  await lcp.waitForSelector('[data-role-settings] [data-role-picker]', { timeout: 20000 });
  await lcp.waitForTimeout(800);
  await lcp.screenshot({ path: path.join(SHOTS, 'r3-account-settings-light.png'), fullPage: true });
  await lcp.screenshot({ path: path.join(SHOTS, 'r3-badge-creator-light.png'), clip: { x: 900, y: 0, width: 380, height: 64 } });
  const php = await page(390, 844);
  await signIn(php, e);
  await mine(php);
  check('phone: no sideways scroll', await php.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  check('phone: badge shows', !(await badge(php))?.hidden);
  await php.screenshot({ path: path.join(SHOTS, 'r3-mytrails-viewer-phone.png'), fullPage: true });

  check('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
  await cleanUsers();
}
done();
