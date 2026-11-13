// Task 9: the builder follows the creator's line of work; category and city in Settings.
// The real-Nominatim part (city from the first stop) is skipped with NO_NET=1.
import { browser, BASE, SHOTS, check, done, makeUser, cleanUsers, signIn, api, sql } from './lib.mjs';

const NO_NET = process.env.NO_NET === '1';
const b = await browser();
const errs = [];
const YAMBOL = [26.5035, 42.4842];
const SOFIA = [23.3219, 42.6977];

async function trail(c, name, mode, category) {
  const { data: w, error } = await c.rpc('create_world', { p_name: name, p_mode: mode, p_language: 'bg', p_category: category });
  if (error) throw error;
  return typeof w === 'string' ? w : w.id;
}
async function stop(worldId, userId, title, [lng, lat] = YAMBOL, step = 1) {
  const [m] = await sql(`insert into public.markers (world_id, location, style_key, colour_hex, content, status, step, radius_m, created_by)
    values ($1, extensions.st_makepoint($2, $3)::extensions.geography, 'pin', '#0066cc', $4, 'published', $5, 30, $6) returning id`,
    [worldId, lng, lat, JSON.stringify({ bg: { title, question: 'Колко врати?' } }), step, userId]);
  return m.id;
}
async function open(user, id, lang = '') {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  p.on('pageerror', (e) => errs.push(e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' ')));
  p.on('dialog', (d) => { errs.push('dialog: ' + d.message()); d.accept().catch(() => {}); });
  await signIn(p, user, lang);
  await p.goto(`${BASE}${lang}/trail/?id=${id}`);
  await p.waitForSelector('[data-guarded]:not([hidden])', { timeout: 20000 });
  await p.waitForSelector('[data-map] canvas', { timeout: 20000 });
  return p;
}
const steps = (p) => p.$$eval('[data-step]', (l) => l.map((x) => x.dataset.step));
const BAD_BG = /отбор|точки|класиран|въпрос|подсказ/iu;
// "ред" is also "row": the spreadsheet import says "one row is one stop", so the
// order word is looked for everywhere except inside the import box.
const BAD_BG_ORDER = /(^|[^\p{L}])(ред|реда)([^\p{L}]|$)/iu;
const BAD_EN = /team|standing|points|question|hint|\border\b/i;
const around = (s, m) => s.slice(Math.max(0, m.index - 50), m.index + 50).replace(/\s+/g, ' ');
// Every tab, and every step of an open stop: what a person can read on the page.
// Returned twice: all of it, and all of it but the spreadsheet import box.
async function readAll(p, pick) {
  const read = () => p.evaluate(() => {
    const page = document.body.innerText;
    const imp = document.querySelector('[data-import]')?.innerText ?? '';
    return [page, imp ? page.replace(imp, '') : page];
  });
  const out = { all: '', noImport: '' };
  const add = ([a, b]) => { out.all += '\n' + a; out.noImport += '\n' + b; };
  for (const tab of await p.$$eval('[data-ed-tab]', (l) => l.map((x) => x.dataset.edTab))) {
    await p.click(`[data-ed-tab="${tab}"]`);
    await p.waitForTimeout(300);
    add(await read());
  }
  await p.click('[data-ed-tab="stops"]');
  await p.click(`[data-pick="${pick}"]`);
  await p.waitForSelector('[data-marker-form]:not(.hidden)', { timeout: 10000 });
  for (const s of await steps(p)) {
    await p.click(`[data-step="${s}"]`);
    await p.waitForSelector(`[data-panel="${s}"]:not(.hidden)`, { timeout: 15000 });
    add(await read());
  }
  // And everything the section holds, shown or not, outside scripts and styles.
  add(await p.evaluate(() => {
    const copy = document.querySelector('[data-guarded]').cloneNode(true);
    copy.querySelectorAll('script, style, template').forEach((x) => x.remove());
    const all = copy.textContent;
    copy.querySelector('[data-import]')?.remove();
    return [all, copy.textContent];
  }));
  return out;
}
async function waitFor(fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() > end) return v;
    await new Promise((r) => setTimeout(r, 500));
  }
}
const cityOf = async (id) => (await sql(`select city, city_auto from worlds where id = $1`, [id]))[0];

try {
  // ---------------------------------------------------------------- broker
  const br = await makeUser('bw-broker', { work: 'broker' });
  const cb = await api(br);
  const bid = await trail(cb, 'Лаб брокер', 'educational', 'estate');
  const bstop = await stop(bid, br.id, 'Апартамент');
  const p = await open(br, bid);
  await p.waitForSelector(`[data-pick="${bstop}"]`, { timeout: 20000 });
  check('broker: four steps', (await steps(p)).join() === 'place,visual,media,review', (await steps(p)).join());
  check('broker: no question step or pane in the page', !(await p.$('[data-step="question"]')) && !(await p.$('[data-panel="question"]')));
  check('broker: no Results tab', !(await p.$('[data-ed-tab="results"]')) && !(await p.$('[data-ed-panel="results"]')));
  check('broker: no team size, start or one-at-a-time rows', !(await p.$('[data-team-row]')) && !(await p.$('[data-start-mode]')) && !(await p.$('[data-reveal-row]')));
  const tiles = await p.$$eval('[data-panel="visual"] input[name=shape]', (r) => r.map((x) => x.value));
  check('broker: AI and 3D model tiles first', tiles.join() === 'ai,model,pin,cube,sign', tiles.join());
  const head = await p.textContent('[data-trail-mode]');
  check('broker: header reads the category, no mode', head.includes('Недвижими имоти') && !/отбор|ред/i.test(head), head);
  check('broker: no old-trail note on a trail without questions', !(await p.$('[data-hidden-note]')));
  const words = await readAll(p, bstop);
  const bad = BAD_BG.exec(words.all);
  check('broker: no team/points/standings/question/hint words anywhere in the builder (BG)', !bad, bad ? around(words.all, bad) : '');
  const badOrder = BAD_BG_ORDER.exec(words.noImport);
  check('broker: no order word outside the import box (BG)', !badOrder, badOrder ? around(words.noImport, badOrder) : '');
  // Settings: category and city, the visibility rungs still there.
  await p.click('[data-ed-tab="settings"]');
  check('broker: category select in Settings, estate chosen', (await p.inputValue('[data-category]')) === 'estate');
  const cats = await p.$$eval('[data-category] option', (o) => o.map((x) => x.value));
  check('category select has the four categories', cats.join() === 'education,tourism,estate,other', cats.join());
  check('broker: city field in Settings', !!(await p.$('[data-city]')));
  check('broker: visibility still offered', (await p.$$('[data-level]')).length === 2);
  await p.selectOption('[data-category]', 'tourism');
  check('category change is stored', await waitFor(async () => (await sql(`select category from worlds where id = $1`, [bid]))[0].category === 'tourism', 5000));
  await p.screenshot({ path: `${SHOTS}/builder-work-broker-settings.png`, fullPage: true });
  await p.close();

  const pe = await open(br, bid, '/en');
  await pe.waitForSelector(`[data-pick="${bstop}"]`, { timeout: 20000 });
  const wordsEn = await readAll(pe, bstop);
  const badEn = BAD_EN.exec(wordsEn.all);
  check('broker: no team/points/standings/question/hint/order words anywhere in the builder (EN)', !badEn, badEn ? around(wordsEn.all, badEn) : '');
  await pe.close();

  // ------------------------------------------------- broker, an old trail
  const oid = await trail(cb, 'Лаб стар', 'ctf', 'other');
  const ostop = await stop(oid, br.id, 'Стара спирка');
  const { error: aerr } = await cb.rpc('set_marker_answer', {
    p_marker: ostop, p_kind: 'exact', p_accepted: ['3', 'три'], p_correct_choices: null, p_points: 25,
    p_cooldown_seconds: 15, p_on_wrong: 'retry', p_deduct_points: 0, p_after_text: { bg: 'Браво' },
  });
  if (aerr) throw aerr;
  await sql(`insert into marker_hints (marker_id, ord, cost, body) values ($1, 1, 5, '{"bg":"Погледни нагоре"}')`, [ostop]);
  const before = await sql(`select kind, accepted, points, after_text from marker_answers where marker_id = $1`, [ostop]);
  const po = await open(br, oid);
  await po.waitForSelector(`[data-pick="${ostop}"]`, { timeout: 20000 });
  await po.waitForSelector('[data-hidden-note]', { timeout: 10000 });
  const note = await po.textContent('[data-hidden-note]');
  check('broker old trail: the note says it has questions', note.includes('Този маршрут има въпроси'), note);
  // Change the title and save: the question must come through untouched.
  await po.click(`[data-pick="${ostop}"]`);
  await po.waitForSelector('[data-marker-form]:not(.hidden)');
  await po.fill('input[name=titleBg]', 'Стара спирка 2');
  await po.click('[data-marker-save]');
  await waitFor(async () => (await sql(`select content from markers where id = $1`, [ostop]))[0].content?.bg?.title === 'Стара спирка 2', 10000);
  const [after] = await sql(`select content from markers where id = $1`, [ostop]);
  const answers = await sql(`select kind, accepted, points, after_text from marker_answers where marker_id = $1`, [ostop]);
  const hints = await sql(`select count(*)::int n from marker_hints where marker_id = $1`, [ostop]);
  check('broker old trail: title saved', after.content?.bg?.title === 'Стара спирка 2', JSON.stringify(after.content));
  check('broker old trail: question text kept in the stop', after.content?.bg?.question === 'Колко врати?', JSON.stringify(after.content));
  check('broker old trail: answer row untouched', JSON.stringify(answers) === JSON.stringify(before), JSON.stringify(answers));
  check('broker old trail: hint kept', hints[0].n === 1);
  await po.close();

  // ----------------------------------------------------------------- guide
  const gu = await makeUser('bw-guide', { work: 'guide' });
  const cg = await api(gu);
  const gid = await trail(cg, 'Лаб водач', 'guide', 'tourism');
  const gstop = await stop(gid, gu.id, 'Безистен');
  const pg = await open(gu, gid);
  await pg.waitForSelector(`[data-pick="${gstop}"]`, { timeout: 20000 });
  check('guide: five steps with Question', (await steps(pg)).join() === 'place,visual,question,media,review', (await steps(pg)).join());
  check('guide: no Results tab, team size or start', !(await pg.$('[data-ed-tab="results"]')) && !(await pg.$('[data-team-row]')) && !(await pg.$('[data-start-mode]')));
  check('guide: one-at-a-time offered on an ordered trail', !!(await pg.$('[data-reveal-row]')));
  await pg.click(`[data-pick="${gstop}"]`);
  await pg.waitForSelector('[data-marker-form]:not(.hidden)');
  await pg.click('[data-step="question"]');
  await pg.waitForSelector('[data-panel="question"]:not(.hidden)', { timeout: 15000 });
  await pg.click('label:has(input[name=kind][value=exact])');
  const shown = await pg.$$eval('[data-points-only]', (l) => l.filter((x) => x.offsetParent !== null || getComputedStyle(x).display !== 'none').length);
  check('guide: no points field or hint cost (data-points-only hidden)', shown === 0, String(shown));
  check('guide: no tile reorder (pin first)', (await pg.$$eval('[data-panel="visual"] input[name=shape]', (r) => r[0].value)) === 'pin');
  await pg.close();

  // ---------------------------------------------- broker editing a teacher's trail
  const te = await makeUser('bw-teacher', { work: 'teacher' });
  const ct = await api(te);
  const tid = await trail(ct, 'Лаб учител', 'ctf', 'education');
  const tstop = await stop(tid, te.id, 'Училище');
  await sql(`insert into world_members (world_id, user_id, role) values ($1, $2, 'editor')`, [tid, br.id]);
  const pt = await open(br, tid);
  await pt.waitForSelector(`[data-pick="${tstop}"]`, { timeout: 20000 });
  check('editor sees by their own work: broker on a teacher trail has four steps', (await steps(pt)).join() === 'place,visual,media,review', (await steps(pt)).join());
  await pt.close();
  const ptt = await open(te, tid);
  await ptt.waitForSelector(`[data-pick="${tstop}"]`, { timeout: 20000 });
  check('teacher: five steps and the Results tab', (await steps(ptt)).length === 5 && !!(await ptt.$('[data-ed-tab="results"]')) && !!(await ptt.$('[data-team-row]')));
  await ptt.close();

  // ------------------------------------------------------------------ city
  const ot = await makeUser('bw-city', { work: 'other' });
  const co = await api(ot);
  const cid = await trail(co, 'Лаб град', 'educational', 'other');
  const pc = await open(ot, cid);
  await pc.waitForTimeout(3000);
  if (!NO_NET) {
    // The map opens on Yambol: a click in the middle places the first stop there.
    const box = await (await pc.$('[data-map]')).boundingBox();
    const t0 = Date.now();
    await pc.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const got = await waitFor(async () => (await cityOf(cid)).city?.key === 'yambol', 10000);
    check('city: first stop at Yambol sets city.key = yambol within 10 s', got, `${JSON.stringify((await cityOf(cid)).city)} after ${Date.now() - t0} ms`);
    check('city: city_auto stays true', (await cityOf(cid)).city_auto === true);
    await pc.waitForSelector('[data-marker-form]:not(.hidden)');
    await pc.fill('input[name=titleBg]', 'Първа');
    // Moved 200 km away: the city follows the stop while city_auto is on.
    await pc.click('[data-step="place"]');
    await pc.waitForSelector('[data-panel="place"]:not(.hidden)');
    await pc.fill('input[name=lat]', String(SOFIA[1]));
    await pc.fill('input[name=lng]', String(SOFIA[0]));
    await pc.click('[data-marker-save]');
    const moved = await waitFor(async () => (await cityOf(cid)).city?.key === 'sofia', 15000);
    check('city: moving the stop far away re-finds the city', moved, JSON.stringify((await cityOf(cid)).city));
    await pc.click('[data-ed-tab="settings"]');
    check('city: shown in Settings with the auto hint', /София/.test(await pc.inputValue('[data-city]')) && await pc.isVisible('[data-city-auto]'), await pc.inputValue('[data-city]'));
  } else {
    console.log('SKIP city lookup (NO_NET=1)');
    await stop(cid, ot.id, 'Първа', SOFIA);
    await pc.reload();
    await pc.waitForSelector('[data-pick]', { timeout: 20000 });
  }

  // Manual: typed by a person, city_auto off, and a move does not overwrite it.
  await pc.click('[data-ed-tab="settings"]');
  await pc.fill('[data-city]', 'Тунджа');
  await pc.press('[data-city]', 'Enter');
  await pc.locator('[data-city]').blur();
  const typed = await waitFor(async () => (await cityOf(cid)).city?.bg === 'Тунджа', 5000);
  const tc = await cityOf(cid);
  check('manual city: stored as typed, city_auto false', typed && tc.city_auto === false && tc.city.key === 'tundzha' && tc.city.en === 'Тунджа', JSON.stringify(tc));
  check('manual city: the auto hint is gone', !(await pc.isVisible('[data-city-auto]')));
  await pc.click('[data-ed-tab="stops"]');
  const [first] = await sql(`select id from markers where world_id = $1`, [cid]);
  await pc.click(`[data-pick="${first.id}"]`);
  await pc.waitForSelector('[data-marker-form]:not(.hidden)');
  await pc.click('[data-step="place"]');
  await pc.waitForSelector('[data-panel="place"]:not(.hidden)');
  await pc.fill('input[name=lat]', String(YAMBOL[1]));
  await pc.fill('input[name=lng]', String(YAMBOL[0]));
  await pc.click('[data-marker-save]');
  await pc.waitForTimeout(NO_NET ? 1500 : 6000);
  check('manual city: a move afterwards does not overwrite it', (await cityOf(cid)).city?.bg === 'Тунджа', JSON.stringify((await cityOf(cid)).city));

  // A known city from the list copies its key and point.
  await pc.click('[data-ed-tab="settings"]');
  const known = await pc.$$eval('#known-cities option', (o) => o.map((x) => x.value));
  check('known cities offered in a datalist', known.length > 0, known.slice(0, 5).join(', '));
  if (known.includes('Ямбол')) {
    await pc.fill('[data-city]', 'Ямбол');
    await pc.locator('[data-city]').blur();
    const kc = await waitFor(async () => (await cityOf(cid)).city?.key === 'yambol', 5000);
    const k = await cityOf(cid);
    check('known city: key, en and point copied', kc && k.city.en === 'Yambol' && typeof k.city.lat === 'number' && k.city_auto === false, JSON.stringify(k));
  }
  // Emptied: no city, and still not automatic.
  await pc.fill('[data-city]', '');
  await pc.locator('[data-city]').blur();
  await waitFor(async () => (await cityOf(cid)).city === null, 5000);
  const cleared = await cityOf(cid);
  check('empty city field clears the city, city_auto stays false', cleared.city === null && cleared.city_auto === false, JSON.stringify(cleared));
  await pc.screenshot({ path: `${SHOTS}/builder-work-city.png`, fullPage: true });
  await pc.close();
} finally {
  await b.close();
  await cleanUsers();
}
const real = errs.filter((e) => !/favicon|tiles|sprite|glyph|ERR_|net::|WebGL|webgl/i.test(e));
check('no page errors', real.length === 0, real.slice(0, 5).join(' | '));
done();
