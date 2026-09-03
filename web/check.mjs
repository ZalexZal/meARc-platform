/**
 * Looks at the built site the way a person would, and at the things a person
 * cannot see.
 *
 * Screenshots at a phone width and a desktop width, in both languages and both
 * themes. Then the checks a screenshot cannot make: console errors, sideways
 * scroll, whether the fonts actually loaded rather than silently fell back, and
 * whether the reduced-motion path leaves anything invisible.
 *
 *   node check.mjs [baseUrl]
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4321';
const out = 'shots';
mkdirSync(out, { recursive: true });

const pages = [
  { path: '/', name: 'home-bg' },
  { path: '/en/', name: 'home-en' },
  { path: '/trails', name: 'trails-bg' },
  { path: '/en/trails', name: 'trails-en' },
  { path: '/signup', name: 'signup-bg' },
  { path: '/en/signup', name: 'signup-en' },
  { path: '/signin', name: 'signin-bg' },
  { path: '/terms', name: 'terms-bg' },
  { path: '/en/privacy', name: 'privacy-en' },
];

const widths = [
  { w: 390, h: 844, tag: 'phone' },
  { w: 1440, h: 900, tag: 'desk' },
];

let failures = 0;
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m) => console.log(`  pass  ${m}`);

const browser = await chromium.launch();

for (const theme of ['light', 'dark']) {
  for (const p of pages) {
    for (const size of widths) {
      const ctx = await browser.newContext({
        viewport: { width: size.w, height: size.h },
        colorScheme: theme,
        deviceScaleFactor: 2,
      });
      const page = await ctx.newPage();

      const errors = [];
      const badRequests = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('response', (r) => {
        if (r.status() >= 400) badRequests.push(`${r.status()} ${r.url()}`);
      });

      const label = `${p.name} ${size.tag} ${theme}`;
      console.log(`\n-- ${label}`);

      const res = await page.goto(base + p.path, { waitUntil: 'networkidle' });
      if (!res || res.status() !== 200) fail(`HTTP ${res && res.status()}`);

      // Scroll the whole page so every ScrollTrigger fires, then come back.
      await page.evaluate(async () => {
        const step = window.innerHeight * 0.6;
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 90));
        }
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(500);

      await page.screenshot({
        path: `${out}/${p.name}-${size.tag}-${theme}.png`,
        fullPage: true,
      });

      // ---- the things a picture will not tell you --------------------------

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      if (overflow > 1) {
        const culprits = await page.evaluate(() => {
          const limit = document.documentElement.clientWidth;
          return Array.from(document.querySelectorAll('body *'))
            .map((el) => {
              const r = el.getBoundingClientRect();
              return { el, over: Math.round(r.right - limit), left: Math.round(r.left) };
            })
            .filter((x) => x.over > 1)
            .sort((a, b) => b.over - a.over)
            .slice(0, 4)
            .map((x) => {
              const e = x.el;
              const id = e.tagName.toLowerCase() +
                (e.className && typeof e.className === 'string'
                  ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.')
                  : '');
              return `${id} (+${x.over}px, left ${x.left})`;
            });
        });
        fail(`page scrolls sideways by ${overflow}px -> ${culprits.join(' ; ')}`);
      } else {
        pass('no sideways scroll');
      }

      // A display face that silently fell back is the exact failure the brief
      // warns about for Cyrillic, and it looks fine in a screenshot.
      const fonts = await page.evaluate(async () => {
        await document.fonts.ready;
        return {
          display: document.fonts.check('600 2rem Unbounded'),
          body: document.fonts.check('400 1rem Onest'),
          mono: document.fonts.check('400 1rem "JetBrains Mono"'),
          cyrillic: document.fonts.check('600 2rem Unbounded', 'Часовниковата кула'),
        };
      });
      for (const [k, v] of Object.entries(fonts)) {
        // Google Fonts serves one file per script. An English page contains no
        // Cyrillic, so that file is never fetched and check() is correctly
        // false - which is not the same as the face lacking the glyphs.
        if (k === 'cyrillic' && p.name.endsWith('-en')) continue;
        v ? pass(`font ${k} loaded`) : fail(`font ${k} did NOT load - falling back`);
      }

      // Anything left mid-animation is a hole in the page.
      const invisible = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.reveal'))
          .filter((el) => {
            const cs = getComputedStyle(el);
            return parseFloat(cs.opacity) < 0.9 && el.getBoundingClientRect().top < window.innerHeight * 2;
          }).length
      );
      invisible === 0 ? pass('no element stuck invisible') : fail(`${invisible} element(s) stuck part-way through a reveal`);

      // Empty *and visible* is a hole in the page. Empty and hidden is a slot
      // waiting for an error message, which is how it is supposed to sit.
      const emptyText = await page.evaluate(() =>
        Array.from(document.querySelectorAll('h1,h2,h3,p,a,button,summary,dt,dd'))
          .filter((el) => {
            if (el.children.length || el.textContent.trim()) return false;
            return el.offsetParent !== null || getComputedStyle(el).position === 'fixed';
          }).length
      );
      emptyText === 0 ? pass('no empty text nodes') : fail(`${emptyText} empty heading/paragraph/link`);

      // Untranslated keys render as "faq.a3", which reads as a broken page.
      const rawKeys = await page.evaluate(() => {
        const re = /\b(nav|hero|route|stop|modes|stats|games|faq|cta|footer|auth|err|meta)\.[a-zA-Z0-9.]+\b/;
        return Array.from(document.querySelectorAll('body *'))
          .filter((el) => !el.children.length && re.test(el.textContent || ''))
          .map((el) => el.textContent.trim().slice(0, 60));
      });
      rawKeys.length === 0 ? pass('no raw translation keys on screen') : fail(`raw keys visible: ${rawKeys.join(' | ')}`);

      // Every internal link must land somewhere. A nav that points at a 404 is
      // the most ordinary way a site looks unfinished, and it is invisible in a
      // screenshot of the page doing the pointing.
      const links = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]'))
          .map((a) => a.getAttribute('href'))
          .filter((h) => h && !h.startsWith('http') && !h.startsWith('#') && !h.startsWith('mailto:'))
      );
      const dead = [];
      for (const l of [...new Set(links)]) {
        const target = l.split('#')[0];
        if (!target) continue;
        const r = await page.request.get(base + target).catch(() => null);
        if (!r || r.status() >= 400) dead.push(`${l} -> ${r ? r.status() : 'no response'}`);
      }
      dead.length === 0
        ? pass(`all ${links.length} internal links resolve`)
        : fail(`dead links: ${dead.join(' ; ')}`);

      // A 404 for something the page needed is a bug. A 404 from an RPC the
      // page deliberately handles - a migration that is not applied yet - is the
      // handled branch doing its job, and is reported rather than failed.
      const ownAssets = badRequests.filter((b) => b.includes(base));
      const apiCalls = badRequests.filter((b) => !b.includes(base));

      if (ownAssets.length) fail(`missing asset(s): ${ownAssets.slice(0, 3).join(' ; ')}`);
      else pass('every asset the page asked for was served');

      if (apiCalls.length) console.log(`  note  handled API error(s): ${apiCalls.slice(0, 2).join(' ; ')}`);

      // Whatever the API said, the page must land in a state a person can read.
      if (p.name.startsWith('trails')) {
        const state = await page.evaluate(() => {
          const vis = (sel) => {
            const el = document.querySelector(sel);
            return el && !el.classList.contains('hidden');
          };
          if (vis('[data-trails-list]')) return 'list';
          if (vis('[data-trails-empty]')) return 'empty';
          if (vis('[data-trails-failed]')) return 'failed';
          if (vis('[data-trails-loading]')) return 'still-loading';
          return 'nothing';
        });
        state === 'still-loading' || state === 'nothing'
          ? fail(`trails page ended in "${state}" - a reader sees a spinner or a blank`)
          : pass(`trails page settled on the "${state}" state`);
      }

      const realErrors = errors.filter((e) => !/Failed to load resource/.test(e));
      if (realErrors.length) fail(`console: ${realErrors.slice(0, 3).join(' || ')}`);
      else pass('no console errors');

      await ctx.close();
    }
  }
}

// ---- reduced motion: the finished state, not a blank column ----------------
console.log('\n-- reduced motion');
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  await page.goto(base + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const hidden = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.reveal'))
      .filter((el) => parseFloat(getComputedStyle(el).opacity) < 0.9).length
  );
  hidden === 0
    ? pass('every stop is visible without scrolling')
    : fail(`${hidden} stop(s) invisible with reduced motion - the page has holes`);

  const line = await page.evaluate(() => {
    const el = document.querySelector('[data-route-line]');
    return el ? getComputedStyle(el).transform : 'missing';
  });
  const scaleY = line.startsWith('matrix')
    ? parseFloat(line.slice(7, -1).split(',')[3])
    : NaN;
  scaleY > 0.99
    ? pass(`route line fully drawn (scaleY ${scaleY})`)
    : fail(`route line not drawn with reduced motion: ${line}`);

  await page.screenshot({ path: `${out}/reduced-motion.png`, fullPage: true });
  await ctx.close();
}

await browser.close();

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : failures + ' CHECK(S) FAILED'}`);
process.exit(failures === 0 ? 0 : 1);
