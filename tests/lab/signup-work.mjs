// Task 6: the sign-up form asks for the line of work.
// The form is tested with the sign-up request stubbed (so no real account is
// made and nothing is rate-limited); the database path is tested with makeUser.
import { browser, BASE, URL as SB, check, done, makeUser, cleanUsers, sql } from './lib.mjs';

const b = await browser();
try {
  const page = await (await b.newContext({ viewport: { width: 390, height: 900 } })).newPage();
  const signups = [];
  await page.route(`${SB}/auth/v1/signup*`, async (route) => {
    signups.push(route.request().postDataJSON());
    await route.fulfill({ status: 422, contentType: 'application/json',
      body: JSON.stringify({ code: 422, error_code: 'user_already_exists', msg: 'User already registered' }) });
  });

  async function fill() {
    await page.goto(`${BASE}/signup/`);
    await page.fill('#email', 'lab-test-stub@example.com');
    await page.fill('#password', 'Lab-test-password-1');
    await page.check('input[name="age"][value="14+"]');
    await page.check('[data-auth-agree]');
  }

  // 1. The fieldset: four radios, none checked, in the declared order.
  await fill();
  const values = await page.$$eval('[data-work] input[name="work"]', (r) => r.map((x) => x.value));
  check('four work radios in order', values.join() === 'broker,teacher,guide,other', values.join());
  check('none pre-selected', (await page.$$('[data-work] input[name="work"]:checked')).length === 0);
  const legend = await page.textContent('[data-work] legend');
  check('legend is the BG question', legend.trim() === 'С какво се занимавате?', legend);
  const hint = await page.textContent('[data-work]');
  check('Other hint shown', hint.includes('Всички възможности — и ако само ще вървите по маршрути.'));
  const heights = await page.$$eval('[data-work] label', (l) => l.map((x) => Math.round(x.getBoundingClientRect().height)));
  check('touch targets >= 44px', heights.length >= 4 && heights.every((h) => h >= 44), heights.join());

  // 2. No choice: error at the first radio, no request.
  await page.click('[data-auth-submit]');
  await page.waitForTimeout(600);
  const err = await page.textContent('[data-auth-error]');
  check('missing choice shows err.work', err.includes('Изберете с какво се занимавате.'), err.trim());
  check('no request sent without a choice', signups.length === 0);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('value'));
  check('first radio is focused', focused === 'broker', String(focused));

  // 3. Teacher chosen: the request carries work in the metadata.
  await page.check('input[name="work"][value="teacher"]');
  await page.click('[data-auth-submit]');
  await page.waitForTimeout(1500);
  check('one sign-up request sent', signups.length === 1, String(signups.length));
  check("request body carries work: 'teacher'", signups[0]?.data?.work === 'teacher', JSON.stringify(signups[0]?.data));

  // 4. English page.
  await page.goto(`${BASE}/en/signup/`);
  const enLegend = await page.textContent('[data-work] legend');
  check('EN legend', enLegend.trim() === 'What do you do?', enLegend);
  check('EN labels', (await page.textContent('[data-work]')).includes('Tour guide'));

  // 5. Database path: sign-up metadata becomes profiles.work.
  const t = await makeUser('sw-teacher', { work: 'teacher' });
  const [pt] = await sql(`select work from public.profiles where id = $1`, [t.id]);
  check("metadata work='teacher' gives profiles.work='teacher'", pt.work === 'teacher', String(pt.work));
  const d = await makeUser('sw-default');
  const [pd] = await sql(`select work from public.profiles where id = $1`, [d.id]);
  check("makeUser defaults to work='other'", pd.work === 'other', String(pd.work));
  const n = await makeUser('sw-null', { work: null });
  const [pn] = await sql(`select work from public.profiles where id = $1`, [n.id]);
  check('meta.work = null gives the never-asked state', pn.work === null, String(pn.work));
} finally {
  await b.close();
  await cleanUsers();
}
done();
