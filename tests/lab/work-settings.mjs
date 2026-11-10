// Task 7: the line of work in Account -> Settings (the one-time My trails card went in R2).
import { browser, BASE, check, done, makeUser, cleanUsers, signIn, sql } from './lib.mjs';

const b = await browser();
const errs = [];
const workOf = async (id) => (await sql(`select work from public.profiles where id = $1`, [id]))[0]?.work;
try {
  const p = await b.newPage({ viewport: { width: 390, height: 900 } });
  p.on('pageerror', (e) => errs.push(e.message));

  // 1. R2 removed the one-time card from My trails (the choose-role screen
  //    asks now). A creator with work still null sees no card, both questions
  //    in the create form, and guide's form once work is set elsewhere.
  const u = await makeUser('ws-null', { work: null });
  await signIn(p, u);
  await p.goto(`${BASE}/my-trails/`);
  await p.waitForSelector('[data-mine]', { state: 'attached', timeout: 15000 });
  await p.waitForTimeout(1500);
  check('no one-time card on My trails', (await p.$$('[data-work-ask]')).length === 0);
  check('stayed on My trails (role is set)', new globalThis.URL(p.url()).pathname === '/my-trails/', p.url());
  await p.click('[data-new-open]');
  const before = await p.$$eval('[data-create] legend', (l) => l.length);
  check('never-asked work sees both questions', before === 2, String(before));
  await sql(`update public.profiles set work = 'guide' where id = $1`, [u.id]);
  await p.reload();
  await p.waitForSelector('[data-mine]', { state: 'attached', timeout: 15000 });
  await p.waitForTimeout(1500);
  await p.click('[data-new-open]');
  const after = await p.$$eval('[data-create] legend', (l) => l.map((x) => x.textContent.trim()));
  check('guide sees only the order question', after.length === 1 && after[0].includes('ред'), after.join(' | '));
  check('category now tourism', (await p.inputValue('[data-new-category]')) === 'tourism');

  // 2. Account -> Settings shows Guide checked; change to Estate broker.
  await p.goto(`${BASE}/account/#settings`);
  await p.waitForSelector('[data-work-form] input[name="work"]', { timeout: 15000 });
  await p.waitForTimeout(800);
  check('settings: Tour guide checked', await p.isChecked('[data-work-form] input[value="guide"]'));
  check('settings legend', (await p.textContent('[data-work-form] legend')).trim() === 'С какво се занимавате?');
  await p.check('[data-work-form] input[value="broker"]');
  await p.click('[data-work-form] button[type="submit"]');
  await p.waitForFunction(() => document.querySelector('[data-work-msg]')?.textContent.includes('Запазено'), null, { timeout: 10000 });
  check('shows Запазено', true);
  check("stored 'broker'", (await workOf(u.id)) === 'broker', String(await workOf(u.id)));

  // 3. English settings; a never-asked account has nothing checked there.
  const n = await makeUser('ws-null2', { work: null });
  const p2 = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await signIn(p2, n, '/en');
  await p2.goto(`${BASE}/en/account/#settings`);
  await p2.waitForSelector('[data-work-form] input[name="work"]', { timeout: 15000 });
  await p2.waitForTimeout(800);
  check('EN legend', (await p2.textContent('[data-work-form] legend')).trim() === 'What do you do?');
  check('never-asked: nothing checked in settings', (await p2.$$('[data-work-form] input:checked')).length === 0);
  await p2.check('[data-work-form] input[value="teacher"]');
  await p2.click('[data-work-form] button[type="submit"]');
  await p2.waitForFunction(() => document.querySelector('[data-work-msg]')?.textContent.includes('Saved'), null, { timeout: 10000 });
  check("EN: stored 'teacher'", (await workOf(n.id)) === 'teacher');
  await p2.goto(`${BASE}/en/my-trails/`);
  await p2.waitForSelector('[data-mine]', { state: 'attached', timeout: 15000 });
  await p2.waitForTimeout(1500);
  check('no card on My trails', (await p2.$$('[data-work-ask]')).length === 0);

  // 4. An already-asked account never sees the card.
  const o = await makeUser('ws-other');
  const p3 = await b.newPage({ viewport: { width: 390, height: 900 } });
  await signIn(p3, o);
  await p3.goto(`${BASE}/my-trails/`);
  await p3.waitForSelector('[data-mine]', { state: 'attached', timeout: 15000 });
  await p3.waitForTimeout(1500);
  check("work='other' gets no card", (await p3.$$('[data-work-ask]')).length === 0);

  check('no page errors', errs.length === 0, errs.join(' | '));
} finally {
  await b.close();
  await cleanUsers();
}
done();
