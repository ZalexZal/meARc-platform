# The website — build prompt

> Written 2026-09-03. Paste the section under **The prompt** into Claude Code in a
> fresh session, in the `web/` project. Everything above it is here so you can
> check I understood the thing before you spend a session on it.
>
> **Read "Assumptions I made" first.** Five of them are guesses. Correcting one
> now is a sentence; correcting it after the build is a rewrite.

---

## What is being built

The public face of AR Trail, plus the account system the app will later sign in
to. Landing page, how it works, the list of games, team registration, a live
leaderboard, and the creator portal that lets someone make a trail without
anybody writing SQL.

Two sites do a version of this already, both without AR:

- [ctf.myedulink.eu](https://ctf.myedulink.eu/igra/eu-code-week) — *Градски
  маршрути Ямбол*. Ten stations across Yambol centre, teams, check in, solve,
  type a code, advance. Live standings. The same city, the same format.
- [burgascyberace.com](https://www.burgascyberace.com/) — city-wide CTF in
  Burgas, nine locations, teams of 1–4, live scoreboard, terminal aesthetic.

**They are the bar for function and the thing to beat on craft.** Both run the
game as *type a code into a web form*. AR Trail's marker stands in the actual
street, anchored to real-world coordinates. That difference is the entire pitch
and it belongs above the fold — not under a countdown timer.

---

## Assumptions I made — correct these

1. **Brand and domain are unknown.** The prompt uses "AR Trail" and no domain.
2. **No deadline is set.** If this is for NOIT and there is a date, say so — it
   changes what gets cut.
3. **Creator accounts are open signup.** Anyone can register and make a trail. If
   creators should be invite-only or approved by you, that is a different flow.
4. **Map tiles are unchosen.** OpenStreetMap's public tiles are not licensed for
   a released product, and this is the *same* decision the app is waiting on.
   Decide once, for both. MapTiler and Protomaps both have workable free tiers.
5. **Transactional email is unconfigured.** Supabase's built-in SMTP is capped at
   a few messages an hour and is explicitly not for production. Real registration
   needs Resend, Postmark or similar before anyone but you signs up.

---

## What already exists

**The app** — Unity 6, AR Foundation, ARCore Geospatial. Android now, iOS later.
Opens on a map, not a camera. Join a trail with a 6-character code. Three modes:
Guided (tourism), CTF (questions, a game), Freefall (no order, nearest unopened).
A marker carries a per-language title and body, a style, a colour, an optional
step order, and whichever pieces the creator chose — video, audio, a question.
Bilingual bg/en, dark and light, tiles cached for offline. Joining, markers, AR
anchoring and the camera are confirmed working on a real phone.

**It has no accounts.** Every install is a fresh anonymous Supabase user, so a
reinstall destroys that person's trails and progress. That is what this website
fixes first.

**The backend** — Supabase: Postgres + PostGIS, Auth, Storage, Realtime. Tables
`worlds`, `world_members`, `markers`, `profiles`, RLS on all of them. Migrations
`0001`–`0004` are applied. Anonymous sign-in is on; the email provider is on.

**Not built yet:** teams, server-side progress and answer checking, the media
bucket, and write policies letting a creator insert a marker.

---

## The rules that are not negotiable

**The `markers_near` seam.** No client — app *or* website — selects from the
`markers` table. Both call `markers_near(world_id, lat, lng, radius)`, a
`SECURITY DEFINER` function. The reason is CTF: if a client reads the table, the
device holds every answer before the player walks anywhere, and no amount of UI
hiding fixes data that is already downloaded. The creator portal is the one
allowed exception — a creator editing their own trail may read their own markers
through policies scoped to `world_role()`.

**`markers_near` returns an empty list for a non-member**, deliberately, so an
error cannot confirm a world exists to someone guessing ids. Anything built on
top must not treat empty as "nothing nearby" without also knowing whether the
caller is a member — this exact ambiguity already cost a full debugging session.

**The `service_role` key never leaves the dashboard.** Not in the site, not in a
build variable, not in a repo, not in chat. The site ships the `anon` key only,
which is public by design. `web/config.local.js` is gitignored and holds the live
values.

**RLS is proven from outside the dashboard.** The SQL editor runs with elevated
privileges and proves nothing about what a client can do. `verify_phase1.sh` is
the existing pattern: curl, the anon key, assert the door is shut. Every new
policy gets a check there, and the check must be capable of failing — a count is
not a check unless it is a count of the right thing.

**Both repos stay private.**

---

## The prompt

Everything below this line is what to paste.

---

You are building the website for **AR Trail**, an augmented-reality city trail
platform. Read this whole brief before writing anything.

### What the product is

Creators build walking trails through a city. Each stop is a **marker** pinned to
real-world coordinates. Players open the phone app, join a trail with a
6-character code, walk to each marker, and see it standing in the actual street
through ARCore Geospatial — then read it, watch it, listen to it, or answer its
question.

Three trail modes: **Guided** (tourism and school trips), **CTF** (questions,
scored, competitive), **Freefall** (no fixed order, nearest unopened stop).

The website is the public face, the account system, the team and scoreboard
surface, and the tool creators use to build trails.

### Stack

- **Astro** with **Tailwind CSS** and **GSAP** (ScrollTrigger) for motion.
- **Supabase JS** for auth and data. Anon key only — never the service_role key.
- **MapLibre GL JS** for maps in the creator portal.
- Static output, deployed to Netlify or Vercel from a private repo.
- Bilingual **Bulgarian and English** from the first commit, via Astro's i18n
  routing (`/bg/...`, `/en/...`). Bulgarian is the default locale.

### Order of work

Build in this order. Each stage must work before the next leans on it.

**A. Database and the doors — no UI in this stage.**

New migrations in `supabase/migrations/`, each idempotent and safe to run twice,
following the voice and structure of `0001`–`0004`:

- `0005_teams.sql` — `teams` (name, world_id, invite code, created_by),
  `team_members` (team_id, user_id, role). A team has 1–4 members and belongs to
  one trail. RLS: a member reads their own team; nobody reads another team's
  roster.
- `0006_progress.sql` — `marker_answers` (never readable by any client),
  `marker_progress` (which team solved which marker, when), and
  `check_answer(marker_id, submitted)` as `SECURITY DEFINER` returning only a
  verdict. The answer never reaches the client, in any form, ever.
- `0007_creator_writes.sql` — insert/update/delete policies on `markers` gated by
  `world_role(world_id) in ('owner','editor')`, and world create/update for
  owners. Today no client can write a marker at all.
- `0008_leaderboard.sql` — a view or RPC returning team, stops solved, and
  elapsed time. It must expose no marker content and no other team's answers.

Then extend `web/verify_phase1.sh` (or add `verify_phase2.sh`) to prove each of
these from outside the dashboard with curl and the anon key: a non-member reads
nothing, a non-owner writes nothing, a team cannot see another team's progress,
and `check_answer` never returns the answer. **Write the check so it is capable
of failing, and show it failing once before you make it pass.**

**B. Site shell and accounts.**

Astro project, design tokens, layouts, i18n routing, and the full auth flow:
sign up, sign in, email confirmation, password reset, sign out, and a profile
page (display name, language). Sessions persist. The app will later sign in to
these same identities, so do not invent a parallel user table — extend
`profiles`.

**C. Public pages.**

Landing, how it works, games list, game detail, FAQ, crew and sponsors, contacts.

**D. Teams and the live leaderboard.**

Create a team, join by invite code, manage the roster, register a team for a
game. Leaderboard updates live over Supabase Realtime.

**E. Creator portal.**

Create a trail; a MapLibre map to click-place, drag and delete markers; a marker
editor with Bulgarian and English title and body, style, colour, step order, and
publish state; the join code; members and roles. Coordinates must also be
pasteable and editable as text — clicking a map is not precise enough for a
marker that has to stand on a specific doorway.

**F. Hand-off to the app.** A short document stating exactly how the app should
sign in and link an email to an existing anonymous identity so a reinstall stops
destroying progress. Do not modify the Unity project.

### Design direction

Do not build the default AI landing page. Specifically avoid: warm cream with a
serif display and terracotta accent; near-black with one acid-green pop; a
purple-to-blue gradient hero; Inter or Space Grotesk as the safe face; emoji as
section markers; everything centered; rounded cards with an accent bar.

The Burgas site already occupies the hacker-terminal look. Do not copy it.

**Draw the visual language from the product's own world: maps and wayfinding.**
Coordinate grids, contour lines, route paths, distance rings, bearings, pins.
The app's own surface is a dark inverted street map with a teal signal accent
(`#45C4B0`), distance rings and a compass radar — the site should feel like the
same object seen from above.

**The scroll should follow a route.** As the visitor scrolls the landing page,
move along a path between stations: the line draws, pins arrive at their stops,
a distance readout counts down, the next stop resolves. Scroll motion that
re-enacts the product's core loop, rather than parallax for its own sake. Use
GSAP ScrollTrigger, pin sparingly, and honour `prefers-reduced-motion` by showing
the finished state instead of the animation.

**Typography must carry Cyrillic.** This is bilingual and most display faces
silently fall back on Bulgarian text, which will look broken to exactly the
audience that matters. Verify every face renders Cyrillic before committing to
it. A pairing that does: **Unbounded** for display, **Onest** or **Golos Text**
for body, **JetBrains Mono** for coordinates, distances and times. Set a type
scale and stay on it.

Typeset both languages in every component. Bulgarian runs longer than English —
if a layout only survives one of them, it is not finished.

### Quality bar

- Real content throughout, in both languages. No lorem, no placeholder names.
- Keyboard focus is always visible. Contrast at least 4.5:1. Touch targets 44px.
- Light and dark both designed, driven by tokens — never a colour whose only
  definition sits inside a media query.
- Wide content scrolls inside its own container; the page body never scrolls
  sideways.
- Errors say what went wrong and how to fix it. Buttons say what happens.
- Images as WebP/AVIF with reserved space, so nothing shifts as it loads.

### How to verify

Do not report a stage complete without showing evidence:

- Migrations: the curl checks above, output pasted, including one deliberate
  failure to prove the check works.
- Auth: sign up, confirm, sign out, sign in, reset — walked end to end against
  the real project, not described.
- Pages: screenshots at 390px and 1440px, in both languages, both themes.
- Motion: confirm the reduced-motion path renders the finished state.

If something is blocked, finish everything else and say plainly what was left and
why.

---

## After this

Once accounts exist here, the app gets sign-in on Welcome and in Settings, and
the ability to attach an email to its current anonymous identity — which is what
finally stops a reinstall from wiping somebody's trails. That is app-side work
and is not part of this build.
