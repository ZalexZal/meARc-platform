// Task W2: the A5 "living scene" stage beside sign-up and choose-role.
// Every state (5 roles + nothing chosen) is server-rendered; the picker only
// flips data-stage-role. Checked in both themes, at 1280/768/390, plus
// screenshots of every role x light/dark x 1280/390 (and 768, the band) into shots/a5-*.png.
import { browser, BASE, SHOTS, check, done, makeUser, cleanUsers, signIn } from './lib.mjs';
import path from 'path';

const b = await browser();
const errs = [];

const SKY = {
  light: { teacher: '#d3ecd6', guide: '#f9e2bd', broker: '#cfe5f8', other: '#e3e8f0', viewer: '#d0ece2', none: '#ecedf0' },
  dark: { teacher: '#0f2a22', guide: '#2b2114', broker: '#0d2238', other: '#1b2130', viewer: '#0f2a24', none: '#17191c' },
};
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

// What each state shows (BG), from lib/role.ts stageFor with the field-first labels.
const STATES = {
  none: { tag: 'Нов профил', head: 'Едно място. Една история. Вашият телефон.', moment: null },
  teacher: { tag: 'Образование · създател', head: 'Уроците излизат навън.', moment: 'Отбор Север · +10 т.' },
  guide: { tag: 'Туризъм · създател', head: 'Историята — там, където се е случила.', moment: 'Наблизо · Източната порта' },
  broker: { tag: 'Недвижими имоти · създател', head: 'Сградата — на парцела, преди да е построена.', moment: 'Клиентът е на парцела' },
  other: { tag: 'Създател', head: 'Каквото поставите, хората го виждат на място.', moment: 'Спирка 2 от 5' },
  viewer: { tag: 'Зрител', head: 'Тръгнете. Телефонът ще ви покаже останалото.', moment: 'Следваща · 180 м' },
};
const ORDER = ['none', 'teacher', 'guide', 'broker', 'other', 'viewer'];

async function page(width, height, scheme) {
  const ctx = await b.newContext({ viewport: { width, height }, colorScheme: scheme });
  await ctx.addInitScript(() => { try { localStorage.setItem('artrail-cookies-ok', '1'); } catch {} });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(`${p.url()}: ${e.message}`));
  return p;
}

async function choose(p, key) {
  if (key === 'none') {
    await p.evaluate(() => {
      document.querySelectorAll('[data-role-picker] input').forEach((i) => { i.checked = false; });
      document.querySelector('[data-role-picker]').dispatchEvent(new Event('change', { bubbles: true }));
    });
  } else if (key === 'viewer') {
    await p.check('input[name="role"][value="viewer"]');
  } else {
    await p.check('input[name="role"][value="creator"]');
    await p.check(`input[name="work"][value="${key}"]`);
  }
}

// Everything the stage shows right now: only rendered (visible) elements count.
const read = (p) => p.evaluate(() => {
  const stage = document.querySelector('[data-stage]');
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const vis = (sel) => [...stage.querySelectorAll(sel)].filter(shown);
  const text = (sel) => vis(sel).map((e) => e.textContent.replace(/\s+/g, ' ').trim());
  return {
    role: stage.dataset.stageRole,
    sky: getComputedStyle(stage).backgroundColor,
    scenes: vis('[data-scene]').map((e) => e.dataset.scene),
    phones: vis('[data-phone]').map((e) => e.dataset.phone),
    tags: text('[data-stage-tag]'),
    heads: text('[data-stage-head]'),
    moments: text('[data-stage-moment]'),
    cards: text('[data-stage-card]'),
    stale: vis('[data-stage-for]').map((e) => e.dataset.stageFor).filter((k) => k !== stage.dataset.stageRole),
    live: stage.querySelector('[aria-live="polite"] [data-stage-head]') !== null,
  };
});
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

try {
  // 1. Every state in both themes at 1280: role, sky, scene, phone, chip, headline, moment.
  for (const scheme of ['light', 'dark']) {
    const p = await page(1280, 900, scheme);
    await p.goto(`${BASE}/signup/`);
    await p.waitForSelector('[data-stage]');
    let s = await read(p);
    check(`${scheme}: headline is an aria-live region`, s.live);
    // Walk the states in an order that switches between every kind of choice.
    for (const key of [...ORDER, 'teacher', 'viewer', 'broker', 'none']) {
      await choose(p, key);
      s = await read(p);
      const want = STATES[key];
      check(`${scheme} ${key}: data-stage-role`, s.role === key, s.role);
      check(`${scheme} ${key}: sky ${SKY[scheme][key]}`, s.sky === rgb(SKY[scheme][key]), s.sky);
      check(`${scheme} ${key}: one scene, data-scene=${key}`, s.scenes.join() === key, s.scenes.join());
      check(`${scheme} ${key}: one phone, data-phone=${key}`, s.phones.join() === key, s.phones.join());
      check(`${scheme} ${key}: chip "${want.tag}"`, s.tags.join('|') === want.tag, s.tags.join('|'));
      check(`${scheme} ${key}: headline`, s.heads.join('|') === want.head, s.heads.join('|'));
      check(`${scheme} ${key}: moment`, want.moment ? s.moments.join('|') === want.moment : s.moments.length === 0, s.moments.join('|'));
      check(`${scheme} ${key}: sample trail card`, key === 'none' ? s.cards.length === 0 : s.cards.length === 1 && /Примерен маршрут/i.test(s.cards[0]), s.cards.join('|'));
      check(`${scheme} ${key}: nothing from another state visible`, s.stale.length === 0, s.stale.join());
    }
    // A creator with no work yet: still the welcome stage, chip says Създател.
    await p.check('input[name="role"][value="creator"]');
    s = await read(p);
    check(`${scheme}: creator without work is stage none, chip Създател`, s.role === 'none' && s.tags.join() === 'Създател', `${s.role} ${s.tags.join()}`);
    await p.close();
  }

  // 2. The stage follows the site's theme switch live (no reload).
  const lt = await page(1280, 900, 'light');
  await lt.goto(`${BASE}/signup/`);
  await lt.waitForSelector('[data-stage]');
  await choose(lt, 'guide');
  await lt.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  check('live switch to dark: night sky', (await read(lt)).sky === rgb(SKY.dark.guide));
  await lt.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  check('live switch back to light: day sky', (await read(lt)).sky === rgb(SKY.light.guide));
  await lt.close();
  const dt = await page(1280, 900, 'dark');
  await dt.goto(`${BASE}/signup/`);
  await dt.waitForSelector('[data-stage]');
  await choose(dt, 'viewer');
  await dt.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  check('system dark + explicit light: day sky', (await read(dt)).sky === rgb(SKY.light.viewer));
  await dt.close();

  // 3. EN: the swapped labels in English.
  const en = await page(1280, 900, 'light');
  await en.goto(`${BASE}/en/signup/`);
  await en.waitForSelector('[data-stage]');
  await choose(en, 'broker');
  let e = await read(en);
  check('EN broker chip', e.tags.join() === 'Real estate · creator', e.tags.join());
  check('EN broker card is a sample', /Sample trail/i.test(e.cards.join()), e.cards.join());
  await en.close();

  // 4. No sideways scroll at 390 and 768, in every state; the phone mockup is gone at 390.
  for (const w of [390, 768]) {
    const p = await page(w, 844, 'light');
    await p.goto(`${BASE}/signup/`);
    await p.waitForSelector('[data-stage]');
    let ok = true; const bad = [];
    for (const key of ORDER) {
      await choose(p, key);
      await p.waitForTimeout(50);
      if (!(await noSideways(p))) { ok = false; bad.push(key); }
      const s = await read(p);
      if (s.stale.length) { ok = false; bad.push(`${key}: stale ${s.stale.join()}`); }
    }
    check(`${w}px: no sideways scroll, no stale state`, ok, bad.join(', '));
    if (w === 390) {
      await choose(p, 'guide');
      const s = await read(p);
      check('390px: no phone mockup', s.phones.length === 0, s.phones.join());
      check('390px: scene still shown', s.scenes.join() === 'guide', s.scenes.join());
      const sheet = await p.evaluate(() => {
        const hero = document.querySelector('[data-stage]').getBoundingClientRect();
        const main = document.querySelector('[data-stage-sheet]');
        const r = main.getBoundingClientRect();
        return { overlap: Math.round(hero.bottom - r.top), radius: getComputedStyle(main).borderTopLeftRadius };
      });
      check('390px: the form sheet overlaps the hero by 24px with 26px corners', sheet.overlap === 24 && sheet.radius === '26px', JSON.stringify(sheet));
    }
    await p.close();
  }

  // 5. Choose-role has the same stage, with an answer already given offered back.
  const u = await makeUser('stage-cr', { role: null, work: 'teacher' });
  const cp = await page(1280, 900, 'light');
  await signIn(cp, u);
  await cp.waitForURL((x) => x.pathname === '/choose-role/', { timeout: 15000 }).catch(() => {});
  await cp.goto(`${BASE}/choose-role/`);
  await cp.waitForSelector('[data-role-form]:not([hidden])', { timeout: 15000 });
  await cp.waitForTimeout(400);
  const c = await read(cp);
  check('choose-role: stage pre-filled to teacher', c.role === 'teacher' && c.tags.join() === 'Образование · създател', `${c.role} ${c.tags.join()}`);
  check('choose-role: no account fields', (await cp.$$('#email, #password')).length === 0);
  await cp.close();

  // 6. Screenshots: every role x light/dark x 1280/390.
  for (const scheme of ['light', 'dark']) {
    for (const [w, h] of [[1280, 900], [390, 844], [768, 1024]]) {
      const p = await page(w, h, scheme);
      await p.goto(`${BASE}/signup/`);
      await p.waitForSelector('[data-stage]');
      for (const key of ORDER) {
        await choose(p, key);
        await p.waitForTimeout(600);
        // A frame where everything has arrived (pins down, trail drawn, moment up),
        // seen from the top of the page, so the review compares whole drawings.
        // (A style, not the Web Animations API: the full-page capture resizes the
        // viewport, which restarts CSS animations and would undo a pause.)
        await p.evaluate(() => {
          scrollTo(0, 0);
          const st = document.createElement('style');
          st.id = 'freeze';
          // The sticky header is drawn mid-page by the full-page capture on a phone; pin it to the top.
          st.textContent = '*, *::before, *::after { animation-delay: -5s !important; animation-play-state: paused !important; }'
            + ' [data-site-header] { position: relative !important; }';
          document.head.append(st);
        });
        await p.screenshot({ path: path.join(SHOTS, `a5-${key}-${scheme}-${w}.png`), fullPage: true });
        await p.evaluate(() => document.getElementById('freeze')?.remove());
      }
      await p.close();
    }
  }

  check('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
  await cleanUsers();
}
done();
