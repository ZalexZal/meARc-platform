// Task 6: the sign-up form asks for the line of work.
// The form is tested with the sign-up request stubbed (so no real account is
// made and nothing is rate-limited); the database path is tested with makeUser.
import { browser, BASE, URL as SB, ANON, check, done, makeUser, cleanUsers, sql } from './lib.mjs';

const b = await browser();
const guests = [];   // anonymous users made here, deleted by id in finally

// A guest, the way the app makes one: POST /auth/v1/signup with an empty body.
async function makeGuest() {
  const r = await fetch(`${SB}/auth/v1/signup`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: '{}',
  });
  const session = await r.json();
  if (!session.user?.id) throw new Error(`guest sign-up failed: ${JSON.stringify(session).slice(0, 200)}`);
  guests.push(session.user.id);
  return session;
}

// Signs the guest up as an account in a fresh page. PUT /auth/v1/user is
// stubbed (no email is sent) and answers the same user, confirmed; the
// profiles PATCH goes through for real unless failPatch is set.
async function upgrade(session, { failPatch }) {
  const ref = new globalThis.URL(SB).hostname.split('.')[0];
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(([key, value]) => { localStorage.setItem(key, value); },
    [`sb-${ref}-auth-token`, JSON.stringify(session)]);
  const puts = [];
  const patches = [];
  await page.route(`${SB}/auth/v1/user*`, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    puts.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ ...session.user, email: 'lab-test-guest@example.com',
        email_confirmed_at: new Date().toISOString(), is_anonymous: true }) });
  });
  await page.route(`${SB}/rest/v1/profiles*`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    patches.push(route.request().postData());
    if (failPatch) return route.fulfill({ status: 500, contentType: 'application/json',
      body: JSON.stringify({ message: 'stubbed failure' }) });
    return route.continue();
  });
  await page.goto(`${BASE}/signup/`);
  await page.fill('#email', 'lab-test-guest@example.com');
  await page.fill('#password', 'Lab-test-password-1');
  await page.check('input[name="age"][value="14+"]');
  await page.check('input[name="role"][value="creator"]');
  await page.check('input[name="work"][value="teacher"]');
  await page.check('[data-auth-agree]');
  await page.click('[data-auth-submit]');
  let left = true;
  try { await page.waitForURL((u) => !u.pathname.includes('signup'), { timeout: 15000 }); } catch { left = false; }
  const err = await page.textContent('[data-auth-error]').catch(() => '');
  await ctx.close();
  return { puts, patches, left, err };
}

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
    // R2: the work question is a creator's; it shows once creator is chosen.
    await page.check('input[name="role"][value="creator"]');
  }

  // 1. The fieldset: four radios, none checked, in the mockup's order.
  await fill();
  const values = await page.$$eval('[data-work] input[name="work"]', (r) => r.map((x) => x.value));
  check('four work radios in order', values.join() === 'teacher,guide,broker,other', values.join());
  check('none pre-selected', (await page.$$('[data-work] input[name="work"]:checked')).length === 0);
  const legend = await page.textContent('[data-work] legend');
  check('legend is the BG question', legend.trim() === 'С какво се занимавате?', legend);
  const hint = await page.textContent('[data-work]');
  check('Other hint shown', hint.includes('Всички възможности'));
  const heights = await page.$$eval('[data-work] label', (l) => l.map((x) => Math.round(x.getBoundingClientRect().height)));
  check('touch targets >= 44px', heights.length >= 4 && heights.every((h) => h >= 44), heights.join());

  // 2. No choice: error at the first radio, no request.
  await page.click('[data-auth-submit]');
  await page.waitForTimeout(600);
  const err = await page.textContent('[data-auth-error]');
  check('missing choice shows err.work', err.includes('Изберете с какво се занимавате.'), err.trim());
  check('no request sent without a choice', signups.length === 0);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('value'));
  check('first radio is focused', focused === 'teacher', String(focused));

  // 3. Teacher chosen: the request carries work in the metadata.
  await page.check('input[name="work"][value="teacher"]');
  await page.click('[data-auth-submit]');
  await page.waitForTimeout(1500);
  check('one sign-up request sent', signups.length === 1, String(signups.length));
  check("request body carries work: 'teacher'", signups[0]?.data?.work === 'teacher', JSON.stringify(signups[0]?.data));

  // 4. English page.
  await page.goto(`${BASE}/en/signup/`);
  await page.check('input[name="role"][value="creator"]');
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

  // 6. Guest upgrade: the insert trigger does not fire, so the client writes it.
  const g1 = await makeGuest();
  const up1 = await upgrade(g1, { failPatch: false });
  check('guest upgrade sent the metadata with work', up1.puts[0]?.data?.work === 'teacher', JSON.stringify(up1.puts[0]?.data));
  check('…and role, in the same one PATCH', JSON.parse(up1.patches[0] ?? '{}').role === 'creator' && JSON.parse(up1.patches[0] ?? '{}').work === 'teacher', up1.patches[0]);
  check('guest upgrade sent one profiles PATCH', up1.patches.length === 1, String(up1.patches.length));
  const [r1] = await sql(`select work, role from public.profiles where id = $1`, [g1.user.id]);
  check("guest's live profiles.work = 'teacher'", r1?.work === 'teacher', String(r1?.work));
  check("guest's live profiles.role = 'creator'", r1?.role === 'creator', String(r1?.role));
  check('guest upgrade continued past the form', up1.left, up1.err.trim());

  // 7. The same, with the profiles write failing: the sign-up still goes on.
  const g2 = await makeGuest();
  const up2 = await upgrade(g2, { failPatch: true });
  check('failed profiles PATCH was attempted', up2.patches.length === 1, String(up2.patches.length));
  const [r2] = await sql(`select work from public.profiles where id = $1`, [g2.user.id]);
  check('failed write leaves profiles.work null', r2?.work === null, String(r2?.work));
  check('failed profiles PATCH does not stop the sign-up', up2.left, up2.err.trim());
} finally {
  await b.close();
  if (guests.length) await sql(`delete from auth.users where id = any($1::uuid[])`, [guests]);
  await cleanUsers();
}
done();
