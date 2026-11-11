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
  other: { tag: 'Друго · създател', head: 'Каквото поставите, хората го виждат на място.', moment: 'Спирка 2 от 5' },
  viewer: { tag: 'Зрител', head: 'Тръгнете. Телефонът ще ви покаже останалото.', moment: 'Следваща · 180 м' },
};
const ORDER = ['none', 'teacher', 'guide', 'broker', 'other', 'viewer'];
const PREVIEW = ['guide', 'teacher', 'broker', 'viewer', 'other'];

async function page(width, height, scheme) {
  const ctx = await b.newContext({ viewport: { width, height }, colorScheme: scheme });
  await ctx.addInitScript(() => { try { localStorage.setItem('artrail-cookies-ok', '1'); } catch {} });
  // The sky's colour eases over .6s; the checks read the colour it settles on.
  await ctx.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    const s = document.createElement('style'); s.textContent = '.stage{transition:none!important}'; document.head.append(s);
  }));
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
  const inText = (e) => !!e.closest('.stage-text');
  return {
    role: stage.dataset.stageRole,
    art: stage.dataset.stageArt,
    sky: getComputedStyle(stage).backgroundColor,
    scenes: vis('[data-scene]').map((e) => e.dataset.scene),
    phones: vis('[data-phone]').map((e) => e.dataset.phone),
    tags: text('[data-stage-tag]'),
    heads: text('[data-stage-head]'),
    moments: text('[data-stage-moment]'),
    cards: text('[data-stage-card]'),
    // The words follow the role, the drawings follow the art (the preview before a choice).
    stale: vis('[data-stage-for]').filter((e) => e.dataset.stageFor !== (inText(e) ? stage.dataset.stageRole : stage.dataset.stageArt))
      .map((e) => `${inText(e) ? 'text' : 'art'}:${e.dataset.stageFor}`),
    // One hidden live node carries the headline; the six drawn headlines are not live.
    lives: stage.querySelectorAll('[aria-live]').length,
    announce: stage.querySelector('[data-stage-announce][aria-live="polite"]')?.textContent ?? null,
    headsLive: stage.querySelector('.stage-heads')?.hasAttribute('aria-live') ?? null,
  };
});

// Geometry with the animations at rest (their own start/end transforms aside):
// decoration (sun, moon, stars, cloud with its drift) never touches the words
// (chip, headline, sub, signs, moment); below 1024px the moment sits above the
// scene's highest drawing; at 390 the sheet leaves the scene's ground in view.
const faults = (p) => p.evaluate(() => {
  const st = document.createElement('style');
  st.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
  document.head.append(st);
  const stage = document.querySelector('[data-stage]');
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
  const vis = (sel) => [...stage.querySelectorAll(sel)].filter(shown);
  const glyphs = (el) => {
    const out = [];
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.textContent.trim()) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      out.push(...r.getClientRects());
    }
    return out;
  };
  const words = [];
  for (const el of vis('.stage-chip, .stage-sign, .stage-moment')) words.push([el.className.baseVal ?? el.className, el.getBoundingClientRect()]);
  for (const el of vis('.stage-head, .stage-sub')) for (const r of glyphs(el)) words.push([el.className, r]);
  const drift = innerWidth >= 1024 ? 30 : 20;
  const decor = vis('[data-decor]').map((el) => {
    const r = el.getBoundingClientRect();
    const d = el.dataset.decor === 'cloud' ? drift : 0;
    return [el.dataset.decor, { left: r.left - d, right: r.right + d, top: r.top, bottom: r.bottom }];
  });
  const hit = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
  const out = [];
  if (!decor.some(([n]) => n === 'cloud') || !decor.some(([n]) => n === 'sky')) out.push('sun/moon or cloud not found');
  for (const [dn, dr] of decor) for (const [wn, wr] of words) if (hit(dr, wr)) out.push(`${dn} on ${wn}`);
  // The words never run under the sample card or the phone either.
  for (const el of vis('.stage-card, .stage-phone')) {
    const r = el.getBoundingClientRect();
    for (const [wn, wr] of words) if (!/moment/.test(wn) && hit(r, wr)) out.push(`${wn} under ${el.className}`);
  }
  if (innerWidth < 1024) {
    const m = vis('.stage-moment')[0];
    if (m) {
      const tops = [...vis('[data-scene]').flatMap((s) => [...s.querySelectorAll('path')]), ...stage.querySelectorAll('.stage-route-p g g')]
        .map((e) => e.getBoundingClientRect()).filter((r) => r.width || r.height).map((r) => r.top);
      const top = Math.min(...tops);
      if (m.getBoundingClientRect().bottom > top + 0.5) out.push(`moment covers the drawing (${Math.round(m.getBoundingClientRect().bottom)} > ${Math.round(top)})`);
    }
  }
  if (innerWidth <= 640) {
    const g = stage.querySelector('.stage-ground').getBoundingClientRect();
    const sheet = document.querySelector('[data-stage-sheet]').getBoundingClientRect();
    if (sheet.top < g.bottom - 0.5) out.push(`sheet hides the ground (${Math.round(sheet.top)} < ${Math.round(g.bottom)})`);
  }
  st.remove();
  return out;
});
// A frame where everything has arrived (pins down, trail drawn, moment up), from
// the top of the page. A style, not the Web Animations API: the full-page capture
// resizes the viewport, which restarts CSS animations and would undo a pause.
// The sticky header is drawn mid-page by a phone full-page capture; pin it.
async function shoot(p, name) {
  await p.waitForTimeout(600);
  await p.evaluate(() => {
    scrollTo(0, 0);
    const st = document.createElement('style');
    st.id = 'freeze';
    st.textContent = '*, *::before, *::after { animation-delay: -5s !important; animation-play-state: paused !important; }'
      + ' [data-site-header] { position: relative !important; }';
    document.head.append(st);
  });
  await p.screenshot({ path: path.join(SHOTS, name), fullPage: true });
  await p.evaluate(() => document.getElementById('freeze')?.remove());
}
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

try {
  // 1. Every state in both themes at 1280: role, sky, scene, phone, chip, headline, moment.
  for (const scheme of ['light', 'dark']) {
    const p = await page(1280, 900, scheme);
    await p.goto(`${BASE}/signup/`);
    await p.waitForSelector('[data-stage]');
    let s = await read(p);
    check(`${scheme}: one live region, and it is not the drawn headlines`, s.lives === 1 && s.headsLive === false, `${s.lives} ${s.headsLive}`);
    // Walk the states in an order that switches between every kind of choice.
    for (const key of [...ORDER, 'teacher', 'viewer', 'broker', 'none']) {
      await choose(p, key);
      s = await read(p);
      const want = STATES[key];
      // Before a choice the drawings preview one of the five roles; after, they are the role's.
      const art = key === 'none' ? s.art : key;
      check(`${scheme} ${key}: data-stage-role`, s.role === key, s.role);
      check(`${scheme} ${key}: drawings ${key === 'none' ? 'preview a role' : 'are the role\'s'} (${s.art})`, key === 'none' ? PREVIEW.includes(s.art) : s.art === key, s.art);
      check(`${scheme} ${key}: sky ${SKY[scheme][art]}`, s.sky === rgb(SKY[scheme][art]), s.sky);
      check(`${scheme} ${key}: one scene, data-scene=${art}`, s.scenes.join() === art, s.scenes.join());
      check(`${scheme} ${key}: one phone, data-phone=${art}`, s.phones.join() === art, s.phones.join());
      check(`${scheme} ${key}: chip "${want.tag}"`, s.tags.join('|') === want.tag, s.tags.join('|'));
      check(`${scheme} ${key}: headline`, s.heads.join('|') === want.head, s.heads.join('|'));
      const wantMoment = key === 'none' ? STATES[art]?.moment : want.moment;
      check(`${scheme} ${key}: moment`, wantMoment ? s.moments.join('|') === wantMoment : s.moments.length === 0, s.moments.join('|'));
      check(`${scheme} ${key}: sample trail card`, s.cards.length === 1 && /Примерен маршрут/i.test(s.cards[0]), s.cards.join('|'));
      check(`${scheme} ${key}: nothing from another state visible`, s.stale.length === 0, s.stale.join());
      check(`${scheme} ${key}: the live node says the new headline`, s.announce === want.head, s.announce);
    }
    // A creator with no work yet: still the welcome stage, chip says Създател.
    await p.check('input[name="role"][value="creator"]');
    s = await read(p);
    check(`${scheme}: creator without work is stage none, chip Създател`, s.role === 'none' && s.tags.join() === 'Създател', `${s.role} ${s.tags.join()}`);
    await p.close();
  }

  // 1b. Before a choice the drawings walk through the roles; a choice stops the walk.
  {
    const p = await page(1280, 900, 'light');
    await p.goto(`${BASE}/signup/`);
    await p.waitForSelector('[data-stage]');
    const first = (await read(p)).art;
    await p.waitForTimeout(7500);
    const next = (await read(p)).art;
    check('preview: the drawings move on to another role after ~7s', PREVIEW.includes(first) && PREVIEW.includes(next) && first !== next, `${first} -> ${next}`);
    await choose(p, 'broker');
    await p.waitForTimeout(7500);
    const held = await read(p);
    check('preview: a chosen role stops the walk (still broker after ~7s)', held.art === 'broker' && held.role === 'broker', `${held.role}/${held.art}`);
    await choose(p, 'none');
    await p.waitForTimeout(7500);
    const again = (await read(p)).art;
    check('preview: un-choosing starts the walk again', PREVIEW.includes(again), again);
    await p.close();
  }

  // 1c. The composition lines up with the header and stands centred, at any desktop width.
  for (const w of [1280, 1440, 1920]) {
    const p = await page(w, 1000, 'dark');
    await p.goto(`${BASE}/signup/`);
    await p.waitForSelector('[data-stage]');
    const g = await p.evaluate(() => {
      const r = (el) => el.getBoundingClientRect();
      const bar = r(document.querySelector('.site-header .bar'));
      const logo = r(document.querySelector('.site-header .logo'));
      const stage = r(document.querySelector('[data-stage]'));
      const form = r(document.querySelector('.stage-main-in'));
      const layout = r(document.querySelector('.stage-layout'));
      const tools = [...document.querySelectorAll('.site-header .bar a, .site-header .bar button')].filter((e) => e.getClientRects().length);
      const last = r(tools[tools.length - 1]);
      return { bar, logo, last, stage, form, layout, vw: document.documentElement.clientWidth };
    });
    check(`${w}: stage's left edge lines up with the logo`, Math.abs(g.stage.left - g.logo.left) <= 2, `${g.stage.left} vs ${g.logo.left}`);
    check(`${w}: the form's right edge lines up with the header's last button`, Math.abs(g.form.right - g.last.right) <= 2, `${g.form.right} vs ${g.last.right}`);
    check(`${w}: the composition sits in the header's container`, g.layout.left >= g.bar.left - 1 && g.layout.right <= g.bar.right + 1, `${g.layout.left}-${g.layout.right} vs ${g.bar.left}-${g.bar.right}`);
    check(`${w}: the form is centred on the stage's height`, Math.abs((g.form.top + g.form.bottom) / 2 - (g.stage.top + g.stage.bottom) / 2) <= 24, `${(g.form.top + g.form.bottom) / 2} vs ${(g.stage.top + g.stage.bottom) / 2}`);
    await p.screenshot({ path: `${SHOTS}/balance-${w}.png` });
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

  // 3b. Decoration clear of the words, the moment clear of the drawing, the ground in view.
  for (const scheme of ['light', 'dark']) {
    for (const [w, h] of [[1280, 900], [390, 844], [768, 1024]]) {
      const p = await page(w, h, scheme);
      await p.goto(`${BASE}/signup/`);
      await p.waitForSelector('[data-stage]');
      for (const key of ORDER) {
        await choose(p, key);
        const f = await faults(p);
        check(`${scheme} ${w}px ${key}: decoration clear of text, ground and drawing clear`, f.length === 0, f.join('; '));
      }
      await p.close();
    }
  }

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
  await shoot(cp, 'a5-choose-light-1280.png');
  await cp.close();
  const u2 = await makeUser('stage-cr2', { role: null, work: null });
  const cd = await page(390, 844, 'dark');
  await signIn(cd, u2);
  await cd.waitForURL((x) => x.pathname === '/choose-role/', { timeout: 15000 }).catch(() => {});
  await cd.goto(`${BASE}/choose-role/`);
  await cd.waitForSelector('[data-role-form]:not([hidden])', { timeout: 15000 });
  await cd.check('input[name="role"][value="viewer"]');
  check('choose-role 390 dark: viewer stage', (await read(cd)).role === 'viewer');
  await shoot(cd, 'a5-choose-dark-390.png');
  await cd.close();

  // 6. Screenshots: every role x light/dark x 1280/390.
  for (const scheme of ['light', 'dark']) {
    for (const [w, h] of [[1280, 900], [390, 844], [768, 1024]]) {
      const p = await page(w, h, scheme);
      await p.goto(`${BASE}/signup/`);
      await p.waitForSelector('[data-stage]');
      for (const key of ORDER) {
        await choose(p, key);
        await shoot(p, `a5-${key}-${scheme}-${w}.png`);
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
