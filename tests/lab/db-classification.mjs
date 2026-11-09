// Migration 0067: line of work (profiles.work), trail category and city.
import { check, done, makeUser, cleanUsers, api, sql, createClient, URL, ANON } from './lib.mjs';
try {
  // work: check constraint
  const u = await makeUser('cls-a');
  let code = null;
  try { await sql(`update public.profiles set work = 'pilot' where id = $1`, [u.id]); } catch (e) { code = e.code; }
  check("work='pilot' is refused (23514)", code === '23514', `code ${code}`);
  await sql(`update public.profiles set work = 'teacher' where id = $1`, [u.id]);
  const [p1] = await sql(`select work from public.profiles where id = $1`, [u.id]);
  check("work='teacher' is accepted", p1.work === 'teacher');

  // sign-up metadata is copied by handle_new_user, only when valid
  const b = await makeUser('cls-b', { work: 'broker' });
  const [pb] = await sql(`select work from public.profiles where id = $1`, [b.id]);
  check("sign-up metadata work='broker' gives profiles.work='broker'", pb.work === 'broker', String(pb.work));
  const c = await makeUser('cls-c', { work: 'pilot' });
  const [pc] = await sql(`select work from public.profiles where id = $1`, [c.id]);
  check("sign-up metadata work='pilot' gives null", pc.work === null, String(pc.work));
  const d = await makeUser('cls-d');
  const [pd] = await sql(`select work from public.profiles where id = $1`, [d.id]);
  check('no work metadata gives null', pd.work === null);

  // create_world category
  const ca = await api(u);
  const { data: w1, error: e1 } = await ca.rpc('create_world', { p_name: 'Lab cls estate', p_mode: 'guide', p_language: 'bg', p_category: 'estate' });
  check('create_world with p_category=estate works', !e1, e1?.message);
  check('category estate is stored', w1?.category === 'estate', String(w1?.category));
  const { data: w2, error: e2 } = await ca.rpc('create_world', { p_name: 'Lab cls plain', p_mode: 'guide', p_language: 'bg' });
  check('create_world without category works (old 3-arg call)', !e2, e2?.message);
  check("category defaults to 'other'", w2?.category === 'other', String(w2?.category));
  check('city defaults to null, city_auto to true', w2?.city === null && w2?.city_auto === true);
  const { error: e3 } = await ca.rpc('create_world', { p_name: 'Lab cls bad', p_mode: 'guide', p_language: 'bg', p_category: 'pilot' });
  check("category 'pilot' is refused", !!e3 && e3.code === '23514', e3?.code);
  const ov = await sql(`select count(*)::int n from pg_proc where proname = 'create_world' and pronamespace = 'public'::regnamespace`);
  check('exactly one create_world overload', ov[0].n === 1, String(ov[0].n));

  // a published public trail with one stop, to read through the listing functions
  const city = { key: 'sofia', bg: 'София', en: 'Sofia', lat: 42.6977, lng: 23.3219 };
  await sql(`update public.worlds set visibility = 'public', status = 'published', category = 'estate', city = $2::jsonb where id = $1`, [w1.id, JSON.stringify(city)]);
  const { error: pm } = await ca.rpc('place_marker', { p_world: w1.id, p_lat: 42.6977, p_lng: 23.3219, p_status: 'published' });
  check('a stop is placed', !pm, pm?.message);

  const { data: pub, error: pe } = await ca.rpc('public_trails');
  const row = (pub || []).find((r) => r.id === w1.id);
  check('public_trails() returns the trail', !pe && !!row, pe?.message);
  check('public_trails() row has category and city', row && 'category' in row && 'city' in row);
  check('public_trails() category/city values', row?.category === 'estate' && row?.city?.key === 'sofia');

  const { data: near, error: ne } = await ca.rpc('trails_near', { p_lat: 42.6977, p_lng: 23.3219, p_radius_m: 5000 });
  const nrow = (near || []).find((r) => r.id === w1.id);
  check('trails_near() returns the trail', !ne && !!nrow, ne?.message);
  check('trails_near() row has category and city', nrow && 'category' in nrow && 'city' in nrow);
  check('trails_near() category/city values', nrow?.category === 'estate' && nrow?.city?.en === 'Sofia');

  const { data: mine } = await ca.rpc('my_worlds');
  const mrow = (mine || []).find((r) => r.id === w2.id);
  check('my_worlds() row has category and city', mrow && 'category' in mrow && 'city' in mrow);
  check("my_worlds() category 'other'", mrow?.category === 'other');

  const { data: sum, error: se } = await ca.rpc('trail_summary', { p_world: w1.id });
  const srow = Array.isArray(sum) ? sum[0] : sum;
  check('trail_summary() row has category and city', !se && srow && 'category' in srow && 'city' in srow, se?.message);
  check('trail_summary() category/city values', srow?.category === 'estate' && srow?.city?.key === 'sofia');
  check('trail_summary() still has the old columns', srow && ['stop_count', 'team_count', 'total_points', 'needs_account'].every((k) => k in srow));

  // grants unchanged: public listing readable signed out, my_worlds not
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: ae } = await anon.rpc('public_trails');
  check('public_trails() still open to signed-out', !ae, ae?.message);
  const { error: me } = await anon.rpc('my_worlds');
  check('my_worlds() still closed to signed-out', !!me);
} finally { await cleanUsers(); }
done();
