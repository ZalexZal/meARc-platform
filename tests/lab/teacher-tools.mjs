// Migration 0071: teacher tools (moderator_kick / ban / unban, world_players,
// world_teams member user_id + gps_ok, banned users refused on every join path).
// Needs 0071 applied first:  node tools/apply-0071.mjs
import { check, done, makeUser, cleanUsers, api, sql, createClient, URL, ANON } from './lib.mjs';

const code = (e) => e?.code ?? null;
const msg = (e) => e?.message ?? '';

try {
  const owner = await makeUser('tt-owner');
  const s1 = await makeUser('tt-s1', { display_name: 'Ани' });
  const s2 = await makeUser('tt-s2');
  const s3 = await makeUser('tt-s3');
  const stranger = await makeUser('tt-stranger');
  await sql(`update public.profiles set display_name = 'Ани' where id = $1`, [s1.id]);
  await sql(`update public.profiles set display_name = 'Борис' where id = $1`, [s2.id]);

  // A scored, manually started trail, published and unlisted.
  const [world] = await sql(`insert into public.worlds (owner_id, name, join_code, visibility, mode, status, start_mode)
    values ($1, 'Lab teacher trail', 'TT' || substr(md5(random()::text), 1, 6), 'unlisted', 'ctf', 'published', 'manual')
    returning id, join_code`, [owner.id]);
  // A listed trail, for join_listed.
  const [listed] = await sql(`insert into public.worlds (owner_id, name, join_code, visibility, mode, status)
    values ($1, 'Lab listed trail', 'TL' || substr(md5(random()::text), 1, 6), 'public', 'ctf', 'published')
    returning id, join_code`, [owner.id]);
  const [marker] = await sql(`insert into public.markers (world_id, location, style_key, colour_hex, content, status, step, radius_m, created_by)
    values ($1, extensions.st_makepoint(26.5, 42.48)::extensions.geography, 'pin', '#0066cc', '{}'::jsonb, 'published', 1, 40, $2) returning id`,
    [world.id, owner.id]);

  const co = await api(owner), c1 = await api(s1), c2 = await api(s2), c3 = await api(s3), cs = await api(stranger);

  // ---- setup: s1 makes a team, s2 joins it, s3 joins the trail without a team
  for (const [c, n] of [[c1, 's1'], [c2, 's2'], [c3, 's3']]) {
    const { error } = await c.rpc('join_world', { p_code: world.join_code });
    check(`${n} joins the trail`, !error, msg(error));
  }
  const { data: t1, error: te } = await c1.rpc('create_team', { p_world: world.id, p_name: 'Лаб А' });
  const team = Array.isArray(t1) ? t1[0] : t1;
  check('s1 creates a team', !te && !!team?.id, msg(te));
  const { error: je } = await c2.rpc('join_team', { p_code: team.invite_code });
  check('s2 joins the team', !je, msg(je));
  await sql(`update public.team_members set gps_ok = true where team_id = $1 and user_id = $2`, [team.id, s1.id]);
  // The team has solved a stop, so it is on the scoreboard.
  await sql(`insert into public.marker_progress (team_id, marker_id, solved_by, points, skipped) values ($1, $2, $3, 100, false)`,
    [team.id, marker.id, s1.id]);

  // ---- world_players
  const { data: pl, error: ple } = await co.rpc('world_players', { p_world: world.id });
  check('owner can read world_players', !ple && Array.isArray(pl), msg(ple));
  const byId = Object.fromEntries((pl ?? []).map((r) => [r.user_id, r]));
  check('world_players lists the three students, not the owner',
    pl?.length === 3 && !byId[owner.id] && byId[s1.id] && byId[s2.id] && byId[s3.id], `n=${pl?.length}`);
  check('world_players: team ids and names', byId[s1.id]?.team_id === team.id && byId[s2.id]?.team_id === team.id
    && byId[s3.id]?.team_id === null && byId[s1.id]?.name === 'Ани' && byId[s2.id]?.name === 'Борис',
    JSON.stringify(pl?.map((r) => [r.name, r.team_id])));
  check('world_players: gps_ok', byId[s1.id]?.gps_ok === true && byId[s2.id]?.gps_ok === false && byId[s3.id]?.gps_ok === false);
  check('world_players: joined_at present', !!byId[s1.id]?.joined_at);
  const r1 = await c1.rpc('world_players', { p_world: world.id });
  check("a student can't read world_players (42501, not yours)", code(r1.error) === '42501' && msg(r1.error) === 'not yours', `${code(r1.error)} ${msg(r1.error)}`);
  const ra = await createClient(URL, ANON, { auth: { persistSession: false } }).rpc('world_players', { p_world: world.id });
  check('anon cannot call world_players', !!ra.error, msg(ra.error));

  // ---- world_teams members carry user_id and gps_ok
  const { data: wt, error: wte } = await co.rpc('world_teams', { p_world: world.id });
  check('owner can read world_teams', !wte && wt?.length === 1, msg(wte));
  const mem = wt?.[0]?.members ?? [];
  const m1 = mem.find((m) => m.user_id === s1.id), m2 = mem.find((m) => m.user_id === s2.id);
  check('world_teams members carry user_id', !!m1 && !!m2 && mem.length === 2);
  check('world_teams members carry gps_ok', m1?.gps_ok === true && m2?.gps_ok === false);
  check('world_teams still has name + joined_at', m1?.name === 'Ани' && !!m1?.joined_at);
  check('world_teams still has the old columns', wt?.[0]?.solved == 1 && wt?.[0]?.points == 100 && 'warnings' in (wt?.[0] ?? {}));

  // ---- non-owners cannot kick, ban or unban
  for (const [fn, who, c] of [['moderator_kick', 'student', c1], ['moderator_ban', 'student', c1], ['moderator_unban', 'student', c1],
                              ['moderator_kick', 'stranger', cs], ['moderator_ban', 'stranger', cs]]) {
    const { error } = await c.rpc(fn, { p_world: world.id, p_user: s2.id });
    check(`${who} can't ${fn} (42501)`, code(error) === '42501' && msg(error) === 'not yours to moderate', `${code(error)} ${msg(error)}`);
  }
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const rk = await anon.rpc('moderator_kick', { p_world: world.id, p_user: s2.id });
  check('anon cannot call moderator_kick', !!rk.error, msg(rk.error));
  const [{ n: stillIn }] = await sql(`select count(*)::int n from public.world_members where world_id = $1 and user_id = $2`, [world.id, s2.id]);
  check('failed kicks changed nothing', stillIn === 1);

  // ---- the owner cannot be removed
  for (const fn of ['moderator_kick', 'moderator_ban']) {
    const { error } = await co.rpc(fn, { p_world: world.id, p_user: owner.id });
    check(`owner can't ${fn} themselves (P0001)`, code(error) === 'P0001' && msg(error) === 'the owner cannot be removed', `${code(error)} ${msg(error)}`);
  }
  const [{ n: bans0 }] = await sql(`select count(*)::int n from public.world_bans where world_id = $1`, [world.id]);
  check('refused ban wrote no ban row', bans0 === 0);

  // ---- kick: s2 is out of the team and the trail, the team keeps its answers
  const { error: ke } = await co.rpc('moderator_kick', { p_world: world.id, p_user: s2.id });
  check('owner kicks s2', !ke, msg(ke));
  const [k] = await sql(`select
      (select count(*)::int from public.world_members where world_id = $1 and user_id = $2) wm,
      (select count(*)::int from public.team_members where team_id = $3 and user_id = $2) tm,
      (select count(*)::int from public.marker_progress where team_id = $3) mp,
      (select count(*)::int from public.world_bans where world_id = $1 and user_id = $2) bans`, [world.id, s2.id, team.id]);
  check('kicked: no world_members, no team_members row', k.wm === 0 && k.tm === 0, JSON.stringify(k));
  check('kicked: team keeps its progress; no ban recorded', k.mp === 1 && k.bans === 0);
  const { data: pl2 } = await co.rpc('world_players', { p_world: world.id });
  check('world_players no longer lists the kicked player', pl2?.length === 2 && !pl2.some((r) => r.user_id === s2.id));
  const { error: ke2 } = await co.rpc('moderator_kick', { p_world: world.id, p_user: s2.id });
  check('kicking someone already out is harmless', !ke2, msg(ke2));

  // ---- a kicked student can rejoin: trail by code, team by code
  const { error: rj } = await c2.rpc('join_world', { p_code: world.join_code });
  check('kicked s2 rejoins the trail', !rj, msg(rj));
  const { error: rt } = await c2.rpc('join_team', { p_code: team.invite_code });
  check('kicked s2 rejoins the team', !rt, msg(rt));
  await sql(`update public.team_members set gps_ok = true where team_id = $1 and user_id = $2`, [team.id, s2.id]);

  // ---- ban: out, and every way in is refused with "banned"
  const { error: be } = await co.rpc('moderator_ban', { p_world: world.id, p_user: s2.id });
  check('owner bans s2', !be, msg(be));
  const [b] = await sql(`select
      (select count(*)::int from public.world_members where world_id = $1 and user_id = $2) wm,
      (select count(*)::int from public.team_members where team_id = $3 and user_id = $2) tm,
      (select banned_by from public.world_bans where world_id = $1 and user_id = $2) by`, [world.id, s2.id, team.id]);
  check('banned: removed and recorded', b.wm === 0 && b.tm === 0 && b.by === owner.id, JSON.stringify(b));
  const banned = (r) => code(r.error) === 'P0001' && msg(r.error) === 'banned';
  let r = await c2.rpc('join_world', { p_code: world.join_code });
  check('banned: join_world refused', banned(r), `${code(r.error)} ${msg(r.error)}`);
  r = await c2.rpc('join_team', { p_code: team.invite_code });
  check('banned: join_team refused', banned(r), `${code(r.error)} ${msg(r.error)}`);
  r = await c2.rpc('create_team', { p_world: world.id, p_name: 'Лаб Б' });
  check('banned: create_team refused', banned(r), `${code(r.error)} ${msg(r.error)}`);
  r = await c2.rpc('ensure_team', { p_world: world.id });
  check('banned: ensure_team refused', banned(r), `${code(r.error)} ${msg(r.error)}`);
  // The backstop trigger, directly on both tables (as the superuser connection).
  let tcode = null, tmsg = '';
  try { await sql(`insert into public.world_members (world_id, user_id, role) values ($1, $2, 'viewer')`, [world.id, s2.id]); } catch (e) { tcode = e.code; tmsg = e.message; }
  check('banned: direct insert into world_members refused', tcode === 'P0001' && tmsg === 'banned', `${tcode} ${tmsg}`);
  tcode = null; tmsg = '';
  try { await sql(`insert into public.team_members (team_id, user_id) values ($1, $2)`, [team.id, s2.id]); } catch (e) { tcode = e.code; tmsg = e.message; }
  check('banned: direct insert into team_members refused', tcode === 'P0001' && tmsg === 'banned', `${tcode} ${tmsg}`);
  // join_as_editor: a valid invite link does not get a banned person in.
  await sql(`insert into public.editor_invites (world_id, code, created_by) values ($1, 'ttinvite' || substr(md5(random()::text), 1, 6), $2)`, [world.id, owner.id]);
  const [{ code: invite }] = await sql(`select code from public.editor_invites where world_id = $1`, [world.id]);
  r = await c2.rpc('join_as_editor', { p_code: invite });
  check('banned: join_as_editor refused', banned(r), `${code(r.error)} ${msg(r.error)}`);
  // join_listed: ban s3 on the listed trail before they ever join it.
  const { error: bl } = await co.rpc('moderator_ban', { p_world: listed.id, p_user: s3.id });
  check('owner can ban someone who never joined', !bl, msg(bl));
  r = await c3.rpc('join_listed', { p_world: listed.id });
  check('banned: join_listed refused', banned(r), `${code(r.error)} ${msg(r.error)}`);
  r = await c1.rpc('join_listed', { p_world: listed.id });
  check('someone else can still join_listed', !r.error, msg(r.error));
  // A ban is per trail: s2 and s3 are not banned from each other\'s trails.
  r = await c2.rpc('join_listed', { p_world: listed.id });
  check('ban is per trail: s2 can join the listed trail', !r.error, msg(r.error));
  r = await c3.rpc('join_world', { p_code: world.join_code });
  check('ban is per trail: s3 still in the first trail (join is a no-op)', !r.error, msg(r.error));

  // ---- unban: they can join again
  r = await cs.rpc('moderator_unban', { p_world: world.id, p_user: s2.id });
  check("stranger can't unban", code(r.error) === '42501', `${code(r.error)}`);
  r = await co.rpc('moderator_unban', { p_world: world.id, p_user: s2.id });
  check('owner unbans s2', !r.error, msg(r.error));
  r = await c2.rpc('join_world', { p_code: world.join_code });
  check('unbanned s2 joins the trail again', !r.error, msg(r.error));
  r = await c2.rpc('join_team', { p_code: team.invite_code });
  check('unbanned s2 joins the team again', !r.error, msg(r.error));
  r = await co.rpc('moderator_unban', { p_world: world.id, p_user: s2.id });
  check('unbanning someone not banned is harmless', !r.error, msg(r.error));

  // ---- disqualify: the team is gone from world_leaderboard
  const { data: lb1 } = await co.rpc('world_leaderboard', { p_world: world.id });
  check('team is on the scoreboard before disqualifying', lb1?.some((x) => x.team_id === team.id), JSON.stringify(lb1?.map((x) => x.team_id)));
  const { error: de } = await co.rpc('moderator_disqualify', { p_team: team.id, p_reason: 'Лаб тест' });
  check('owner disqualifies the team', !de, msg(de));
  const { data: lb2 } = await co.rpc('world_leaderboard', { p_world: world.id });
  check('disqualified team is gone from world_leaderboard', Array.isArray(lb2) && !lb2.some((x) => x.team_id === team.id), JSON.stringify(lb2?.map((x) => x.team_id)));
  const { data: lb3 } = await c1.rpc('world_leaderboard', { p_world: world.id });
  check('and gone for a student too', Array.isArray(lb3) && !lb3.some((x) => x.team_id === team.id));
  const { data: wt2 } = await co.rpc('world_teams', { p_world: world.id });
  check('world_teams still lists it, marked disqualified', wt2?.[0]?.disqualified_at && wt2[0].disqualified_reason === 'Лаб тест');
} finally {
  await cleanUsers();
}
done();
