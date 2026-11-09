// The website shows a trail (/view) and no longer plays it.
import { browser, BASE, SHOTS, check, done, makeUser, cleanUsers, sql } from './lib.mjs';
const CTF = '9232aef6-ae8b-48cd-9636-e1b85a2b1f4e', GUIDE = 'ad94367f-6f11-42f7-8d58-ce341302ab5c';
const b = await browser();
const errs = [];
try {
// A public real-estate trail that is still stored as a scored mode with a team in it:
// the page must show neither (hiding is complete, 9 Nov 2026).
const owner = await makeUser('view-estate');
const [{ id: ESTATE }] = await sql(`insert into public.worlds (owner_id, name, join_code, visibility, mode, status, category, city)
  values ($1, 'Lab view estate', 'LV' || substr(md5(random()::text), 1, 6), 'public', 'ctf', 'published', 'estate', $2::jsonb) returning id`,
  [owner.id, JSON.stringify({ key: 'yambol', bg: 'Ямбол', en: 'Yambol', lat: 42.4842, lng: 26.5035 })]);
await sql(`insert into public.teams (world_id, name, invite_code, created_by) values ($1, 'Lab view team', 'T' || substr(md5(random()::text), 1, 6), $2)`, [ESTATE, owner.id]);
for (const [w, h, tag] of [[1280, 900, 'desk'], [390, 844, 'phone']]) {
  for (const scheme of ['light', 'dark']) {
    const phone = tag === 'phone';
    const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, isMobile: phone, hasTouch: phone });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    const t = `${tag}/${scheme}`;
    await p.goto(`${BASE}/walk/?id=${CTF}`);
    await p.waitForURL(/\/view\//);
    check(`${t}: /walk redirects to /view with the id`, p.url().includes(`/view/?id=${CTF}`));
    await p.waitForSelector('[data-v-trail]:not([hidden])', { timeout: 15000 });
    const line = (await p.textContent('[data-v-mode]')) ?? '';
    check(`${t}: trail line starts with the mode, then category and city`, line.startsWith('Отбори и класиране · По ред · ') && line.split(' · ').length === 4, line);
    await p.waitForTimeout(3000);
    const stops = await p.$$eval('[data-v-stops] li', (l) => l.length);
    check(`${t}: stops listed and pinned`, stops > 0 && (await p.$$('.view-pin')).length === stops, `${stops}`);
    check(`${t}: live board on a points trail`, await p.isVisible('[data-v-board]'));
    check(`${t}: app link`, (await p.getAttribute('[data-v-app]', 'href')).startsWith(`intent://join/${CTF}`));
    // A phone opens the app; a computer gets the QR code instead (7 Nov 2026).
    if (phone) check(`${t}: open-in-app button, no QR`, await p.isVisible('[data-v-app]') && !(await p.isVisible('[data-v-qrbox]')));
    else check(`${t}: QR shown, no app button`, await p.isVisible('[data-v-qrbox] canvas') && !(await p.isVisible('[data-v-app]')));
    check(`${t}: download link to the APK`, (await p.$$eval('a[href="/ARTrail.apk"]', (a) => a.length)) > 0);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    check(`${t}: no horizontal scroll`, sw <= w, `${sw}`);
    await p.screenshot({ path: `${SHOTS}/view-${tag}-${scheme}.png`, fullPage: true });
    await p.goto(`${BASE}/en/view/?id=${GUIDE}`);
    await p.waitForSelector('[data-v-trail]:not([hidden])', { timeout: 15000 });
    await p.waitForTimeout(1500);
    check(`${t}: no points · in order, no board`, (await p.textContent('[data-v-mode]')).startsWith('No teams · In order') && !(await p.isVisible('[data-v-board]')));
    // The estate trail: "Category · City", no team count, no standings, no link to them.
    for (const [pre, want, bad] of [['', 'Недвижими имоти · Ямбол', /отбор|класиране/i], ['/en', 'Real estate · Yambol', /team|standings/i]]) {
      await p.goto(`${BASE}${pre}/view/?id=${ESTATE}`);
      await p.waitForSelector('[data-v-trail]:not([hidden])', { timeout: 15000 });
      await p.waitForTimeout(1500);
      check(`${t}${pre}: estate trail line is Category · City`, (await p.textContent('[data-v-mode]')) === want, await p.textContent('[data-v-mode]'));
      const body = await p.innerText('body');
      check(`${t}${pre}: estate trail page says nothing about teams or standings`, !bad.test(body), (body.match(bad) || [''])[0]);
      check(`${t}${pre}: no board, no standings link`, !(await p.isVisible('[data-v-board]')) && !(await p.isVisible('[data-v-boardlink]')) && (await p.$$('a[href*="/board"]')).length === 0);
    }
    await p.goto(`${BASE}/view/?id=00000000-0000-0000-0000-000000000000`);
    await p.waitForSelector('[data-v-none]:not([hidden])', { timeout: 15000 });
    check(`${t}: unknown trail says so`, true);
    await p.goto(`${BASE}/trails/`);
    await p.waitForSelector('[data-trails-list] li', { timeout: 15000 });
    const links = await p.$$eval('[data-trails-list] a', (a) => a.map((x) => x.getAttribute('href')));
    check(`${t}: list links to /view, never /walk`, links.some((l) => /^\/view\/?\?id=/.test(l)) && !links.some((l) => l.includes('/walk')));
    await p.screenshot({ path: `${SHOTS}/trails-${tag}-${scheme}.png`, fullPage: true });
    await ctx.close();
  }
}
const real = errs.filter((e) => !/favicon|tiles|sprite|glyph|ERR_|net::/i.test(e));
check('no page errors', real.length === 0, real.slice(0, 5).join(' | '));
} finally { await cleanUsers(); }
await b.close(); done();
