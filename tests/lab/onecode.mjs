// The one code box: a team code leads to its trail, then to the team.
import { check, done, makeUser, cleanUsers, api, createClient, URL, ANON } from './lib.mjs';
try {
  const a = await makeUser('code-a'), b = await makeUser('code-b');
  const ca = await api(a), cb = await api(b);
  const { data: w, error: we } = await ca.rpc('create_world', { p_name: 'Lab one code', p_mode: 'ctf', p_language: 'bg' });
  check('owner makes a trail', !we, we?.message);
  const worldId = typeof w === 'string' ? w : w?.id;
  const { data: row } = await ca.from('worlds').select('join_code').eq('id', worldId).single();
  const { data: t, error: te } = await ca.rpc('create_team', { p_world: worldId, p_name: 'Lab team' });
  check('owner makes a team', !te, te?.message);
  const team = Array.isArray(t) ? t[0] : t;
  const { data: code } = await cb.rpc('lab_trail_code_for_team', { p_code: team.invite_code.toLowerCase() + ' ' });
  check('a team code gives its trail code', code === row.join_code);
  const { data: none } = await cb.rpc('lab_trail_code_for_team', { p_code: 'ZZZZZZ' });
  check('an unknown code gives nothing', none === null);
  const { error: je } = await cb.rpc('join_world', { p_code: code });
  check('then the trail joins', !je, je?.message);
  const { error: jt } = await cb.rpc('join_team', { p_code: team.invite_code });
  check('then the team joins', !jt, jt?.message);
  const { data: det } = await cb.rpc('my_team_detail', { p_world: worldId });
  check('the second walker is on the team', det?.on_team === true && det?.id === team.id);
  const anon = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error: ae } = await anon.rpc('lab_trail_code_for_team', { p_code: team.invite_code });
  check('nobody signed out may ask', !!ae);
} finally { await cleanUsers(); }
done();
