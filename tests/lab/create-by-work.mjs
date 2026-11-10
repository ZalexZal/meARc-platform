// Task 8: creating a trail follows the line of work.
import { browser, BASE, check, done, makeUser, cleanUsers, signIn, sql } from './lib.mjs';

const b = await browser();
const errs = [];
async function open(user, lang = '') {
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept().catch(() => {}));
  await signIn(p, user, lang);
  await p.goto(`${BASE}${lang}/my-trails/?new=1`);
  await p.waitForSelector('[data-create]:not([hidden])', { timeout: 15000 });
  return p;
}
const legends = (p) => p.$$eval('[data-create] legend', (l) => l.map((x) => x.textContent.trim()));
try {
  // Broker: no questions, estate, educational, card is "Недвижими имоти".
  const br = await makeUser('cbw-broker', { work: 'broker' });
  const p = await open(br);
  const lb = await legends(p);
  check('broker: no mode questions', lb.length === 0, lb.join(' | '));
  const formText = await p.textContent('[data-create]');
  check('broker: no "Отбори" or "ред" text in the form', !/Отбори|ред/.test(formText), formText.replace(/\s+/g, ' ').slice(0, 200));
  check('broker: category preset to estate', (await p.inputValue('[data-new-category]')) === 'estate');
  await p.fill('[data-new-name]', 'Лаб брокер имот');
  await p.click('[data-create-submit]');
  await p.waitForURL(/\/trail\/?\?id=/, { timeout: 20000 });
  const [w] = await sql(`select id, mode, category from worlds where owner_id = $1`, [br.id]);
  check('broker: mode educational', w?.mode === 'educational', w?.mode);
  check('broker: category estate', w?.category === 'estate', w?.category);
  await p.goto(`${BASE}/my-trails/`);
  await p.waitForSelector('[data-card]', { timeout: 15000 });
  const card = await p.textContent(`[data-card="${w.id}"]`);
  check('broker: card has no "отбор"', !/отбор/i.test(card), card.replace(/\s+/g, ' ').slice(0, 200));
  check('broker: card says Недвижими имоти', card.includes('Недвижими имоти'));
  check('broker: no "По ред" on the card', !/По ред|Свободен ред/.test(card));
  check('broker: no standings button', !(await p.$(`[data-card="${w.id}"] a[href*="/board"]`)));
  check('broker: visibility controls still there', (await p.$$(`[data-card="${w.id}"] [data-vis]`)).length === 2 && !!(await p.$(`[data-card="${w.id}"] [data-ask]`)));

  // The whole page, not only the form: no word about teams, points, standings or order.
  await p.goto(`${BASE}/my-trails/`);
  await p.waitForSelector('[data-card]', { timeout: 15000 });
  await p.waitForTimeout(500);
  const whole = await p.evaluate(() => document.body.innerText);
  const bad = /отбор|точки|класиране|(^|[^\p{L}])ред([^\p{L}]|$)/iu.exec(whole);
  check('broker: no teams/points/standings/order words anywhere on /my-trails/', !bad, bad ? whole.slice(Math.max(0, bad.index - 40), bad.index + 40) : '');
  check('broker: tile text is the plain sentence', (await p.textContent('[data-new-body]')).trim() === 'Дай му име и после докосни картата, за да добавиш първата спирка.');
  const pe = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(pe, br, '/en');
  await pe.goto(`${BASE}/en/my-trails/`);
  await pe.waitForSelector('[data-card]', { timeout: 15000 });
  await pe.waitForTimeout(500);
  const wholeEn = await pe.evaluate(() => document.body.innerText);
  const badEn = /team|standing|points|\border\b/i.exec(wholeEn);
  check('broker: no team/standings/points/order words on /en/my-trails/', !badEn, badEn ? wholeEn.slice(Math.max(0, badEn.index - 40), badEn.index + 40) : '');
  await pe.close();

  // An old scored trail with another category: still only "Category · City" for a broker.
  await sql(`update worlds set mode = 'ctf', category = 'other', city = $2::jsonb where id = $1`,
    [w.id, JSON.stringify({ key: 'yambol', bg: 'Ямбол', en: 'Yambol', lat: 42.48, lng: 26.5 })]);
  await p.reload();
  await p.waitForSelector('[data-card]', { timeout: 15000 });
  const oldCard = (await p.textContent(`[data-card="${w.id}"]`)).replace(/\s+/g, ' ');
  check('broker: old ctf trail reads "Друго · Ямбол"', oldCard.includes('Друго · Ямбол'), oldCard.slice(0, 200));
  check('broker: old ctf trail card has no "отбор"', !/отбор/i.test(oldCard));
  check('broker: no standings button on the old ctf trail', !(await p.$(`[data-card="${w.id}"] a[href*="/board"]`)));

  // Guide: order question only, tourism by default.
  const gu = await makeUser('cbw-guide', { work: 'guide' });
  const pg = await open(gu);
  const lg = await legends(pg);
  check('guide: only the order question', lg.length === 1 && lg[0].includes('ред') && !lg.join().includes('Отбори'), lg.join(' | '));
  check('guide: category preset to tourism', (await pg.inputValue('[data-new-category]')) === 'tourism');
  await pg.fill('[data-new-name]', 'Лаб екскурзовод');
  await pg.click('[data-create-submit]');
  await pg.waitForURL(/\/trail\/?\?id=/, { timeout: 20000 });
  const [gw] = await sql(`select id, mode, category from worlds where owner_id = $1`, [gu.id]);
  check('guide: no teams, in order = guide', gw?.mode === 'guide', gw?.mode);
  check('guide: category tourism', gw?.category === 'tourism', gw?.category);
  await pg.goto(`${BASE}/my-trails/`);
  await pg.waitForSelector('[data-card]', { timeout: 15000 });
  const gcard = await pg.textContent(`[data-card="${gw.id}"]`);
  check('guide: card reads "Без отбори · По ред · Туризъм"', gcard.includes('Без отбори · По ред · Туризъм'), gcard.replace(/\s+/g, ' ').slice(0, 200));

  // Teacher: both questions, education; can pick another category.
  const te = await makeUser('cbw-teacher', { work: 'teacher' });
  const pt = await open(te, '/en');
  const lt = await legends(pt);
  check('teacher: both questions', lt.length === 2 && lt[0].includes('Teams') && lt[1].includes('order'), lt.join(' | '));
  check('teacher: category preset to education', (await pt.inputValue('[data-new-category]')) === 'education');
  const opts = await pt.$$eval('[data-new-category] option', (o) => o.map((x) => x.value));
  check('category select has the four categories', opts.join() === 'education,tourism,estate,other', opts.join());
  await pt.selectOption('[data-new-category]', 'tourism');
  await pt.fill('[data-new-name]', 'Lab teacher pts');
  await pt.click('label:has(input[name=scored][value=yes])');
  await pt.click('[data-create-submit]');
  await pt.waitForURL(/\/trail\/?\?id=/, { timeout: 20000 });
  const [tw] = await sql(`select id, mode, category from worlds where owner_id = $1`, [te.id]);
  check('teacher: scored + in order = ctf', tw?.mode === 'ctf', tw?.mode);
  check('teacher: chosen category stored', tw?.category === 'tourism', tw?.category);
  await pt.goto(`${BASE}/en/my-trails/`);
  await pt.waitForSelector('[data-card]', { timeout: 15000 });
  const tcard = await pt.textContent(`[data-card="${tw.id}"]`);
  check('teacher: EN card line', tcard.includes('Teams & standings · In order · Tourism'), tcard.replace(/\s+/g, ' ').slice(0, 200));
  check('teacher: standings button shown', !!(await pt.$(`[data-card="${tw.id}"] a[href*="/board"]`)));

  // A guide who owns a scored trail (made elsewhere): no standings button, since results are hidden.
  await sql(`update worlds set mode = 'freefall' where id = $1`, [gw.id]);
  await pg.reload();
  await pg.waitForSelector('[data-card]', { timeout: 15000 });
  check('guide: no standings button even on a scored trail', !(await pg.$(`[data-card="${gw.id}"] a[href*="/board"]`)));

  check('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
  await cleanUsers();
}
done();
