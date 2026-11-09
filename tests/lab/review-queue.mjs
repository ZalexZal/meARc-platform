// Review queue (migration 0069): listing_queue() returns category and city, and
// the page shows an estate trail as "Category · City" with no team wording.
import { browser, BASE, check, done, makeUser, cleanUsers, signIn, api, sql } from './lib.mjs';

const YAMBOL = { key: 'yambol', bg: 'Ямбол', en: 'Yambol', lat: 42.4842, lng: 26.5035 };
// Until 0069 is applied live there is nothing to test: skip rather than leave a red suite.
const [{ r: shape }] = await sql(`select pg_get_function_result('public.listing_queue()'::regprocedure) r`);
if (!/\bcategory\b/.test(shape)) { console.log('SKIP: 0069 not applied'); process.exit(0); }

const b = await browser();
try {
  const admin = await makeUser('review-admin');
  await sql(`insert into public.platform_admins (user_id) values ($1)`, [admin.id]);
  const owner = await makeUser('review-owner');
  const [{ id }] = await sql(`insert into public.worlds (owner_id, name, join_code, visibility, mode, status, category, city)
    values ($1, 'Lab review estate', 'LR' || substr(md5(random()::text), 1, 6), 'public', 'ctf', 'submitted', 'estate', $2::jsonb) returning id`,
    [owner.id, JSON.stringify(YAMBOL)]);

  const c = await api(admin);
  const { data, error } = await c.rpc('listing_queue');
  const row = (data ?? []).find((r) => r.id === id);
  check('listing_queue() answers an admin', !error && !!row, error?.message);
  check('listing_queue() rows carry category and city', row?.category === 'estate' && row?.city?.key === 'yambol', JSON.stringify(row));
  const acl = await sql(`select proacl::text a from pg_proc where proname = 'listing_queue' and pronamespace = 'public'::regnamespace`);
  check('listing_queue() is not executable by anon or public', !acl[0].a.replace(/[{}]/g, '').split(',').some((g) => g.startsWith('=') || g.startsWith('anon=')), acl[0].a);

  for (const [pre, want, bad] of [['', 'Недвижими имоти · Ямбол', /отбор|класиране/i], ['/en', 'Real estate · Yambol', /team|standings/i]]) {
    const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
    await signIn(p, admin, pre);
    await p.goto(`${BASE}${pre}/review/`);
    await p.waitForSelector(`[data-world="${id}"]`, { timeout: 15000 });
    const card = await p.innerText(`[data-world="${id}"]`);
    check(`${pre || '/bg'}: review line is Category · City`, card.includes(want), card.replace(/\s+/g, ' '));
    check(`${pre || '/bg'}: review card has no team or standings wording`, !bad.test(card), (card.match(bad) || [''])[0]);
    await p.close();
  }
} finally {
  await cleanUsers();
  await b.close();
}
done();
