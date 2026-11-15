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
const seal = (p) => p.$eval('[data-stage] [data-seal]', (el) => ({
  shape: el.dataset.sealShape, glyph: el.dataset.sealGlyph, pip: el.dataset.sealPip, selected: el.dataset.selected }));
// W2: the A5 stage replaced the seal panel. Its chip says the choice; only the shown state counts.
const shown = (p, sel) => p.$$eval(`[data-stage] ${sel}`, (l) => l.filter((e) => e.getClientRects().length).map((e) => e.textContent.trim()));
const chip = async (p) => (await shown(p, '[data-stage-tag]')).join('|');
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

async function page(width = 1280, height = 900, scheme = 'light') {
  const ctx = await b.newContext({ viewport: { width, height }, colorScheme: scheme });
  await ctx.addInitScript(() => { try { localStorage.setItem('artrail-cookies-ok', '1'); } catch {} });
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
  check('heading is the question', (await p.textContent('h1')).trim() === 'Как ще използваш меАРк?');
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
  check('viewer: stage chip Зрител', (await chip(p)) === 'Зрител', await chip(p));
  check('viewer: three signs on the stage', (await shown(p, '.stage-sign')).length === 3);
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
  check('creator without a work: err.work', (await p.textContent('[data-role-error]')).includes('Избери с какво се занимаваш.'));
  check('…and nothing stored', (await profile(n.id)).role === null);
  await p.check('input[name="work"][value="broker"]');
  s = await seal(p);
  check('creator + broker: square, house, pencil pip', s.shape === 'square' && s.glyph === 'broker' && s.pip === 'true', JSON.stringify(s));
  check('broker stage chip', (await chip(p)) === 'Недвижими имоти · създател', await chip(p));
  await p.waitForTimeout(400);
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
  await p2.waitForURL((u) => u.pathname === '/choose-role/', { timeout: 15000 }).catch(() => {});
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
  await p2.check('input[name="role"][value="creator"]');
  check('failed save: message stays when the picker changes', await p2.isVisible('[data-role-error]')
    && (await p2.textContent('[data-role-error]')).includes('stubbed failure'));
  await p2.check('input[name="role"][value="viewer"]');
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
  check('EN screen heading', (await p3.textContent('h1')).trim() === 'How will you use meARc?');
  await p3.goto(`${BASE}/en/view/?id=00000000-0000-0000-0000-000000000000#map`);
  await p3.waitForURL((u) => u.pathname.startsWith('/en/choose-role'), { timeout: 15000 }).catch(() => {});
  check('EN page sends to /en/choose-role/', new globalThis.URL(p3.url()).pathname === '/en/choose-role/', p3.url());
  check('next keeps the query and the hash', new globalThis.URL(p3.url()).searchParams.get('next') === '/en/view/?id=00000000-0000-0000-0000-000000000000#map', p3.url());

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
  await sp.waitForSelector('[data-stage] [data-seal]');
  check('sign-up heading', (await sp.textContent('h1')).trim() === 'Създай профил');
  check('sign-up keeps the account fields', (await sp.$$('#email, #password, #name, input[name="age"], [data-auth-agree]')).length === 4);  // name, email, password, agree - the age radios are hidden (ASK_AGE = false)
  s = await seal(sp);
  check('sign-up seal starts as the question', s.shape === 'ask', JSON.stringify(s));
  await sp.screenshot({ path: path.join(SHOTS, 'r2-signup-desktop-light.png'), fullPage: true });
  await sp.fill('#email', 'lab-test-stub@example.com');
  await sp.fill('#password', 'Lab-test-password-1');
  await sp.check('[data-auth-agree]');
  await sp.click('[data-auth-submit]');
  await sp.waitForTimeout(500);
  check('sign-up without a role: err.role, no request', (await sp.textContent('[data-auth-error]')).includes('Избери как ще използваш меАРк.') && signups.length === 0);
  await sp.check('input[name="role"][value="creator"]');
  s = await seal(sp);
  check('sign-up seal repaints on click (creator)', s.shape === 'square' && s.glyph === 'pencil', JSON.stringify(s));
  await sp.click('[data-auth-submit]');
  await sp.waitForTimeout(500);
  check('sign-up as creator without a work: err.work', (await sp.textContent('[data-auth-error]')).includes('Избери с какво се занимаваш.'));
  check('…and no request', signups.length === 0);
  await sp.check('input[name="work"][value="teacher"]');
  check('choosing a job clears the "choose one" message', !(await sp.isVisible('[data-auth-error]')));
  s = await seal(sp);
  check('sign-up seal: teacher with pip', s.shape === 'square' && s.glyph === 'teacher' && s.pip === 'true', JSON.stringify(s));
  await sp.waitForTimeout(400);
  await sp.screenshot({ path: path.join(SHOTS, 'r2-signup-desktop-teacher-light.png'), fullPage: true });
  await sp.click('[data-auth-submit]');
  await sp.waitForTimeout(1500);
  check('creator sign-up sends role + work', signups[0]?.data?.role === 'creator' && signups[0]?.data?.work === 'teacher', JSON.stringify(signups[0]?.data));
  check("creator sign-up sends age_band '14+' with no age question", signups[0]?.data?.age_band === '14+', JSON.stringify(signups[0]?.data));
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
  await ph.waitForSelector('[data-stage] [data-seal]');
  check('390px: no sideways scroll on sign-up', await noSideways(ph));
  const sealBox = await ph.$eval('[data-stage] [data-seal]', (el) => Math.round(el.getBoundingClientRect().width));
  check('390px: 24px seal in the hero chip', sealBox === 24, String(sealBox));
  await ph.check('input[name="role"][value="creator"]');
  await ph.check('input[name="work"][value="guide"]');
  await ph.waitForTimeout(400);
  check('390px: still no sideways scroll after choosing', await noSideways(ph));
  await ph.screenshot({ path: path.join(SHOTS, 'r2-signup-phone-light.png'), fullPage: true });
  const en = await page(1280, 900);
  await en.goto(`${BASE}/en/signup/`);
  await en.waitForSelector('[data-stage] [data-seal]');
  check('EN sign-up question', (await en.textContent('[data-role-question]')).trim() === 'How will you use meARc?');
  for (const [w, h, name] of [[1280, 900, 'r2-signup-desktop-dark.png'], [390, 900, 'r2-signup-phone-dark.png']]) {
    const d = await page(w, h, 'dark');
    await d.goto(`${BASE}/signup/`);
    await d.waitForSelector('[data-stage] [data-seal]');
    await d.check('input[name="role"][value="creator"]');
    await d.check('input[name="work"][value="broker"]');
    await d.waitForTimeout(400);
    await d.screenshot({ path: path.join(SHOTS, name), fullPage: true });
  }
  const dk = await page(1280, 900, 'dark');
  const dkBad = [];
  dk.on('response', (r) => { if (r.status() >= 400) dkBad.push(`${r.status()} ${r.request().method()} ${r.url().split('?')[0]}`); });
  const dku = await makeUser('cr-dark', { role: null, work: 'teacher' });
  await signIn(dk, dku);
  // Signing in lands on / and the gate moves on to choose-role; let that
  // finish first, or it can replace the page the next goto opens.
  await dk.waitForURL((u) => u.pathname === '/choose-role/', { timeout: 15000 }).catch(() => {});
  await dk.goto(`${BASE}/choose-role/`);
  await dk.waitForSelector('[data-role-form]:not([hidden])', { timeout: 15000 });
  await dk.waitForTimeout(500);
  // The end state of the colours, not a frame of the 0.2s transition: with
  // many pages open the headless browser may not advance this page's
  // animations, which left the old colours on screen in some runs.
  const dkState = await seal(dk);
  check('dark: seal state is the teacher creator', dkState.shape === 'square' && dkState.glyph === 'teacher' && dkState.selected === 'true', JSON.stringify(dkState));
  await dk.addStyleTag({ content: '*, *::before, *::after { transition: none !important; }' });
  const darkSeal = await dk.$eval('[data-stage] [data-seal]', (el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color]);
  check('dark: selected seal is white on #0066cc', darkSeal[0] === 'rgb(0, 102, 204)' && darkSeal[1] === 'rgb(255, 255, 255)', darkSeal.join(' / ') + ' | ' + dk.url() + ' | checked: ' + (await dk.$$eval('input:checked', (l) => l.map((i) => i.name + '=' + i.value).join(','))) + ' | bad: ' + dkBad.join(', '));
  await dk.screenshot({ path: path.join(SHOTS, 'r2-choose-role-dark.png'), fullPage: true });


  // ------------------------------------------------ fix round 1
  // An empty error line never shows.
  const fresh = await page(1280, 900);
  await fresh.goto(`${BASE}/signup/`);
  await fresh.waitForSelector('[data-stage] [data-seal]');
  check('sign-up: empty error line is not displayed', !(await fresh.isVisible('[data-auth-error]')));
  await fresh.$eval('[data-auth-error]', (el) => { el.classList.remove('hidden'); el.hidden = false; el.classList.add('form-msg', 'is-error'); });
  check('…even with its hidden class taken off', !(await fresh.isVisible('[data-auth-error]')));

  // Open redirects: ?next= that leaves the site falls back to the default.
  const bads = { tab: '/\t/evil.com', backslash: '/\\evil.com', 'protocol-relative': '//evil.com', 'dot segment': '/.//evil.com', javascript: 'javascript:alert(1)', 'full URL': 'https://evil.com/trails/' };
  const r1 = await makeUser('cr-redir', { role: null, work: null });
  const rp = await page();
  await signIn(rp, r1);
  await rp.waitForURL((u) => u.pathname === '/choose-role/', { timeout: 15000 }).catch(() => {});
  for (const [name, bad] of Object.entries(bads)) {
    await sql(`update public.profiles set role = null where id = $1`, [r1.id]);
    await rp.goto(`${BASE}/choose-role/?next=${encodeURIComponent(bad)}`);
    await rp.waitForSelector('[data-role-form]:not([hidden])', { timeout: 15000 });
    await rp.check('input[name="role"][value="viewer"]');
    await rp.click('[data-role-submit]');
    await rp.waitForURL((u) => !u.pathname.startsWith('/choose-role'), { timeout: 15000 }).catch(() => {});
    const at = new globalThis.URL(rp.url());
    check(`choose-role ignores next (${name})`, at.origin === BASE && at.pathname === '/trails/', rp.url());
  }
  await sql(`update public.profiles set role = null where id = $1`, [r1.id]);
  await rp.goto(`${BASE}/choose-role/?next=${encodeURIComponent('/view/?id=x#top')}`);
  await rp.waitForSelector('[data-role-form]:not([hidden])', { timeout: 15000 });
  await rp.check('input[name="role"][value="viewer"]');
  await rp.click('[data-role-submit]');
  await rp.waitForURL((u) => u.pathname === '/view/', { timeout: 15000 }).catch(() => {});
  check('choose-role still follows a same-site next with query', new globalThis.URL(rp.url()).pathname === '/view/' && rp.url().includes('id=x'), rp.url());

  // The same on accept-terms (the bug was there first).
  for (const [name, bad] of Object.entries({ tab: '/\t/evil.com', backslash: '/\\evil.com' })) {
    await sql(`update public.profiles set terms_version = '2000-01-01' where id = $1`, [r1.id]);
    await rp.goto(`${BASE}/accept-terms/?next=${encodeURIComponent(bad)}`);
    await rp.waitForSelector('[data-gate]', { timeout: 15000 });
    await rp.waitForTimeout(500);
    await rp.check('[data-gate-agree]');
    await rp.click('[data-gate-submit]');
    await rp.waitForURL((u) => !u.pathname.startsWith('/accept-terms'), { timeout: 15000 }).catch(() => {});
    const at = new globalThis.URL(rp.url());
    check(`accept-terms ignores next (${name})`, at.origin === BASE && !at.pathname.startsWith('/accept-terms'), rp.url());
  }

  // Terms and role both owed on a public page: terms, then role, then back.
  const both = await makeUser('cr-both', { role: null, work: null });
  const bp = await page();
  await signIn(bp, both);
  await sql(`update public.profiles set terms_version = '2000-01-01' where id = $1`, [both.id]);
  await bp.goto(`${BASE}/trails/`);
  await bp.waitForURL((u) => u.pathname === '/accept-terms/', { timeout: 15000 }).catch(() => {});
  const ta = new globalThis.URL(bp.url());
  check('terms + role owed on /trails/: lands on accept-terms', ta.pathname === '/accept-terms/', bp.url());
  check('…with choose-role (then /trails/) as next', ta.searchParams.get('next') === '/choose-role/?next=%2Ftrails%2F', ta.searchParams.get('next'));
  await bp.waitForSelector('[data-gate]', { timeout: 15000 });
  await bp.waitForTimeout(500);
  check('accept-terms asks no age (ASK_AGE = false)', (await bp.$$('input[name="age"], [data-parent]')).length === 0);
  const accepts = [];
  await bp.route(`${SB}/rest/v1/rpc/accept_terms*`, (route) => { accepts.push(route.request().postDataJSON()); return route.continue(); });
  await bp.check('[data-gate-agree]');
  await bp.click('[data-gate-submit]');
  await bp.waitForURL((u) => u.pathname === '/choose-role/', { timeout: 15000 }).catch(() => {});
  check('accepting the terms leads on to choose-role', new globalThis.URL(bp.url()).pathname === '/choose-role/', bp.url());
  check('accept-terms sends what a 14+ choice sent (p_under14 false)', accepts.length === 1 && accepts[0].p_under14 === false, JSON.stringify(accepts));
  await bp.waitForSelector('[data-role-form]:not([hidden])', { timeout: 15000 });
  await bp.check('input[name="role"][value="viewer"]');
  await bp.click('[data-role-submit]');
  await bp.waitForURL((u) => u.pathname === '/trails/', { timeout: 15000 }).catch(() => {});
  check('…and choosing returns to /trails/', new globalThis.URL(bp.url()).pathname === '/trails/', bp.url());
  check('…with role saved', (await profile(both.id)).role === 'viewer');
  // The same in English keeps the /en/ prefix.
  await sql(`update public.profiles set terms_version = '2000-01-01', role = null where id = $1`, [both.id]);
  await bp.goto(`${BASE}/en/trails/`);
  await bp.waitForURL((u) => u.pathname === '/en/accept-terms/', { timeout: 15000 }).catch(() => {});
  const te = new globalThis.URL(bp.url());
  check('EN: terms + role owed keeps /en/', te.pathname === '/en/accept-terms/' && te.searchParams.get('next') === '/en/choose-role/?next=%2Fen%2Ftrails%2F', bp.url());
  await sql(`update public.profiles set terms_version = '2026-09-29' where id = $1`, [both.id]);

  // At most one gate read of the profile per page.
  const set = await makeUser('cr-reads');
  const cp = await page();
  await signIn(cp, set);
  for (const at of ['/trails/', '/my-trails/', '/account/']) {
    const reads = [];
    const onReq = (r) => { if (r.method() === 'GET' && /rest\/v1\/profiles/.test(r.url()) && /select=(terms_version|role)/.test(r.url())) reads.push(r.url()); };
    cp.on('request', onReq);
    await cp.goto(`${BASE}${at}`);
    await cp.waitForTimeout(2500);
    cp.off('request', onReq);
    check(`one gate profile read on ${at}`, reads.length === 1, `${reads.length}: ${reads.map((u) => decodeURIComponent(u.split('?')[1])).join(' | ')}`);
  }

  check('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
  if (guests.length) await sql(`delete from auth.users where id = any($1::uuid[])`, [guests]);
  await cleanUsers();
}
done();
