/**
 * Everything the website writes, read back through the app's own calls.
 *
 * The two halves never speak to each other. A creator sets a colour, a radius,
 * an order, a price on a hint, a rule for a wrong answer - and every one of
 * those reaches the walker only by being written to one table and read out of
 * another. This walks the whole seam: build a trail the way the site builds it,
 * using the same RPCs and the same direct table writes it uses, then read it
 * back the way the app reads it, and check each field arrived.
 *
 * Then the other direction, which is the half that is easy to forget: what the
 * walker sends - a typed answer waiting on review, a report, a team's progress
 * - and whether the site can see it and act on it.
 */
import pg from 'pg';
import { readFileSync } from 'node:fs';

const REF = 'tajbebyhmvppqlswyjiq';
const CONFIG = process.env.ARTRAIL_CONFIG
  ?? new URL('../web/config.local.js', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

let ANON;
try {
  ANON = readFileSync(CONFIG, 'utf8').match(/SUPABASE_ANON_KEY: "([^"]+)"/)[1];
} catch {
  console.error(`Could not read the anon key from ${CONFIG}.`);
  console.error('That file is gitignored because it holds live credentials.');
  console.error('Set ARTRAIL_CONFIG to its path, or run this from a checkout that has one.');
  process.exit(1);
}

if (!process.env.PGPASS) {
  console.error('Set PGPASS to the database password before running this.');
  process.exit(1);
}

const db = new pg.Client({
  host: 'aws-0-eu-central-1.pooler.supabase.com', port: 5432,
  user: `postgres.${REF}`, password: process.env.PGPASS, database: 'postgres',
  ssl: { rejectUnauthorized: false },
});
await db.connect();

// --- the two clients, each speaking exactly as its half of the system does ---
const send = async (method, path, tok, body) => {
  const r = await fetch(`https://${REF}.supabase.co${path}`, {
    method,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${tok ?? ANON}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const t = await r.text();
  let parsed = null;
  try { parsed = t ? JSON.parse(t) : null; } catch { parsed = t; }
  return { status: r.status, body: parsed };
};

const rpc   = (n, tok, b) => send('POST',  `/rest/v1/rpc/${n}`, tok, b ?? {});
const patch = (table, id, tok, b) =>
  send('PATCH', `/rest/v1/${table}?id=eq.${id}`, tok, b);
const insert = (table, tok, b) => send('POST', `/rest/v1/${table}`, tok, b);

let passes = 0, fails = 0;
const ok = (c, m) => { c ? passes++ : fails++; console.log(`  ${c ? 'PASS' : '**FAIL**'}  ${m}`); };
const head = (t) => console.log(`\n${t}`);

const boss = await (await fetch(`https://${REF}.supabase.co/auth/v1/token?grant_type=password`, {
  method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: process.env.ARTRAIL_OWNER ?? 'walker023156@artrail.test',
    password: process.env.ARTRAIL_OWNER_PASSWORD ?? 'trailwalker123',
  }),
})).json();

const OWNER = boss.access_token;

let world = null;
const people = [];

// Distinctive values, so nothing can pass by coincidence.
const COLOUR = '#B5179E';
const RADIUS = 37;
const POINTS = 70;
const DEDUCT = 15;
const HINT1 = 5;
const HINT2 = 25;
const TEAM_SIZE = 6;

try {
  // =====================================================================
  head('THE CREATOR, using the website\'s own calls');

  const made = await rpc('create_world', OWNER, { p_name: 'Шев', p_mode: 'ctf' });
  world = typeof made.body === 'string' ? made.body : made.body?.id ?? made.body;
  ok(!!world, 'create_world made a trail');

  // The editor writes these straight to the row, through row-level security.
  const settings = await patch('worlds', world, OWNER, {
    reveal_one_at_a_time: true, team_size: TEAM_SIZE,
  });
  ok(settings.status < 300, `settings written by the site (${settings.status})`);

  const stops = [];
  for (let i = 1; i <= 3; i++) {
    const m = await rpc('place_marker', OWNER, {
      p_world: world, p_lat: 42.484 + i * 0.0002, p_lng: 26.506,
      p_content: { bg: { title: `Спирка ${i}` } }, p_status: 'draft',
    });
    stops.push(m.body.id);
  }
  ok(stops.every(Boolean), 'three stops placed');

  // The editor's save: content, radius, colour, published - one PATCH.
  for (let i = 0; i < stops.length; i++) {
    await patch('markers', stops[i], OWNER, {
      content: {
        bg: { title: `Спирка ${i + 1}`, body: `Текст ${i + 1}`,
              question: `Въпрос ${i + 1}?`, choices: ['първи', 'втори', 'трети'] },
        en: { title: `Stop ${i + 1}`, body: `Body ${i + 1}`,
              question: `Question ${i + 1}?`, choices: ['first', 'second', 'third'] },
      },
      radius_m: RADIUS,
      colour_hex: COLOUR,
      status: 'published',
    });
  }

  await rpc('reorder_markers', OWNER, { p_world: world, p_ids: stops });

  // Stop 1: a choice with every rule set. Stop 2: free text, for review.
  await rpc('set_marker_answer', OWNER, {
    p_marker: stops[0], p_kind: 'choice', p_correct_choices: [2],
    p_points: POINTS, p_cooldown_seconds: 0,
    p_after_text: { bg: { text: 'Браво' }, en: { text: 'Well done' } },
    p_on_wrong: 'deduct', p_deduct_points: DEDUCT,
  });

  await rpc('set_marker_answer', OWNER, {
    p_marker: stops[1], p_kind: 'free', p_points: POINTS,
  });

  const h1 = await insert('marker_hints', OWNER, {
    marker_id: stops[0], ord: 1, cost: HINT1,
    body: { bg: 'По-стара е от кулата', en: 'Older than the tower' },
  });
  const h2 = await insert('marker_hints', OWNER, {
    marker_id: stops[0], ord: 2, cost: HINT2,
    body: { bg: 'Втората е вярната', en: 'The second one' },
  });
  ok(h1.status < 300 && h2.status < 300,
     `two priced hints written by the site (${h1.status}, ${h2.status})`);

  // On the code rung, which is what the site's publishing ladder calls it.
  await patch('worlds', world, OWNER, { visibility: 'unlisted', status: 'published' });

  const code = (await db.query('select join_code from public.worlds where id=$1', [world]))
    .rows[0].join_code;
  ok(!!code && code.length === 6, `the trail has a six-character code (${code})`);

  // =====================================================================
  head('THE WALKER, using the app\'s own calls');

  // A real account, with an address on it.
  //
  // The anonymous identity the app makes on first run cannot play a scored
  // trail: create_team answers "a competitive trail needs a real account". So
  // every walker on a game is somebody who has signed up properly, and that is
  // the walker this test has to be.
  const signIn = async (anonymous = false) => {
    for (let i = 0; i < 20; i++) {
      const body = anonymous
        ? {}
        : { email: `seam${Date.now()}${Math.random().toString(36).slice(2, 7)}@artrail.test`,
            password: 'seamtest123' };

      const u = await send('POST', '/auth/v1/signup', null, body);
      if (u.status === 200 && u.body?.access_token) return u.body;
      await new Promise((r) => setTimeout(r, 20000));
    }
    return null;
  };

  // First, the thing the app actually does on a first run, and what a game
  // says to it.
  const guest = await signIn(true);
  if (guest) {
    people.push(guest.user.id);
    await rpc('join_world', guest.access_token, { p_code: code });
    const refused = await rpc('create_team', guest.access_token,
      { p_world: world, p_name: 'Анонимен' });
    ok(refused.status === 403,
       `an anonymous walker is refused a team on a game: "${refused.body?.message}"`);
  }

  const me = await signIn();
  if (!me) { console.log('  no identity available - auth budget spent'); process.exit(0); }
  people.push(me.user.id);
  const WALKER = me.access_token;
  ok(true, 'a real account signed up');

  const terms = await rpc('accept_terms', WALKER, { p_version: '2026-09-07' });
  ok(terms.status < 300, `accept_terms went through (${terms.status})`);

  const joined = await rpc('join_world', WALKER, { p_code: code });
  ok(joined.status < 300, `join_world with the site's code (${joined.status})`);

  const summary = await rpc('trail_summary', WALKER, { p_world: world });
  const s = Array.isArray(summary.body) ? summary.body[0] : summary.body;
  ok(s?.mode === 'ctf', `the mode the site set arrives: ${s?.mode}`);
  ok(Number(s?.stop_count) === 3, `stop count arrives: ${s?.stop_count}`);
  console.log(`     trail_summary says needs_account = ${s?.needs_account}`);

  // --- what the map sees --------------------------------------------------
  const near = await rpc('markers_near', WALKER, {
    p_world_id: world, p_lat: 42.4842, p_lng: 26.506, p_radius_m: 5000,
  });

  const seen = near.body ?? [];
  ok(seen.length === 1,
     `reveal-one-at-a-time: only the first stop is sent (${seen.length} of 3)`);

  const first = seen[0];
  ok(first?.colour_hex === COLOUR,
     `the creator's colour arrives: ${first?.colour_hex} (set ${COLOUR})`);
  ok(Number(first?.radius_m) === RADIUS,
     `the arrival radius arrives: ${first?.radius_m} (set ${RADIUS})`);
  ok(Number(first?.step) === 1, `the order arrives: step ${first?.step}`);
  ok(first?.content?.bg?.title === 'Спирка 1',
     `the Bulgarian title arrives: ${first?.content?.bg?.title}`);
  ok(first?.content?.en?.question === 'Question 1?',
     `the English question arrives: ${first?.content?.en?.question}`);
  ok(Array.isArray(first?.content?.bg?.choices) && first.content.bg.choices.length === 3,
     `the choices arrive (${first?.content?.bg?.choices?.length})`);

  // --- what the stop sheet sees -------------------------------------------
  const team = await rpc('create_team', WALKER, { p_world: world, p_name: 'Сам' });
  ok(team.status < 300, `create_team on a scored trail (${team.status})`);

  const detail = await rpc('marker_detail', WALKER, { p_marker: stops[0] });
  const d = detail.body ?? {};

  // marker_detail nests everything about the question under `task`, which is
  // the shape MarkerTask in the app is written against.
  ok(d?.task?.points === POINTS,
     `what the question is worth arrives: ${d?.task?.points} (set ${POINTS})`);
  ok(d?.task?.kind === 'choice', `the kind of question arrives: ${d?.task?.kind}`);
  ok(Array.isArray(d?.task?.options) && d.task.options.length === 3,
     `the options arrive (${d?.task?.options?.length})`);

  const hints = d?.hints ?? [];
  ok(hints.length === 2, `both hints arrive (${hints.length})`);
  ok(hints[0]?.cost === HINT1 && hints[1]?.cost === HINT2,
     `their prices arrive: ${hints.map((h) => h.cost).join(', ')} (set ${HINT1}, ${HINT2})`);
  ok(hints.every((h) => !h.body || Object.keys(h.body).length === 0),
     'and their words do not, until they are paid for');

  const rule = d?.task?.on_wrong;
  const ded = d?.task?.deduct;
  ok(rule === 'deduct', `the wrong-answer rule arrives: ${rule}`);
  ok(Number(ded) === DEDUCT, `and its size: ${ded} (set ${DEDUCT})`);

  // --- answering ----------------------------------------------------------
  const wrong = await rpc('check_answer', WALKER, { p_marker: stops[0], p_submitted: '1' });
  ok(wrong.body?.verdict === 'incorrect', `a wrong choice is judged wrong (${wrong.body?.verdict})`);

  const hint = await rpc('reveal_hint', WALKER, { p_hint: h1.body?.[0]?.id ?? h1.body?.id });
  ok(!!(hint.body?.body?.bg), `paying for a hint returns its words: ${hint.body?.body?.bg ?? '-'}`);

  const right = await rpc('check_answer', WALKER, { p_marker: stops[0], p_submitted: '2' });
  ok(right.body?.verdict === 'correct', `the right choice is judged right (${right.body?.verdict})`);
  ok(!!right.body?.after, 'the creator\'s after-text comes back with it');

  const paid = Number(right.body?.points);
  ok(paid === POINTS - DEDUCT - HINT1,
     `paid ${paid}: ${POINTS} less ${DEDUCT} for the wrong answer and ${HINT1} for the hint`);

  const after = await rpc('markers_near', WALKER, {
    p_world_id: world, p_lat: 42.4842, p_lng: 26.506, p_radius_m: 5000,
  });
  ok((after.body ?? []).length === 2, `the next stop is released (${(after.body ?? []).length} of 3)`);

  // =====================================================================
  head('BACK THE OTHER WAY, what the walker sends');

  const typed = await rpc('check_answer', WALKER,
    { p_marker: stops[1], p_submitted: 'моят отговор' });
  ok(typed.body?.verdict === 'pending_review',
     `a typed answer waits for the creator (${typed.body?.verdict})`);

  const queue = await rpc('review_queue', OWNER, { p_world: world });
  const waiting = (queue.body ?? []).filter((r) => r.submitted === 'моят отговор');
  ok(waiting.length === 1, `the site's review queue shows it (${(queue.body ?? []).length} waiting)`);

  const decided = await rpc('review_answer', OWNER,
    { p_submission: waiting[0]?.submission_id, p_correct: true });
  ok(decided.status < 300, `the creator can accept it (${decided.status})`);

  const mine = await rpc('my_progress', WALKER, { p_world: world });
  ok((mine.body ?? []).length === 2,
     `and the walker's progress shows both stops (${(mine.body ?? []).length})`);

  // Exactly what ReportSheetView sends: a marker and a reason, nothing else.
  const flagged = await rpc('report_marker', WALKER,
    { p_marker: stops[0], p_reason: 'unsafe' });
  ok(flagged.status < 300, `the app can report a stop (${flagged.status})`);

  // Who a report is for.
  //
  // reports_queue is gated on is_admin, so the trail's own creator never sees
  // reports about their own trail - which is the right way round, since a
  // report is often about the person who placed the marker. It goes to the
  // platform reviewer, on the site's Review page.
  const asOwner = await rpc('reports_queue', OWNER, {});
  ok((asOwner.body ?? []).length === 0,
     "the trail's own creator is not shown reports about it");

  const queued = await db.query(
    `select r.id, r.state, r.target_title from public.reports r
      where r.marker_id = $1 and r.state = 'open'`, [stops[0]]);
  ok(queued.rows.length === 1,
     `the report is on record and open for the platform reviewer (${queued.rows.length})`);

  const admins = await db.query('select count(*)::int n from public.platform_admins');
  ok(admins.rows[0].n > 0,
     `and there is somebody who can see it (${admins.rows[0].n} platform admin)`);

  // This test's own report does not survive it.
  await db.query('delete from public.reports where marker_id = $1', [stops[0]]);

  // --- a moderator moves points, and the app is told --------------------
  const teamId = team.body?.id ?? team.body?.team_id;
  await rpc('moderator_adjust', OWNER,
    { p_team: teamId, p_points: 40, p_reason: 'маркерът беше паднал' });

  const card = await rpc('my_team_detail', WALKER, { p_world: world });
  ok((card.body?.adjustments ?? []).length === 1,
     'the app\'s team card sees the moderator\'s adjustment');
  ok(card.body?.adjustments?.[0]?.reason === 'маркерът беше паднал',
     'and the reason the moderator typed');

  const board = await rpc('world_leaderboard', WALKER, { p_world: world });
  const row = (board.body ?? [])[0];
  ok(Number(row?.points) === Number(card.body?.points),
     `the board and the card agree: ${row?.points} and ${card.body?.points}`);

  // --- rotating the code, which is the site's emergency lever -----------
  const rotated = await rpc('rotate_join_code', OWNER, { p_world: world });
  const fresh = (await db.query('select join_code from public.worlds where id=$1', [world]))
    .rows[0].join_code;
  ok(fresh !== code, `rotate_join_code changed it: ${code} to ${fresh}`);

  const stale = await signIn(true);
  if (stale) {
    people.push(stale.user.id);
    const refused = await rpc('join_world', stale.access_token, { p_code: code });
    ok(refused.status >= 300 || refused.body === null || refused.body === false,
       'and the old code no longer works');
  } else {
    console.log('  (skipped the old-code check - no identity available)');
  }
} finally {
  console.log(`\n${passes} passed, ${fails} failed`);
  console.log('cleaning up');
  if (world) await db.query('delete from public.worlds where id=$1', [world]);
  for (const id of people) await db.query('delete from auth.users where id=$1', [id]);
  const left = await db.query("select count(*)::int n from public.worlds where name='Шев'");
  const anon = await db.query('select count(*)::int n from auth.users where is_anonymous');
  console.log(`  stray trails ${left.rows[0].n}, stray identities ${anon.rows[0].n}`);
  await db.end();
}
