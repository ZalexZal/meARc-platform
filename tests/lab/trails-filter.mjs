// The public /trails page: search, category chips, a city filter, near-me, and
// filters that live in the URL. Seeds three public trails (the live list also holds
// real ones, so every count below looks only at the "Lab filter" rows).
//   Alpha: estate,    Yambol
//   Beta:  tourism,   Yambol
//   Gamma: education, no city   (its name carries markup that must stay text)
import { browser, BASE, SHOTS, check, done, makeUser, cleanUsers, sql } from './lib.mjs';

const YAMBOL = { key: 'yambol', bg: 'Ямбол', en: 'Yambol', lat: 42.4842, lng: 26.5035 };
const b = await browser();
try {
  const owner = await makeUser('filter');
  const seed = (name, category, city) => sql(
    `insert into public.worlds (owner_id, name, join_code, visibility, mode, status, category, city)
     values ($1, $2, 'LF' || substr(md5(random()::text), 1, 6), 'public', 'guide', 'published', $3, $4::jsonb)`,
    [owner.id, name, category, city ? JSON.stringify(city) : null]);
  await seed('Lab filter Alpha', 'estate', YAMBOL);
  await seed('Lab filter Beta', 'tourism', YAMBOL);
  await seed('Lab filter <u>Gamma</u> & co', 'education', null);

  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, geolocation: { latitude: 42.4842, longitude: 26.5035 }, permissions: ['geolocation'] });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));

  const ready = async (url) => {
    await p.goto(url);
    await p.waitForSelector('[data-find-bar]:not(.hidden)', { timeout: 15000 });
    await p.waitForSelector('[data-trails-list] li, [data-find-empty]:not(.hidden)', { timeout: 15000 });
  };
  // How many of the three seeded trails are on screen right now.
  const lab = () => p.$$eval('[data-trails-list] li', (l) => l.filter((x) => x.textContent.includes('Lab filter')).length);
  const labNames = () => p.$$eval('[data-trails-list] li h2', (l) => l.map((x) => x.textContent).filter((t) => t.includes('Lab filter')));
  const q = async (text) => { await p.fill('[data-find-q]', text); };
  const pressed = (cat) => p.getAttribute(`[data-find-cat="${cat}"]`, 'aria-pressed');

  await ready(`${BASE}/trails/`);
  check('three seeded trails are listed', (await lab()) === 3, String(await lab()));
  check('the search is a real search input with a label', await p.$('label[for="find-q"]') !== null && (await p.getAttribute('[data-find-q]', 'type')) === 'search');
  check('five chips: all and the four categories', (await p.$$('[data-find-cat]')).length === 5);
  check('All is pressed to begin with', (await pressed('')) === 'true');

  // Names and cities are other people's words: they are shown, never run.
  check('markup in a trail name stays text', (await p.$$('[data-trails-list] u')).length === 0 && (await labNames()).includes('Lab filter <u>Gamma</u> & co'));

  // Each card says what it is: Category · City (no mode on the estate card).
  const lines = await p.$$eval('[data-trails-list] li', (l) => l.filter((x) => x.textContent.includes('Lab filter')).map((x) => x.querySelector('.eyebrow').textContent.trim()));
  check('estate card reads "Недвижими имоти · Ямбол"', lines.includes('Недвижими имоти · Ямбол'), lines.join(' | '));
  check('tourism card shows its category and city', lines.some((x) => x.endsWith('Туризъм · Ямбол')), lines.join(' | '));
  check('a card with no city shows just the category', lines.some((x) => x.endsWith('Образование') && !x.includes('Ямбол')), lines.join(' | '));

  // The city list: only cities that exist, in bg order, plus "no city" because Gamma has none.
  const opts = await p.$$eval('[data-find-city] option', (o) => o.map((x) => [x.value, x.textContent.trim()]));
  check('city select: All cities first, Ямбол present, "Без град" last', opts[0][1] === 'Всички градове' && opts.some((o) => o[1] === 'Ямбол') && opts.at(-1)[1] === 'Без град', JSON.stringify(opts));
  const names = opts.slice(1, -1).map((o) => o[1]);
  check('cities are sorted by their Bulgarian name', JSON.stringify(names) === JSON.stringify([...names].sort((a, c) => a.localeCompare(c, 'bg'))), names.join(','));
  check('each city appears once', new Set(opts.map((o) => o[0])).size === opts.length);

  // Search: "yambol" in Latin finds the Cyrillic city, two trails.
  await q('lab filter yambol');
  check('"yambol" shows two trails', (await lab()) === 2, String(await lab()));
  check('the query is in the URL', new URL(p.url()).searchParams.get('q') === 'lab filter yambol', p.url());

  // Chip + query.
  await p.click('[data-find-cat="estate"]');
  check('Real estate + "yambol" shows one', (await lab()) === 1 && (await labNames())[0] === 'Lab filter Alpha', String(await lab()));
  check('the pressed chip is announced and in the URL', (await pressed('estate')) === 'true' && (await pressed('')) === 'false' && new URL(p.url()).searchParams.get('cat') === 'estate');

  // Nothing left: the message names the query, and Clear brings everything back.
  await q('lab filter');
  await p.selectOption('[data-find-city]', 'yambol');
  await p.click('[data-find-cat="education"]');
  await p.waitForSelector('[data-find-empty]:not(.hidden)');
  const msg = await p.textContent('[data-find-empty]');
  check('empty state names the query', msg.includes('Няма маршрути за „lab filter“.'), msg.trim());
  check('empty state hides the list', !(await p.isVisible('[data-trails-list]')));
  check('the filter bar stays so the way back is on screen', await p.isVisible('[data-find-q]'));
  await p.click('[data-find-clear]');
  check('Clear brings back all three', (await lab()) === 3, String(await lab()));
  check('Clear empties the search and resets chip and city', (await p.inputValue('[data-find-q]')) === '' && (await pressed('')) === 'true' && (await p.inputValue('[data-find-city]')) === '');
  check('Clear takes the filters out of the URL', ![...new URL(p.url()).searchParams.keys()].some((k) => ['q', 'cat', 'city'].includes(k)), p.url());

  // With no query the message says the filters hid it, not a query.
  await p.selectOption('[data-find-city]', '__none');
  await p.click('[data-find-cat="tourism"]');
  await p.waitForSelector('[data-find-empty]:not(.hidden)');
  const msg2 = await p.textContent('[data-find-empty]');
  check('without a query: "Няма маршрути с тези филтри."', msg2.includes('Няма маршрути с тези филтри.') && !msg2.includes('„'), msg2.trim());
  await p.click('[data-find-clear]');

  // "No city" as a filter finds the trail without one.
  await q('lab filter');
  await p.selectOption('[data-find-city]', '__none');
  check('"Без град" shows only the trail with no city', (await lab()) === 1 && (await labNames())[0].includes('Gamma'));
  check('city filter is in the URL', new URL(p.url()).searchParams.get('city') === 'none', p.url());
  await ready(`${BASE}/trails/`);

  // Near me combines with the filters instead of replacing them.
  await q('lab filter yambol');
  await p.click('[data-trails-near]');
  await p.waitForSelector('[data-trails-where]:not(.hidden)');
  await p.waitForTimeout(500);
  check('near me keeps the filters', (await lab()) === 2 && (await p.inputValue('[data-find-q]')) === 'lab filter yambol');
  await q('');

  // A shared link opens already filtered.
  await ready(`${BASE}/trails/?cat=tourism`);
  check('?cat=tourism on load shows one of ours', (await lab()) === 1 && (await labNames())[0] === 'Lab filter Beta', String(await lab()));
  check('?cat=tourism presses the Tourism chip', (await pressed('tourism')) === 'true' && (await pressed('')) === 'false');
  await ready(`${BASE}/trails/?q=lab%20filter&city=yambol`);
  check('?q=&city= on load', (await lab()) === 2 && (await p.inputValue('[data-find-q]')) === 'lab filter' && (await p.inputValue('[data-find-city]')) === 'yambol');
  await ready(`${BASE}/trails/?cat=nonsense&city=atlantis`);
  check('unknown values in the URL are ignored', (await pressed('')) === 'true' && (await p.inputValue('[data-find-city]')) === '' && (await lab()) === 3);

  // English.
  await ready(`${BASE}/en/trails/?cat=estate&q=lab%20filter`);
  const chips = await p.$$eval('[data-find-cat]', (c) => c.map((x) => x.textContent.trim()));
  check('English chips', JSON.stringify(chips) === JSON.stringify(['All categories', 'Education', 'Tourism', 'Real estate', 'Other']), chips.join(','));
  const enLine = await p.$eval('[data-trails-list] li .eyebrow', (e) => e.textContent.trim());
  check('English card reads "Real estate · Yambol"', enLine === 'Real estate · Yambol', enLine);
  await q('zzzz-nothing');
  await p.waitForSelector('[data-find-empty]:not(.hidden)');
  check('English empty state', (await p.textContent('[data-find-empty]')).includes('No trails for “zzzz-nothing”.') && (await p.textContent('[data-find-clear]')).includes('Clear filters'));
  await ctx.close();

  // Phone: no sideways scroll for the page, 44 px targets, light and dark.
  for (const scheme of ['light', 'dark']) {
    const pc = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme, isMobile: true, hasTouch: true });
    const m = await pc.newPage();
    await m.goto(`${BASE}/trails/?cat=estate`);
    await m.waitForSelector('[data-find-bar]:not(.hidden)', { timeout: 15000 });
    await m.waitForTimeout(800);
    const sw = await m.evaluate(() => { window.scrollTo(300, 0); return { w: document.documentElement.scrollWidth, x: window.scrollX }; });
    check(`phone/${scheme}: no sideways scroll`, sw.w <= 390 && sw.x === 0, JSON.stringify(sw));
    const small = await m.$$eval('[data-find-q], [data-find-city], [data-find-cat]', (els) => els.filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.outerHTML.slice(0, 60)));
    check(`phone/${scheme}: search, chips and city are at least 44 px tall`, small.length === 0, small.join(' | '));
    await m.screenshot({ path: `${SHOTS}/trails-filter-phone-${scheme}.png`, fullPage: true });
    await pc.close();
  }
  const dctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const dp = await dctx.newPage();
  await dp.goto(`${BASE}/trails/`);
  await dp.waitForSelector('[data-find-bar]:not(.hidden)', { timeout: 15000 });
  await dp.waitForTimeout(800);
  await dp.screenshot({ path: `${SHOTS}/trails-filter-desk.png`, fullPage: true });
  await dctx.close();

  check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
} finally {
  await cleanUsers();
  await b.close();
}
done();
