// The website shows a trail (/view) and no longer plays it.
import { browser, BASE, SHOTS, check, done } from './lib.mjs';
const CTF = '9232aef6-ae8b-48cd-9636-e1b85a2b1f4e', GUIDE = 'ad94367f-6f11-42f7-8d58-ce341302ab5c';
const b = await browser();
const errs = [];
for (const [w, h, tag] of [[1280, 900, 'desk'], [390, 844, 'phone']]) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    const t = `${tag}/${scheme}`;
    await p.goto(`${BASE}/walk/?id=${CTF}`);
    await p.waitForURL(/\/view\//);
    check(`${t}: /walk redirects to /view with the id`, p.url().includes(`/view/?id=${CTF}`));
    await p.waitForSelector('[data-v-trail]:not([hidden])', { timeout: 15000 });
    check(`${t}: mode line`, (await p.textContent('[data-v-mode]')) === 'Отбори и класиране · По ред');
    await p.waitForTimeout(3000);
    const stops = await p.$$eval('[data-v-stops] li', (l) => l.length);
    check(`${t}: stops listed and pinned`, stops > 0 && (await p.$$('.view-pin')).length === stops, `${stops}`);
    check(`${t}: live board on a points trail`, await p.isVisible('[data-v-board]'));
    check(`${t}: app link`, (await p.getAttribute('[data-v-app]', 'href')).startsWith(`intent://join/${CTF}`));
    await p.click('[data-v-qr]');
    check(`${t}: QR opens`, await p.isVisible('[data-v-qrbox] canvas'));
    const sw = await p.evaluate(() => document.documentElement.scrollWidth);
    check(`${t}: no horizontal scroll`, sw <= w, `${sw}`);
    await p.screenshot({ path: `${SHOTS}/view-${tag}-${scheme}.png`, fullPage: true });
    await p.goto(`${BASE}/en/view/?id=${GUIDE}`);
    await p.waitForSelector('[data-v-trail]:not([hidden])', { timeout: 15000 });
    await p.waitForTimeout(1500);
    check(`${t}: no points · in order, no board`, (await p.textContent('[data-v-mode]')) === 'No teams · In order' && !(await p.isVisible('[data-v-board]')));
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
await b.close(); done();
