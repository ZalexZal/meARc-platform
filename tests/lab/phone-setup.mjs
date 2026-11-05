// Test data for the on-phone test: an owner with a points trail (and a team on
// it) and an Educational trail, stops near the phone, and a walker account to
// sign in with on the phone. Clean up with: node tests/lab/phone-clean.mjs
import { makeUser, api, sql, PW } from './lib.mjs';
const [lat, lng] = (process.argv[2] ?? '42.48643,26.506164').split(',').map(Number);
const at = (dn, de) => [lat + dn / 111320, lng + de / (111320 * Math.cos(lat * Math.PI / 180))];

const owner = await makeUser('phone-owner');
const walker = await makeUser('phone-walker');
const c = await api(owner);

async function trail(name, mode, stops) {
  const { data, error } = await c.rpc('create_world', { p_name: name, p_mode: mode, p_language: 'bg' });
  if (error) throw error;
  const id = typeof data === 'string' ? data : data.id;
  for (const s of stops) {
    const [la, ln] = at(s.n, s.e);
    await sql(`insert into public.markers (world_id, location, style_key, colour_hex, content, status, step, radius_m, created_by)
      values ($1, extensions.st_makepoint($2, $3)::extensions.geography, 'pin', '#0066cc', $4, 'published', $5, 40, $6)`,
      [id, ln, la, JSON.stringify({ bg: { title: s.title, body: 'Лаб тест.' }, en: { title: s.title, body: 'Lab test.' } }), s.step, owner.id]);
  }
  await sql(`update public.worlds set status = 'published', visibility = 'unlisted' where id = $1`, [id]);
  const [{ join_code }] = await sql(`select join_code from public.worlds where id = $1`, [id]);
  return { id, code: join_code.toUpperCase() };
}

// Educational: no order. Stop 3 is the nearest, stop 1 the farthest, so a card
// that still walks in step order says "1 of 3", and a fixed one says "Nearest".
const edu = await trail('Лаб · без точки, свободен ред', 'educational', [
  { title: 'Лаб спирка 1 (далеч)', step: 1, n: 380, e: 0 },
  { title: 'Лаб спирка 2', step: 2, n: 0, e: 220 },
  { title: 'Лаб спирка 3 (близо)', step: 3, n: -60, e: 0 },
]);
const ctf = await trail('Лаб · с точки, по ред', 'ctf', [
  { title: 'Лаб състезание 1', step: 1, n: 120, e: 0 },
  { title: 'Лаб състезание 2', step: 2, n: 0, e: -150 },
]);
const { data: t, error: te } = await c.rpc('create_team', { p_world: ctf.id, p_name: 'Лаб отбор' });
if (te) throw te;
const team = Array.isArray(t) ? t[0] : t;

console.log(JSON.stringify({ walker: walker.email, password: PW, eduCode: edu.code, ctfCode: ctf.code, teamCode: team.invite_code, eduId: edu.id, ctfId: ctf.id, teamId: team.id }, null, 1));
