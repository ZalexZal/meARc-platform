// Migration 0072: two ways to share a trail (code, public) and "public" is instant.
// Needs 0072 applied first:  node tools/apply-0072.mjs
// Run:  node tests/lab/visibility.mjs   (DB only; no browser)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { check, done, makeUser, cleanUsers, api, sql, createClient, URL, ANON } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const msg = (e) => e?.message ?? '';
const code = (e) => e?.code ?? null;

const [{ ok: applied }] = await sql(`select to_regprocedure('public.make_public(uuid)') is not null ok`);
if (!applied) { console.log('SKIP: 0072 not applied'); process.exit(0); }

const stop = (world, owner, status) => sql(`insert into public.markers
  (world_id, location, style_key, colour_hex, content, status, step, radius_m, created_by)
  values ($1, extensions.st_makepoint(26.5, 42.48)::extensions.geography, 'pin', '#0066cc', '{}'::jsonb, $3, 1, 40, $2)
  returning id`, [world, owner, status]);

try {
  const owner = await makeUser('vis-owner');
  const stranger = await makeUser('vis-stranger');
  const co = await api(owner), cs = await api(stranger);
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const listed = async (c, id) => ((await c.rpc('public_trails')).data ?? []).some((r) => r.id === id);

  // ---- (c) a new trail starts at the code level
  const { data: made, error: me } = await co.rpc('create_world', { p_name: 'Lab visibility trail', p_mode: 'guide', p_language: 'bg' });
  const w = Array.isArray(made) ? made[0] : made;
  check('create_world works', !me && !!w?.id, msg(me));
  check('a new trail is at the code level (unlisted + published)', w?.visibility === 'unlisted' && w?.status === 'published', `${w?.visibility}/${w?.status}`);
  check('a new trail has a join code', !!w?.join_code);

  const [col] = await sql(`select
    (select column_default from information_schema.columns where table_schema='public' and table_name='worlds' and column_name='visibility') v,
    (select column_default from information_schema.columns where table_schema='public' and table_name='worlds' and column_name='status') s`);
  check('column defaults are unlisted / published', /unlisted/.test(col.v) && /published/.test(col.s), `${col.v} ${col.s}`);

  check('a code-level trail is not in the public list', !(await listed(anon, w.id)));
  const { error: je } = await cs.rpc('join_world', { p_code: w.join_code });
  check('the code still opens it for a stranger', !je, msg(je));

  // ---- (b) make public is instant, with the same checks
  const r0 = await co.rpc('make_public', { p_world: w.id });
  check('make_public refuses a trail with no stops', !!r0.error && code(r0.error) === '23514', msg(r0.error));

  const [{ id: draft }] = await stop(w.id, owner.id, 'draft');
  const r1 = await co.rpc('make_public', { p_world: w.id });
  check('make_public refuses while a stop is still a draft', !!r1.error && code(r1.error) === '23514', msg(r1.error));
  check('...and the trail stays unlisted', !(await listed(anon, w.id)));

  await sql(`update public.markers set status = 'published' where id = $1`, [draft]);

  const rs = await cs.rpc('make_public', { p_world: w.id });
  check('a stranger cannot make it public', !!rs.error && code(rs.error) === '42501', msg(rs.error));

  const r2 = await co.rpc('make_public', { p_world: w.id });
  const row = Array.isArray(r2.data) ? r2.data[0] : r2.data;
  check('make_public succeeds for the owner', !r2.error && row?.visibility === 'public' && row?.status === 'published', msg(r2.error));
  check('the trail is in the public list at once, for anybody', await listed(anon, w.id) && await listed(cs, w.id));
  const [{ pending }] = await sql(`select count(*)::int pending from public.worlds where id = $1 and status = 'submitted'`, [w.id]);
  check('nothing was queued', pending === 0);

  // ---- going back to the code unlists it
  const r3 = await co.rpc('make_code', { p_world: w.id });
  const back = Array.isArray(r3.data) ? r3.data[0] : r3.data;
  check('make_code succeeds for the owner', !r3.error && back?.visibility === 'unlisted' && back?.status === 'published', msg(r3.error));
  check('going back to the code unlists it', !(await listed(anon, w.id)));
  const rs2 = await cs.rpc('make_code', { p_world: w.id });
  check('a stranger cannot change it back', !!rs2.error && code(rs2.error) === '42501', msg(rs2.error));

  // ---- the old name does the same thing, instantly
  const r4 = await co.rpc('request_listing', { p_world: w.id });
  check('request_listing now lists at once', !r4.error && await listed(anon, w.id), msg(r4.error));
  await co.rpc('make_code', { p_world: w.id });

  // ---- (a) an old private trail is moved by the migration's own UPDATE
  const [old] = await sql(`insert into public.worlds (owner_id, name, join_code, visibility, mode, status)
    values ($1, 'Lab old private', 'OP' || substr(md5(random()::text), 1, 6), 'private', 'guide', 'draft') returning id, join_code`, [owner.id]);
  const [old2] = await sql(`insert into public.worlds (owner_id, name, join_code, visibility, mode, status)
    values ($1, 'Lab old submitted', 'OS' || substr(md5(random()::text), 1, 6), 'unlisted', 'guide', 'submitted') returning id`, [owner.id]);
  // The statements are lifted out of the migration file and pinned to these two rows.
  const file = fs.readFileSync(path.join(here, '../../supabase/migrations/0072_public_instant.sql'), 'utf8');
  const moveSql = file.match(/update public\.worlds\s+set visibility = 'unlisted',[\s\S]*?\(visibility = 'private' or status = 'draft'\);/)?.[0];
  const queueSql = file.match(/update public\.worlds\s+set visibility  = 'public',[\s\S]*?where status = 'submitted';/)?.[0];
  check('the migration statements were found', !!moveSql && !!queueSql);
  await sql(moveSql.replace(/;\s*$/, ' and id = $1;'), [old.id]);
  await sql(queueSql.replace(/;\s*$/, ' and id = $1;'), [old2.id]);
  const [moved] = await sql(`select visibility, status, join_code from public.worlds where id = $1`, [old.id]);
  check('an old private trail is moved to the code level', moved.visibility === 'unlisted' && moved.status === 'published', `${moved.visibility}/${moved.status}`);
  check('...and keeps its join code', moved.join_code === old.join_code);
  const [queued] = await sql(`select visibility, status from public.worlds where id = $1`, [old2.id]);
  check('a row still in the queue is approved', queued.visibility === 'public' && queued.status === 'published', `${queued.visibility}/${queued.status}`);
} finally {
  await cleanUsers();
}
done();
