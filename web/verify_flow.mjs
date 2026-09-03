/**
 * Walks the whole product as two real people and checks what each one can see.
 *
 *   PGURL=postgres://... node verify_flow.mjs
 *
 * The database is used for one thing only: minting confirmed test accounts,
 * because email confirmations are on and nobody is going to click a link in the
 * middle of a test run. Every assertion after that goes over HTTP with the anon
 * key - the same key that ships in the APK - because what matters is what a
 * client can do, and the SQL editor can prove nothing about that.
 *
 * Fixtures are cleaned up at the end, including the users.
 */
import { Client } from 'pg';
import { readFileSync } from 'node:fs';

const URL_BASE = 'https://tajbebyhmvppqlswyjiq.supabase.co';
const cfg = readFileSync(new URL('./config.local.js', import.meta.url), 'utf8');
const ANON = cfg.match(/SUPABASE_ANON_KEY: "([^"]+)"/)?.[1];
if (!ANON) { console.error('no anon key in config.local.js'); process.exit(2); }

const PGURL = process.env.PGURL;
if (!PGURL) { console.error('PGURL not set'); process.exit(2); }

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`   pass  ${m}`); };
const bad = (m) => { fail++; console.log(`   FAIL  ${m}`); };
const say = (m) => console.log(`\n-- ${m}`);

const pg = new Client({ connectionString: PGURL, ssl: { rejectUnauthorized: false } });
await pg.connect();

// ------------------------------------------------------------------- helpers

const api = async (path, { token, method = 'POST', body } = {}) => {
  const res = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token ?? ANON}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, body: json, raw: text };
};

const rpc = (name, args, token) => api(`/rest/v1/rpc/${name}`, { token, body: args });

const stamp = Date.now();
const made = [];

/**
 * A confirmed account, created in the database rather than through signup.
 *
 * Signing up over the API sends a confirmation email, and the project's default
 * SMTP is capped at a few an hour - so a test run that made three accounts spent
 * the whole allowance and the fourth run of the day could not start. Inserting
 * the row sends nothing.
 *
 * bcrypt via pgcrypto, and the identities row as well as the user, because
 * GoTrue's password grant looks for both.
 */
async function account(label) {
  const email = `artrail.${label}.${stamp}@mailinator.com`;
  const password = 'Str0ng-Passw0rd-9x';

  // The empty strings are not decoration. GoTrue reads these token columns into
  // non-nullable Go strings, so a NULL in any of them makes every sign-in fail
  // with "Database error querying schema" - an error that says nothing about
  // the column that caused it.
  const { rows } = await pg.query(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password,
       email_confirmed_at, created_at, updated_at,
       raw_app_meta_data, raw_user_meta_data, is_anonymous,
       confirmation_token, recovery_token, email_change,
       email_change_token_new, email_change_token_current,
       phone_change, phone_change_token, reauthentication_token
     ) values (
       '00000000-0000-0000-0000-000000000000', gen_random_uuid(),
       'authenticated', 'authenticated', $1,
       extensions.crypt($2, extensions.gen_salt('bf')),
       now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false,
       '', '', '', '', '', '', '', ''
     ) returning id`,
    [email, password]
  );
  const id = rows[0].id;
  made.push(id);

  await pg.query(
    `insert into auth.identities
       (id, user_id, provider_id, identity_data, provider,
        created_at, updated_at, last_sign_in_at)
     values (gen_random_uuid(), $1::uuid, $2::text,
             jsonb_build_object('sub', $2::text, 'email', $3::text, 'email_verified', true),
             'email', now(), now(), now())`,
    [id, String(id), email]
  );

  const inRes = await api('/auth/v1/token?grant_type=password', { body: { email, password } });
  const token = inRes.body?.access_token;
  if (!token) throw new Error(`sign-in failed for ${label}: ${inRes.raw.slice(0, 200)}`);

  return { id, email, token };
}

try {
  say('0. two confirmed accounts and one anonymous walker');
  const creator = await account('creator');
  const player = await account('player');
  const stranger = await account('stranger');
  ok(`creator ${creator.id.slice(0, 8)}, player ${player.id.slice(0, 8)}, stranger ${stranger.id.slice(0, 8)}`);

  // ------------------------------------------------------- the creator's side
  say('1. a creator builds a competitive trail');

  const world = await rpc('create_world',
    { p_name: `Verify ${stamp}`, p_mode: 'ctf', p_language: 'bg' }, creator.token);
  const worldId = world.body?.id;
  const joinCode = world.body?.join_code;
  worldId ? ok(`trail created, code ${joinCode}`) : bad(`create_world: ${world.raw.slice(0, 200)}`);
  if (!worldId) throw new Error('cannot continue without a trail');

  // Three markers, one of each answer kind.
  const place = async (lat, lng, title, step) => {
    const r = await rpc('place_marker', {
      p_world: worldId, p_lat: lat, p_lng: lng,
      p_content: { bg: { title, body: 'Тест' }, en: { title, body: 'Test' } },
      p_step: step, p_status: 'published',
    }, creator.token);
    return r.body?.id;
  };

  const mExact = await place(42.4841, 26.5060, 'Безистен', 1);
  const mChoice = await place(42.4840, 26.5034, 'ПМГ', 2);
  const mFree = await place(42.4866, 26.5065, 'Кулата', 3);
  (mExact && mChoice && mFree) ? ok('three markers placed') : bad('place_marker failed');

  const a1 = await rpc('set_marker_answer',
    { p_marker: mExact, p_kind: 'exact', p_accepted: ['Безистен', 'bezisten'], p_points: 10 }, creator.token);
  const a2 = await rpc('set_marker_answer',
    { p_marker: mChoice, p_kind: 'choice', p_correct_choice: 2, p_points: 20 }, creator.token);
  const a3 = await rpc('set_marker_answer',
    { p_marker: mFree, p_kind: 'free', p_points: 30 }, creator.token);
  (a1.status < 300 && a2.status < 300 && a3.status < 300)
    ? ok('answers set: exact 10, choice 20, free 30')
    : bad(`set_marker_answer: ${a1.raw.slice(0,120)} | ${a2.raw.slice(0,120)} | ${a3.raw.slice(0,120)}`);

  await pg.query("update public.worlds set status='published', visibility='unlisted' where id=$1", [worldId]);

  const mine = await rpc('my_worlds', {}, creator.token);
  Array.isArray(mine.body) && mine.body.some((w) => w.id === worldId)
    ? ok('my_worlds lists it')
    : bad(`my_worlds: ${mine.raw.slice(0, 200)}`);

  // -------------------------------------------------------- the player's side
  say('2. a player joins, forms a team, and answers');

  const joined = await rpc('join_world', { p_code: joinCode }, player.token);
  joined.status < 300 ? ok('player joined with the code') : bad(`join_world: ${joined.raw.slice(0,200)}`);

  const team = await rpc('create_team', { p_world: worldId, p_name: 'Проверка' }, player.token);
  const teamId = team.body?.id;
  teamId ? ok(`team created, invite ${team.body.invite_code}`) : bad(`create_team: ${team.raw.slice(0,200)}`);

  const wrong = await rpc('check_answer', { p_marker: mExact, p_submitted: 'нещо друго' }, player.token);
  wrong.body?.verdict === 'incorrect' && wrong.body?.points === 0
    ? ok('a wrong answer scores nothing')
    : bad(`wrong answer: ${wrong.raw.slice(0,200)}`);

  // Case and whitespace are typing, not knowledge.
  const right = await rpc('check_answer', { p_marker: mExact, p_submitted: '  BEZISTEN  ' }, player.token);
  right.body?.verdict === 'correct' && right.body?.points === 10
    ? ok('the right answer scores, case and spaces forgiven')
    : bad(`right answer: ${right.raw.slice(0,200)}`);

  const again = await rpc('check_answer', { p_marker: mExact, p_submitted: 'Безистен' }, player.token);
  const prog = await rpc('my_progress', { p_world: worldId }, player.token);
  const rowsFor = (id) => (Array.isArray(prog.body) ? prog.body.filter((p) => p.marker_id === id) : []);
  rowsFor(mExact).length === 1
    ? ok('answering twice leaves one row and one lot of points')
    : bad(`answered twice, got ${rowsFor(mExact).length} progress rows`);

  const choiceRight = await rpc('check_answer', { p_marker: mChoice, p_submitted: '2' }, player.token);
  choiceRight.body?.verdict === 'correct' && choiceRight.body?.points === 20
    ? ok('multiple choice scores on the right index')
    : bad(`choice: ${choiceRight.raw.slice(0,200)}`);

  const freeSub = await rpc('check_answer', { p_marker: mFree, p_submitted: 'Мисля, че е кулата.' }, player.token);
  freeSub.body?.verdict === 'pending_review' && freeSub.body?.points === 0
    ? ok('free text waits for a human and awards nothing yet')
    : bad(`free text: ${freeSub.raw.slice(0,200)}`);

  // -------------------------------------------------------------- the review
  say('3. the creator reviews the free-text answer');

  const queue = await rpc('review_queue', { p_world: worldId }, creator.token);
  const item = Array.isArray(queue.body) ? queue.body[0] : null;
  item ? ok(`one submission waiting, from team "${item.team_name}"`) : bad(`review_queue: ${queue.raw.slice(0,200)}`);

  if (item) {
    const verdict = await rpc('review_answer',
      { p_submission: item.submission_id, p_correct: true, p_note: 'Приема се.' }, creator.token);
    verdict.body?.points === 30 ? ok('verdict awards the marker\'s points') : bad(`review_answer: ${verdict.raw.slice(0,200)}`);

    // Withdrawing is the half that is easy to forget.
    const undo = await rpc('review_answer',
      { p_submission: item.submission_id, p_correct: false }, creator.token);
    const after = await rpc('my_progress', { p_world: worldId }, player.token);
    const stillThere = Array.isArray(after.body) && after.body.some((p) => p.marker_id === mFree);
    !stillThere ? ok('reversing a verdict takes the points back') : bad('points survived a reversal');

    await rpc('review_answer', { p_submission: item.submission_id, p_correct: true }, creator.token);
  }

  // ------------------------------------------------------------- the board
  say('4. the leaderboard');

  const board = await rpc('world_leaderboard', { p_world: worldId }, player.token);
  const row = Array.isArray(board.body) ? board.body.find((r) => r.team_id === teamId) : null;
  row ? ok(`team ranked ${row.rank} with ${row.points} points, ${row.stops_solved} stops`) : bad(`leaderboard: ${board.raw.slice(0,300)}`);
  row && Number(row.points) === 60 ? ok('points total 10 + 20 + 30 = 60') : bad(`expected 60 points, got ${row && row.points}`);
  !board.raw.match(/submitted|accepted|correct_choice/) ? ok('the board names no answer') : bad('the board leaked an answer');

  // ---------------------------------------------------------- what stays shut
  say('5. what a player and a stranger cannot reach');

  const answers = await api(`/rest/v1/marker_answers?select=marker_id,accepted&limit=10`, { token: player.token, method: 'GET' });
  Array.isArray(answers.body) && answers.body.length === 0
    ? ok('a player on the trail reads zero answer rows')
    : bad(`player read answers: ${answers.raw.slice(0,200)}`);

  const creatorAnswers = await api(`/rest/v1/marker_answers?select=marker_id,accepted&limit=10`, { token: creator.token, method: 'GET' });
  Array.isArray(creatorAnswers.body) && creatorAnswers.body.length === 3
    ? ok('the creator reads their own three, so the editor is not write-only')
    : bad(`creator read ${creatorAnswers.body?.length} answer rows`);

  const strangerMarkers = await rpc('trail_markers', { p_world: worldId }, stranger.token);
  Array.isArray(strangerMarkers.body) && strangerMarkers.body.length === 0
    ? ok('a stranger reads zero markers of a trail they do not own')
    : bad(`stranger read ${strangerMarkers.body?.length} markers`);

  const strangerPlace = await rpc('place_marker',
    { p_world: worldId, p_lat: 42.5, p_lng: 26.5 }, stranger.token);
  /42501|not yours/i.test(strangerPlace.raw)
    ? ok('a stranger cannot place a marker in it')
    : bad(`stranger placed a marker: ${strangerPlace.raw.slice(0,200)}`);

  const strangerSubs = await api(`/rest/v1/marker_submissions?select=submitted&limit=10`, { token: stranger.token, method: 'GET' });
  Array.isArray(strangerSubs.body) && strangerSubs.body.length === 0
    ? ok('a stranger reads nobody\'s submissions')
    : bad(`stranger read ${strangerSubs.body?.length} submissions`);

  const strangerReview = await rpc('review_answer',
    { p_submission: item?.submission_id ?? '00000000-0000-0000-0000-000000000000', p_correct: true }, stranger.token);
  /42501|not yours|no such/i.test(strangerReview.raw)
    ? ok('a stranger cannot review')
    : bad(`stranger reviewed: ${strangerReview.raw.slice(0,200)}`);

  // ------------------------------------------------- the anonymous upgrade
  say('6. an anonymous walker signs up and keeps their progress');

  const anonUp = await api('/auth/v1/signup', { body: {} });
  const anonToken = anonUp.body?.access_token;
  const anonId = anonUp.body?.user?.id;
  anonId ? ok(`anonymous user ${anonId.slice(0, 8)}`) : bad('no anonymous session');

  // A competitive trail must refuse them.
  const anonJoin = await rpc('join_world', { p_code: joinCode }, anonToken);
  const anonTeam = await rpc('create_team', { p_world: worldId, p_name: 'Анонимен' }, anonToken);
  /real account|28000/i.test(anonTeam.raw)
    ? ok('a competitive trail refuses an anonymous team')
    : bad(`anonymous joined a CTF team: ${anonTeam.raw.slice(0,200)}`);

  // So give them a guided trail to make progress on.
  const guided = await rpc('create_world', { p_name: `Guided ${stamp}`, p_mode: 'guide' }, creator.token);
  const gWorld = guided.body?.id;
  const gMarker = await (async () => {
    const r = await rpc('place_marker', {
      p_world: gWorld, p_lat: 42.484, p_lng: 26.506,
      p_content: { bg: { title: 'Спирка' } }, p_status: 'published',
    }, creator.token);
    return r.body?.id;
  })();
  await rpc('set_marker_answer', { p_marker: gMarker, p_kind: 'exact', p_accepted: ['да'], p_points: 5 }, creator.token);
  await pg.query("update public.worlds set status='published', visibility='unlisted' where id=$1", [gWorld]);

  await rpc('join_world', { p_code: guided.body.join_code }, anonToken);
  const anonSolve = await rpc('check_answer', { p_marker: gMarker, p_submitted: 'да' }, anonToken);
  anonSolve.body?.verdict === 'correct'
    ? ok('the anonymous walker solves a stop on a guided trail')
    : bad(`anonymous solve: ${anonSolve.raw.slice(0,200)}`);

  // The claim that matters: same id after signing up, progress still attached.
  const upgradeEmail = `artrail.upgraded.${stamp}@mailinator.com`;
  const upgrade = await api('/auth/v1/user', {
    token: anonToken, method: 'PUT',
    body: { email: upgradeEmail, password: 'Str0ng-Passw0rd-9x' },
  });
  const idAfter = upgrade.body?.id;
  idAfter === anonId
    ? ok(`the id survives the upgrade: ${anonId.slice(0, 8)} -> ${String(idAfter).slice(0, 8)}`)
    : bad(`id changed: ${anonId} -> ${idAfter} | ${upgrade.raw.slice(0,200)}`);

  const afterUpgrade = await rpc('my_progress', { p_world: gWorld }, anonToken);
  Array.isArray(afterUpgrade.body) && afterUpgrade.body.length === 1
    ? ok('the solved stop is still theirs after signing up')
    : bad(`progress after upgrade: ${afterUpgrade.raw.slice(0,200)}`);

  if (anonId) made.push(anonId);

  // ------------------------------------------------------------ my own data
  say('7. export and delete');

  const exported = await rpc('export_my_data', {}, player.token);
  const text = JSON.stringify(exported.body ?? '');
  text.includes('Проверка') ? ok('the export names the team') : bad('the export is missing the team');
  !text.includes(creator.id) ? ok('the export does not name the creator') : bad('the export names another user');

  const cost = await rpc('what_delete_removes', {}, creator.token);
  Array.isArray(cost.body?.trails_owned) && cost.body.trails_owned.length >= 2
    ? ok(`delete would remove ${cost.body.trails_owned.length} trails, said before the button`)
    : bad(`what_delete_removes: ${cost.raw.slice(0,200)}`);
} catch (e) {
  bad(`threw: ${e.message}`);
} finally {
  // Fixtures out. Worlds cascade from the owner, so the users take them along.
  if (made.length) {
    await pg.query('delete from auth.users where id = any($1::uuid[])', [made]);
    console.log(`\n(cleaned up ${made.length} test accounts and everything they owned)`);
  }
  await pg.end();
}

console.log(`\n${fail === 0 ? 'ALL ' + pass + ' CHECKS PASSED' : fail + ' of ' + (pass + fail) + ' FAILED'}`);
process.exit(fail === 0 ? 0 : 1);
