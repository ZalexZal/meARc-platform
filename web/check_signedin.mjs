/**
 * Walks the signed-in half of the site in a real browser.
 *
 *   PGURL=postgres://... node check_signedin.mjs [baseUrl]
 *
 * The public pages are covered by check.mjs, which needs no account. These ones
 * redirect a stranger to sign in, so this harness makes a confirmed account in
 * the database, seeds it a trail with three stops through the same RPCs the UI
 * uses, drops a real session into localStorage, and then looks at the pages the
 * way a creator would.
 *
 * Every account and trail it makes is deleted at the end.
 */
import { chromium } from 'playwright';
import { Client } from 'pg';
import { readFileSync, mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:4321';
const URL_BASE = 'https://tajbebyhmvppqlswyjiq.supabase.co';
const PROJECT_REF = 'tajbebyhmvppqlswyjiq';

const cfg = readFileSync(new URL('./config.local.js', import.meta.url), 'utf8');
const ANON = cfg.match(/SUPABASE_ANON_KEY: "([^"]+)"/)?.[1];
const PGURL = process.env.PGURL;
if (!ANON || !PGURL) { console.error('need config.local.js and PGURL'); process.exit(2); }

const out = 'shots';
mkdirSync(out, { recursive: true });

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`   pass  ${m}`); };
const bad = (m) => { fail++; console.log(`   FAIL  ${m}`); };
const say = (m) => console.log(`\n-- ${m}`);

const pg = new Client({ connectionString: PGURL, ssl: { rejectUnauthorized: false } });
await pg.connect();

const api = async (path, { token, method = 'POST', body } = {}) => {
  const res = await fetch(`${URL_BASE}${path}`, {
    method,
    headers: { apikey: ANON, Authorization: `Bearer ${token ?? ANON}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  try { return { status: res.status, body: text ? JSON.parse(text) : null, raw: text }; }
  catch { return { status: res.status, body: text, raw: text }; }
};
const rpc = (name, args, token) => api(`/rest/v1/rpc/${name}`, { token, body: args });

const stamp = Date.now();
const made = [];
let browser;

/**
 * A confirmed account, created in the database rather than through signup.
 *
 * Signing up over the API sends a confirmation email and the project's default
 * SMTP allowance is a few an hour, so a harness that made accounts that way
 * stopped working after its second run of the day.
 *
 * The empty strings matter: GoTrue reads those token columns into non-nullable
 * strings, and a NULL in any of them makes every sign-in fail with "Database
 * error querying schema", which names none of them.
 */
async function confirmedAccount(label) {
  const email = `artrail.${label}@mailinator.com`;
  const password = 'Str0ng-Passw0rd-9x';

  const { rows } = await pg.query(
    `insert into auth.users (
       instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
       created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_anonymous,
       confirmation_token, recovery_token, email_change, email_change_token_new,
       email_change_token_current, phone_change, phone_change_token, reauthentication_token
     ) values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
       'authenticated','authenticated',$1,
       extensions.crypt($2, extensions.gen_salt('bf')), now(), now(), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,'{}'::jsonb,false,
       '','','','','','','','') returning id`,
    [email, password]
  );
  const id = rows[0].id;
  made.push(id);

  await pg.query(
    `insert into auth.identities (id, user_id, provider_id, identity_data, provider,
       created_at, updated_at, last_sign_in_at)
     values (gen_random_uuid(), $1::uuid, $2::text,
       jsonb_build_object('sub',$2::text,'email',$3::text,'email_verified',true),
       'email', now(), now(), now())`,
    [id, String(id), email]
  );

  const session = (await api('/auth/v1/token?grant_type=password',
    { body: { email, password } })).body;
  if (!session?.access_token) {
    throw new Error(`could not sign in ${label}: ${JSON.stringify(session).slice(0, 200)}`);
  }

  return { id, email, token: session.access_token, session };
}

let session;
let worldId;

try {
  say('0. a confirmed creator with a seeded trail');

  const creator = await confirmedAccount(`ui.${stamp}`);
  session = creator.session;
  await pg.query(`update public.profiles set display_name = 'UI Check' where id = $1`, [creator.id]);
  ok(`account ${creator.id.slice(0, 8)} signed in`);

  const token = creator.token;
  const world = (await rpc('create_world',
    { p_name: `UI ${stamp}`, p_mode: 'ctf', p_language: 'bg' }, token)).body;
  worldId = world?.id;
  if (!worldId) throw new Error('could not seed a trail');

  const place = async (lat, lng, bg, en, step) =>
    (await rpc('place_marker', {
      p_world: worldId, p_lat: lat, p_lng: lng, p_step: step, p_status: 'published',
      p_content: { bg: { title: bg, body: 'Тестов текст' }, en: { title: en, body: 'Test body' } },
    }, token)).body?.id;

  const m1 = await place(42.4841, 26.5060, 'Безистен', 'Bezisten', 1);
  await place(42.4840, 26.5034, 'ПМГ', 'PMG', 2);
  const m3 = await place(42.4866, 26.5065, 'Часовниковата кула', 'Clock Tower', 3);
  await rpc('set_marker_answer',
    { p_marker: m1, p_kind: 'exact', p_accepted: ['Безистен'], p_points: 10 }, token);
  await rpc('set_marker_answer', { p_marker: m3, p_kind: 'free', p_points: 30 }, token);
  await pg.query("update public.worlds set status='published', visibility='unlisted' where id=$1", [worldId]);

  // A player, a team and one free-text answer, so the review queue and the board
  // have something in them rather than rendering their empty states.
  //
  // A confirmed account, not an anonymous one: this trail is competitive, and
  // the database refuses anonymous users a team on those. Seeding it with an
  // anonymous player made four pages look broken when they were correct.
  const player = await confirmedAccount(`player.${stamp}`);
  await rpc('join_world', { p_code: world.join_code }, player.token);
  await rpc('create_team', { p_world: worldId, p_name: 'Проверка' }, player.token);
  await rpc('check_answer', { p_marker: m1, p_submitted: 'Безистен' }, player.token);
  await rpc('check_answer', { p_marker: m3, p_submitted: 'Мисля, че е кулата.' }, player.token);
  ok(`trail ${world.join_code} seeded: 3 stops, 1 team, 1 answer to review`);

  // ------------------------------------------------------------- the browser
  browser = await chromium.launch();

  const pages = [
    { path: '/account', name: 'account' },
    { path: '/create', name: 'create' },
    { path: `/trail?id=${worldId}`, name: 'editor' },
    { path: `/board?id=${worldId}`, name: 'board' },
    { path: `/en/board?id=${worldId}`, name: 'board-en' },
  ];

  for (const theme of ['dark', 'light']) {
    for (const p of pages) {
      for (const size of [{ w: 390, h: 844, tag: 'phone' }, { w: 1440, h: 900, tag: 'desk' }]) {
        const ctx = await browser.newContext({
          viewport: { width: size.w, height: size.h },
          colorScheme: theme,
          deviceScaleFactor: 2,
        });

        // supabase-js reads its session from this key, so writing it is the same
        // as having signed in through the form.
        await ctx.addInitScript(
          ([key, value]) => { try { localStorage.setItem(key, value); } catch (e) {} },
          [`sb-${PROJECT_REF}-auth-token`, JSON.stringify(session)]
        );

        const page = await ctx.newPage();
        const errors = [];
        // Counted from the network, because the map fails silently: no console
        // error, no failed request, a correctly sized canvas painting the
        // style's background colour. The only honest signal is whether it ever
        // asked for a tile.
        let tileRequests = 0;
        page.on('request', (r) => { if (/tiles\.openfreemap\.org\/planet/.test(r.url())) tileRequests++; });
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('pageerror', (e) => errors.push(String(e)));

        const label = `${p.name} ${size.tag} ${theme}`;
        say(label);

        await page.goto(base + p.path, { waitUntil: 'networkidle' });
        await page.waitForTimeout(p.name === 'editor' ? 3000 : 1600);

        if (new URL(page.url()).pathname.endsWith('/signin')) {
          bad('bounced to sign-in despite a valid session');
          await ctx.close();
          continue;
        }

        await page.screenshot({ path: `${out}/si-${p.name}-${size.tag}-${theme}.png`, fullPage: true });

        // Nothing may still be saying "loading" once the page has settled.
        const stuck = await page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-acct-loading],[data-create-loading],[data-editor-loading],[data-board-loading]'))
            .filter((el) => el.offsetParent !== null).length
        );
        stuck === 0 ? ok('nothing left on a loading state') : bad(`${stuck} element(s) still loading`);

        // No element may reach past the viewport.
        //
        // This replaced "can the page be scrolled sideways", which was the right
        // question until the root started clipping - after that it can never
        // fail, and a check that cannot fail is not evidence. This one found the
        // real answer on the board page: nothing was over the line, and the
        // number came from Chromium counting padding into scrollWidth.
        const past = await page.evaluate(() => {
          const limit = document.documentElement.clientWidth;
          return Array.from(document.querySelectorAll('body *'))
            .filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width > 0 && r.right > limit + 1;
            })
            .slice(0, 3)
            .map((el) => el.tagName.toLowerCase() +
              (typeof el.className === 'string' && el.className
                ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '') +
              ` (right ${Math.round(el.getBoundingClientRect().right)} > ${limit})`);
        });
        past.length === 0
          ? ok('nothing reaches past the viewport')
          : bad(`past the right edge: ${past.join(' ; ')}`);

        // Page-specific: the thing each page exists to show must be on it.
        if (p.name === 'account') {
          const trails = await page.evaluate(() => document.querySelectorAll('[data-trails] li').length);
          trails > 0 ? ok(`${trails} trail(s) listed`) : bad('no trails listed for an account that owns one');
          const emailShown = await page.evaluate(() => document.querySelector('[data-acct-email]')?.textContent?.trim());
          emailShown ? ok(`shows the signed-in address`) : bad('no email shown');
        }

        if (p.name === 'editor') {
          const stops = await page.evaluate(() => document.querySelectorAll('[data-stops] li').length);
          stops === 3 ? ok('three stops in the list') : bad(`expected 3 stops, found ${stops}`);

          const code = await page.evaluate(() => document.querySelector('[data-trail-code]')?.textContent?.trim());
          code ? ok(`join code shown: ${code}`) : bad('no join code shown');

          const review = await page.evaluate(() => document.querySelectorAll('[data-review] li').length);
          review === 1 ? ok('one submission in the review queue') : bad(`expected 1 to review, found ${review}`);

          const boardRows = await page.evaluate(() => document.querySelectorAll('[data-board] tbody tr').length);
          boardRows >= 1 ? ok(`${boardRows} row(s) on the inline board`) : bad('inline board is empty');

          // Presence is not enough. A canvas measured before layout keeps the
          // wrong size and paints a pale sliver in one corner, which passes a
          // "does a canvas exist" check and looks broken to a person.
          const fit = await page.evaluate(() => {
            const box = document.querySelector('[data-map]');
            const canvas = box?.querySelector('canvas');
            if (!box || !canvas) return null;
            const b = box.getBoundingClientRect();
            const c = canvas.getBoundingClientRect();
            return { boxW: Math.round(b.width), boxH: Math.round(b.height),
                     canW: Math.round(c.width), canH: Math.round(c.height) };
          });
          if (!fit) bad('no map canvas - maplibre failed');
          else if (fit.canW < fit.boxW - 2 || fit.canH < fit.boxH - 2)
            bad(`map canvas ${fit.canW}x${fit.canH} does not fill its ${fit.boxW}x${fit.boxH} box`);
          else ok(`map canvas fills its box (${fit.canW}x${fit.canH})`);

          // A sized canvas told us nothing: it filled its box perfectly while
          // the worker was dead and the map had drawn no map at all.
          tileRequests > 0
            ? ok(`map fetched ${tileRequests} tile(s)`)
            : bad('map fetched no tiles - it is drawing an empty background');
        }

        if (p.name.startsWith('board')) {
          const rows = await page.evaluate(() => document.querySelectorAll('[data-board] tbody tr').length);
          rows >= 1 ? ok(`${rows} row(s) on the board`) : bad('board has no rows');

          const provisional = await page.evaluate(() => {
            const el = document.querySelector('[data-board-provisional]');
            return el && !el.classList.contains('hidden');
          });
          provisional ? ok('says the ranking is provisional while an answer waits')
                      : bad('a pending answer is not disclosed on the board');
        }

        const real = errors.filter((e) => !/Failed to load resource/.test(e));
        real.length === 0 ? ok('no console errors') : bad(`console: ${real.slice(0, 2).join(' || ')}`);

        await ctx.close();
      }
    }
  }
} catch (e) {
  bad(`threw: ${e.message}`);
} finally {
  if (browser) await browser.close();
  if (made.length) {
    await pg.query('delete from public.worlds where owner_id = any($1::uuid[])', [made]);
    await pg.query('delete from auth.users where id = any($1::uuid[])', [made]);
    console.log(`\n(cleaned up ${made.length} accounts and their trails)`);
  }
  await pg.end();
}

console.log(`\n${fail === 0 ? 'ALL ' + pass + ' CHECKS PASSED' : fail + ' of ' + (pass + fail) + ' FAILED'}`);
process.exit(fail === 0 ? 0 : 1);
