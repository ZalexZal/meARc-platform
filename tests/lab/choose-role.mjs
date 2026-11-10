// Task R2: the one-time "creator or viewer" screen, the site-wide gate that
// sends people there, and the sign-up form with the live seal.
// Sign-up requests are stubbed (no real account, no email); the database path
// uses makeUser. Guests are made the way the app makes them and deleted by id.
import { browser, BASE, URL as SB, ANON, SHOTS, check, done, makeUser, cleanUsers, signIn, sql } from './lib.mjs';
import path from 'path';

const b = await browser();
const guests = [];
const errs = [];
const profile = async (id) => (await sql(`select role, work from public.profiles where id = $1`, [id]))[0];
const seal = (p) => p.$eval('[data-role-panel] [data-seal]', (el) => ({
  shape: el.dataset.sealShape, glyph: el.dataset.sealGlyph, pip: el.dataset.sealPip, selected: el.dataset.selected }));
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

async function page(width = 1280, height = 900, scheme = 'light') {
  const ctx = await b.newContext({ viewport: { width, height }, colorScheme: scheme });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`${p.url()}: ${e.message}`));
  return p;
}
// Lets the gate run, then says where the page ended up.
async function settle(p, ms = 2500) { await p.waitForTimeout(ms); return new globalThis.URL(p.url()); }

try {
  // 1. A never-asked account opening /trails/ is sent to the screen, with next.
  const n = await makeUser('cr-null', { role: null, work: null });
  const p = await page();
  await signIn(p, n);
  await p.goto(`${BASE}/trails/`);
  await p.waitForURL((u) => u.pathname.startsWith('/choose-role'), { timeout: 15000 }).catch(() => {});
  const u1 = new globalThis.URL(p.url());
  check('role-null user on /trails/ lands on /choose-role/', u1.pathname === '/choose-role/', p.url());
  check('…with next=/trails/', u1.searchParams.get('next') === '/trails/', u1.search);

  // Nothing chosen: the dashed question mark, the waiting CTA.
  await p.waitForSelector('[data-role-form]:not([hidden])', { timeout: 15000 });
  check('heading is the question', (await p.textContent('h1')).trim() === 'Как ще използвате AR Trail?');
  check('nothing pre-selected for a never-asked account', (await p.$$('input[name="role"]:checked')).length === 0);
  let s = await seal(p);
  check('seal starts as the dashed question', s.shape === 'ask' && s.glyph === 'ask' && s.pip === 'false', JSON.stringify(s));
  check('CTA waits until the choice is complete', await p.$eval('[data-role-submit]', (el) => el.classList.contains('is-waiting')));
  check('work question hidden before a choice', !(await p.isVisible('[data-work-section]')));
  check('no account fields on the screen', (await p.$$('#email, #password')).length === 0);

  // The seal follows each click.
  await p.check('input[name="role"][value="viewer"]');
  s = await seal(p);
  check('viewer: round seal with the eye', s.shape === 'round' && s.glyph === 'viewer' && s.pip === 'false' && s.selected === 'true', JSON.stringify(s));
  check('viewer: panel title Зрител', (await p.textContent('[data-role-title]')).trim() === 'Зрител');
  check('viewer: three things you get', (await p.$$('[data-role-gets] li')).length === 3);
  check('viewer: no work question, the note instead', !(await p.isVisible('[data-work-section]')) && await p.isVisible('[data-viewer-note]'));
  check('viewer: CTA ready', !(await p.$eval('[data-role-submit]', (el) => el.classList.contains('is-waiting'))));
  await p.check('input[name="role"][value="creator"]');
  s = await seal(p);
  check('creator, no work: square pencil', s.shape === 'square' && s.glyph === 'pencil' && s.pip === 'false', JSON.stringify(s));
  check('creator: the work question shows', await p.isVisible('[data-work-section]'));
  check('creator without work: CTA waits', await p.$eval('[data-role-submit]', (el) => el.classList.contains('is-waiting')));
  const order = await p.$$eval('input[name="work"]', (r) => r.map((x) => x.value));
  check('work cards in the mockup order', order.join() === 'teacher,guide,broker,other', order.join());
  // Saving creator with no work says so and stores nothing.
  await p.click('[data-role-submit]');
  await p.waitForTimeout(500);
  check('creator without a work: err.work', (await p.textContent('[data-role-error]')).includes('Изберете с какво се занимавате.'));
  check('…and nothing stored', (await profile(n.id)).role === null);
  await p.check('input[name="work"][value="broker"]');
  s = await seal(p);
  check('creator + broker: square, house, pencil pip', s.shape === 'square' && s.glyph === 'broker' && s.pip === 'true', JSON.stringify(s));
  check('broker panel title', (await p.textContent('[data-role-title]')).trim() === 'Брокер · създател');
  await p.screenshot({ path: path.join(SHOTS, 'r2-choose-role-light.png'), fullPage: true });

  // 2. Creator + broker saves both and goes on to next.
  await p.click('[data-role-submit]');
  await p.waitForURL((u) => u.pathname === '/trails/', { timeout: 15000 }).catch(() => {});
  check('save goes on to next (/trails/)', new globalThis.URL(p.url()).pathname === '/trails/', p.url());
  const pn = await profile(n.id);
  check('creator + broker stored in one go', pn.role === 'creator' && pn.work === 'broker', JSON.stringify(pn));
  // 3. Answered: never sent back.
  await p.goto(`${BASE}/my-trails/`);
  check('a role-set account is not redirected (My trails)', (await settle(p)).pathname === '/my-trails/', p.url());
  check('the old one-time work card is gone', (await p.$$('[data-work-ask]')).length === 0);
  await p.goto(`${BASE}/trails/`);
  check('a role-set account is not redirected (/trails/)', (await settle(p)).pathname === '/trails/', p.url());

  // 4. work=guide: creator + guide pre-selected; choosing viewer keeps work.
  const g = await makeUser('cr-guide', { role: null, work: 'guide' });
  const p2 = await page(390, 900);
  await signIn(p2, g);
  await p2.goto(`${BASE}/choose-role/`);
  await p2.waitForSelector('[data-role-form]:not([hidden])', { timeout: 15000 });
  await p2.waitForTimeout(500);
  check('work=guide: creator pre-selected', await p2.isChecked('input[name="role"][value="creator"]'));
  check('work=guide: guide pre-selected', await p2.isChecked('input[name="work"][value="guide"]'));
  s = await seal(p2);
  check('work=guide: seal is the guide flag with a pip', s.shape === 'square' && s.glyph === 'guide' && s.pip === 'true', JSON.stringify(s));
  check('390px: no sideways scroll on choose-role', await noSideways(p2));
  const cards = await p2.$$eval('[data-role-cards] .pick-card', (l) => l.map((x) => Math.round(x.getBoundingClientRect().top)));
  check('390px: role cards two-up', cards.length === 2 && cards[0] === cards[1], cards.join());
  const jobs = await p2.$$eval('[data-work-section] .pick-card', (l) => l.map((x) => Math.round(x.getBoundingClientRect().top)));
  check('390px: jobs 2×2', jobs.length === 4 && jobs[0] === jobs[1] && jobs[2] === jobs[3] && jobs[2] > jobs[0], jobs.join());
  await p2.screenshot({ path: path.join(SHOTS, 'r2-choose-role-phone.png'), fullPage: true });

  // A failed save is said inline, and nothing moves.
  await p2.route(`${SB}/rest/v1/profiles*`, (route) => route.request().method() === 'PATCH'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'stubbed failure' }) })
    : route.continue());
  await p2.check('input[name="role"][value="viewer"]');
  await p2.click('[data-role-submit]');
  await p2.waitForTimeout(1500);
  check('failed save: error shown inline', (await p2.textContent('[data-role-error]')).trim().length > 0
    && await p2.isVisible('[data-role-error]'));
  check('failed save: still on the screen', new globalThis.URL(p2.url()).pathname === '/choose-role/');
  await p2.unroute(`${SB}/rest/v1/profiles*`);
  await p2.click('[data-role-submit]');
  await p2.waitForURL((u) => u.pathname === '/trails/', { timeout: 15000 }).catch(() => {});
  check('viewer without next goes to /trails/', new globalThis.URL(p2.url()).pathname === '/trails/', p2.url());
  const pg = await profile(g.id);
  check('viewer saved, work left untouched', pg.role === 'viewer' && pg.work === 'guide', JSON.stringify(pg));

  // 5. Exempt pages never redirect; terms come before the role.
  const e = await makeUser('cr-exempt', { role: null, work: null });
  const p3 = await page();
  await signIn(p3, e);
  for (const at of ['/terms/', '/privacy/', '/signup/', '/signin/', '/reset/', '/en/terms/', '/en/privacy/', '/en/choose-role/']) {
    await p3.goto(`${BASE}${at}`);
    const u = await settle(p3, 2000);
    check(`exempt: ${at} stays`, u.pathname === at, p3.url());
  }
  check('EN screen heading', (await p3.textContent('h1')).trim() === 'How will you use AR Trail?');
  await p3.goto(`${BASE}/en/view/?id=00000000-0000-0000-0000-000000000000`);
  await p3.waitForURL((u) => u.pathname.startsWith('/en/choose-role'), { timeout: 15000 }).catch(() => {});
  check('EN page sends to /en/choose-role/', new globalThis.URL(p3.url()).pathname === '/en/choose-role/', p3.url());

  // A failed profile read never redirects.
  await p3.route(`${SB}/rest/v1/profiles*`, (route) => route.request().method() === 'GET'
    ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'stubbed failure' }) })
    : route.continue());
  await p3.goto(`${BASE}/trails/`);
  check('failed profile read: no redirect', (await settle(p3)).pathname === '/trails/', p3.url());
  await p3.unroute(`${SB}/rest/v1/profiles*`);

  // Terms win when both apply.
  await sql(`update public.profiles set terms_version = '2000-01-01' where id = $1`, [e.id]);
  await p3.goto(`${BASE}/my-trails/`);
  await p3.waitForURL((u) => !u.pathname.startsWith('/my-trails'), { timeout: 15000 }).catch(() => {});
  await p3.waitForTimeout(1500);
  check('terms before role: lands on accept-terms', new globalThis.URL(p3.url()).pathname === '/accept-terms/', p3.url());

  // 6. A guest is never redirected.
  const r = await fetch(`${SB}/auth/v1/signup`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: '{}' });
  const session = await r.json();
  if (!session.user?.id) throw new Error('guest sign-up failed');
  guests.push(session.user.id);
  const ref = new globalThis.URL(SB).hostname.split('.')[0];
  const gctx = await b.newContext({ viewport: { width: 390, height: 900 } });
  await gctx.addInitScript(([k, v]) => { localStorage.setItem(k, v); }, [`sb-${ref}-auth-token`, JSON.stringify(session)]);
  const gp = await gctx.newPage();
  await gp.goto(`${BASE}/trails/`);
  check('a guest is not redirected', (await settle(gp)).pathname === '/trails/', gp.url());
  await gctx.close();

  // 7. Sign-up: the live seal, viewer sends no work, creator needs a work.
  const sp = await page(1280, 900);
  const signups = [];
  await sp.route(`${SB}/auth/v1/signup*`, async (route) => {
    signups.push(route.request().postDataJSON());
    await route.fulfill({ status: 422, contentType: 'application/json',
      body: JSON.stringify({ code: 422, error_code: 'user_already_exists', msg: 'User already registered' }) });
  });
  await sp.goto(`${BASE}/signup/`);
  await sp.waitForSelector('[data-role-panel] [data-seal]');
  check('sign-up heading', (await sp.textContent('h1')).trim() === 'Създайте профил');
  check('sign-up keeps the account fields', (await sp.$$('#email, #password, #name, input[name="age"], [data-auth-agree]')).length === 7);  // name, email, password, 3 age radios, agree
  s = await seal(sp);
  check('sign-up seal starts as the question', s.shape === 'ask', JSON.stringify(s));
  await sp.screenshot({ path: path.join(SHOTS, 'r2-signup-desktop-light.png'), fullPage: true });
  await sp.fill('#email', 'lab-test-stub@example.com');
  await sp.fill('#password', 'Lab-test-password-1');
  await sp.check('input[name="age"][value="14+"]');
  await sp.check('[data-auth-agree]');
  await sp.click('[data-auth-submit]');
  await sp.waitForTimeout(500);
  check('sign-up without a role: err.role, no request', (await sp.textContent('[data-auth-error]')).includes('Изберете как ще използвате AR Trail.') && signups.length === 0);
  await sp.check('input[name="role"][value="creator"]');
  s = await seal(sp);
  check('sign-up seal repaints on click (creator)', s.shape === 'square' && s.glyph === 'pencil', JSON.stringify(s));
  await sp.click('[data-auth-submit]');
  await sp.waitForTimeout(500);
  check('sign-up as creator without a work: err.work', (await sp.textContent('[data-auth-error]')).includes('Изберете с какво се занимавате.'));
  check('…and no request', signups.length === 0);
  await sp.check('input[name="work"][value="teacher"]');
  s = await seal(sp);
  check('sign-up seal: teacher with pip', s.shape === 'square' && s.glyph === 'teacher' && s.pip === 'true', JSON.stringify(s));
  await sp.screenshot({ path: path.join(SHOTS, 'r2-signup-desktop-teacher-light.png'), fullPage: true });
  await sp.click('[data-auth-submit]');
  await sp.waitForTimeout(1500);
  check('creator sign-up sends role + work', signups[0]?.data?.role === 'creator' && signups[0]?.data?.work === 'teacher', JSON.stringify(signups[0]?.data));
  await sp.check('input[name="role"][value="viewer"]');
  s = await seal(sp);
  check('sign-up seal: viewer', s.shape === 'round' && s.glyph === 'viewer', JSON.stringify(s));
  await sp.click('[data-auth-submit]');
  await sp.waitForTimeout(1500);
  const last = signups[signups.length - 1]?.data ?? {};
  check('viewer sign-up sends role=viewer', signups.length === 2 && last.role === 'viewer', JSON.stringify(last));
  check('viewer sign-up sends no work', !('work' in last), JSON.stringify(last));

  // Phone and dark.
  const ph = await page(390, 900);
  await ph.goto(`${BASE}/signup/`);
  await ph.waitForSelector('[data-role-panel] [data-seal]');
  check('390px: no sideways scroll on sign-up', await noSideways(ph));
  const sealBox = await ph.$eval('[data-role-panel] [data-seal]', (el) => Math.round(el.getBoundingClientRect().width));
  check('390px: 76px seal on top', sealBox === 76, String(sealBox));
  await ph.check('input[name="role"][value="creator"]');
  await ph.check('input[name="work"][value="guide"]');
  check('390px: still no sideways scroll after choosing', await noSideways(ph));
  await ph.screenshot({ path: path.join(SHOTS, 'r2-signup-phone-light.png'), fullPage: true });
  const en = await page(1280, 900);
  await en.goto(`${BASE}/en/signup/`);
  await en.waitForSelector('[data-role-panel] [data-seal]');
  check('EN sign-up question', (await en.textContent('[data-role-question]')).trim() === 'How will you use AR Trail?');
  for (const [w, h, name] of [[1280, 900, 'r2-signup-desktop-dark.png'], [390, 900, 'r2-signup-phone-dark.png']]) {
    const d = await page(w, h, 'dark');
    await d.goto(`${BASE}/signup/`);
    await d.waitForSelector('[data-role-panel] [data-seal]');
    await d.check('input[name="role"][value="creator"]');
    await d.check('input[name="work"][value="broker"]');
    await d.screenshot({ path: path.join(SHOTS, name), fullPage: true });
  }
  const dk = await page(1280, 900, 'dark');
  const dku = await makeUser('cr-dark', { role: null, work: 'teacher' });
  await signIn(dk, dku);
  await dk.goto(`${BASE}/choose-role/`);
  await dk.waitForSelector('[data-role-form]:not([hidden])', { timeout: 15000 });
  await dk.waitForTimeout(500);
  await dk.screenshot({ path: path.join(SHOTS, 'r2-choose-role-dark.png'), fullPage: true });

  check('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
  if (guests.length) await sql(`delete from auth.users where id = any($1::uuid[])`, [guests]);
  await cleanUsers();
}
done();
