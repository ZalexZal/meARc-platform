# The website — build prompt

> Written 2026-09-03. Paste the section under **The prompt** into Claude Code in a
> fresh session, in the `web/` project. Everything above it is here so you can
> check I understood the thing before you spend a session on it.
>
> **Read "Assumptions I made" first.** Five of them are still guesses. Correcting one
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
3. **Map tiles are unchosen.** OpenStreetMap's public tiles are not licensed for
   a released product, and this is the *same* decision the app is waiting on.
   Decide once, for both. MapTiler and Protomaps both have workable free tiers.
4. **Transactional email is unconfigured.** Supabase's built-in SMTP is capped at
   a few messages an hour and is explicitly not for production. Real registration
   needs Resend, Postmark or similar before anyone but you signs up.
5. **Signing in over anonymous progress discards it.** If someone played
   anonymously and then signs into an account they already had, the two histories
   are not merged — the account's wins, and the app warns before it happens.
   Merging has no correct answer: two start times, the same marker solved twice,
   two teams. Say so if you want it handled differently.

## Decided

- Accounts are required for **competitive (CTF) trails only**. Guided and
  Freefall stay open to anonymous players, so a tourist or a school group starts
  walking without a signup wall.
- **Teams of 1–4.** A solo player is a team of one, created implicitly, so every
  progress and leaderboard query has one shape instead of two.
- Scoring is **points per marker, set by the creator**.
- Questions can be **exact text, multiple choice, or free text the creator
  reviews** by hand.
- **Any registered user can create trails**, with no approval gate.

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

### Identity, progress and answers

This is the spine of the whole platform. Get it wrong and everything above it
has to be rebuilt, so build it before any page that renders it.

**One account, both clients.** The website and the app are two clients of one
Supabase project and one `auth.users` table. Do **not** create a parallel user
table — extend `profiles` (display name, avatar, locale). The person who
registers on the web and the person who joins a trail on the phone are the same
row, or the system has failed.

**There are no account types.** Nobody is "a creator account" or "a player
account". The same person owns the trail they built and plays somebody else's at
the same time. Capability is per trail, held in `world_members.role`
(`owner` / `editor` / `player`) and read through the existing `world_role()`
function. Any registered user may create a trail. Never gate a feature on a
global flag; gate it on a role in a specific world.

**Anonymous users are real users.** The app signs in anonymously so a first-time
walker is not stopped by a form. Those are ordinary rows in `auth.users` with
`is_anonymous` true, and they can join and play Guided and Freefall trails.

**Upgrading an anonymous user must preserve their id.** When they sign up,
call `supabase.auth.updateUser({ email, password })` on the *existing anonymous
session*. That converts the row in place: same uid, so every team membership,
solved marker and submission stays attached with no data migration. Creating a
new user and copying rows across is the wrong path and must not be built.

Signing into a *different* existing account on a device that already has
anonymous progress does not merge the two. Warn clearly, then keep the account's
history. See assumption 5.

**CTF requires a real account.** A team registering for a competitive trail must
not be anonymous. Enforce that in the database — a policy or a check inside the
join/registration function reading `auth.jwt() ->> 'is_anonymous'` — not in the
UI, which is advice rather than a rule.

**Progress belongs to a team.** A solo player is a team of one, created
implicitly on first play, so there is exactly one shape to query. Record who on
the team solved each stop, so a team can see its own contributions.

**Three tables, three very different privacy rules.**

| Table | Holds | Who may read it |
|---|---|---|
| `marker_answers` | the correct answer, its type, its point value | **nobody.** Only `check_answer` touches it, as `SECURITY DEFINER` |
| `marker_submissions` | every attempt: what was typed, verdict, when | the submitting team, and the owner/editor of that world |
| `marker_progress` | which team solved which stop, when, points awarded | the team, plus the leaderboard's aggregate |

`marker_submissions` is what makes "review answers" possible and is also the
audit trail for a disputed score. It stores wrong attempts too.

**Answer checking.** `check_answer(marker_id, submitted)` returns a verdict and
nothing else — never the expected answer, never a hint, not even by inference
from an error message. Three answer types:

- **exact text** — compared case-insensitively with surrounding whitespace
  stripped; the creator may supply several accepted spellings.
- **multiple choice** — the options are safe to send to the client, the correct
  index is not.
- **free text** — no automatic verdict. The submission is stored as
  `pending_review`, the creator judges it in the portal, and points are awarded
  then.

**Pending review makes the leaderboard provisional.** A team's score can change
after a human decides. Say so on the board, and show creators an unmistakable
count of what is waiting on them. A scoreboard that silently reorders hours later
reads as broken.

**Scoring.** Points live per marker and are set by the creator. A team's rank is
the sum of points awarded, with elapsed time — first solve to last solve — as the
tie-break. The leaderboard must expose no marker content and no other team's
submissions.

**CTF needs a live connection, and that is fine.** Answers are checked on the
server precisely so the phone never holds them, which means a stop cannot be
verified offline. Both reference sites require mobile data for the same reason.
Guided and Freefall keep working offline because nothing needs checking. Say this
plainly in the FAQ rather than letting a player discover it in a dead street.

**Everything a person can see about themselves, they can take and delete.**
Account deletion and data export are features, not paperwork. This platform is
aimed partly at school groups in the EU, so it will hold minors' submissions,
timestamps and implied locations. Display names appear on public leaderboards,
which makes them a moderation surface. Build the export and delete paths in
stage B, while the data model is small.

### Stack
- **Higgsfield**, **Superpowers**, **Playwright**, **Superdesign** and **UI-UX-pro-max**.
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

- `0005_teams.sql` — `teams` (name, world_id, invite code, created_by,
  started_at), `team_members` (team_id, user_id, role). One to four members, one
  trail. A solo player gets a team of one, created implicitly. RLS: a member
  reads their own team; nobody reads another team's roster. Registering a team
  for a **CTF** trail rejects anonymous users, checked in the database.
- `0006_answers.sql` — `marker_answers` (correct answer, type, points; readable
  by **nobody**), `marker_submissions` (every attempt, its verdict, when, by
  whom), and `check_answer(marker_id, submitted)` as `SECURITY DEFINER` returning
  a verdict and nothing else. Supports exact text with several accepted
  spellings, multiple choice, and free text that returns `pending_review`.
- `0007_progress.sql` — `marker_progress` (team, marker, solved_at, points
  awarded, solved_by). Written only through `check_answer` or a creator's review
  verdict, never by a client insert.
- `0008_creator_writes.sql` — insert/update/delete on `markers` and
  `marker_answers` gated by `world_role(world_id) in ('owner','editor')`, world
  create for any authenticated user, world update for owners. Today no client can
  write a marker at all. A creator reads `marker_submissions` for their own world
  and no other.
- `0009_leaderboard.sql` — a view or RPC returning team, points, stops solved,
  elapsed time and a count of submissions still pending review. It must expose no
  marker content, no answers, and no other team's submissions.
- `0010_account_data.sql` — export and delete for one account: everything that
  person can see about themselves, and a delete that leaves no orphaned
  submissions behind.

Then extend `web/verify_phase1.sh` (or add `verify_phase2.sh`) to prove each of
these from outside the dashboard with curl and the anon key: a non-member reads
nothing, a non-owner writes nothing, a team cannot see another team's progress,
and `check_answer` never returns the answer. **Write the check so it is capable
of failing, and show it failing once before you make it pass.**

**B. Site shell and accounts.**

Astro project, design tokens, layouts, i18n routing, and the full auth flow:
sign up, sign in, email confirmation, password reset, sign out, and a profile
page (display name, avatar, language). Sessions persist. The app will later sign
in to these same identities, so do not invent a parallel user table — extend
`profiles`.

Also in this stage, while the data model is still small: **download my data** and
**delete my account**, both wired to the RPCs from `0010`. And the anonymous
upgrade path — signing up from an existing anonymous session must convert that
user in place and keep its id.

**Anything a signed-in person sees about themselves must be shown on the site
too:** which trails they have joined, which they own, their team, their solved
stops and their own submissions with verdicts. If the site cannot show a person
their own history, the app has no server to read it from either.

**C. Public pages.**

Landing, how it works, games list, game detail, FAQ, crew and sponsors, contacts.

**D. Teams and the live leaderboard.**

Create a team, join by invite code, manage the roster, register a team for a
game. Leaderboard updates live over Supabase Realtime.

**E. Creator portal.**

*My trails* — everything this account owns or edits, drafts and published apart,
each with the numbers a creator actually acts on: teams registered, how many
finished, average time, the stop where most teams stall, and submissions waiting
on review.

*The trail editor* — a MapLibre map to click-place, drag and delete markers; a
marker editor with Bulgarian and English title and body, style, colour, step
order and publish state; the trail's mode, points per marker, join code, members
and roles. Coordinates must also be pasteable and editable as text — clicking a
map is not precise enough for a marker that has to stand on a specific doorway.

*The review queue* — free-text submissions awaiting a verdict, each showing the
question, what was typed, and by which team. One decision awards or withholds the
marker's points and updates the board. Reviewing must be fast and keyboard-driven;
a creator with sixty submissions will not click through sixty dialogs.

*That trail's leaderboard* — the creator's own view, with pending review visible
rather than hidden, and an export.

**F. Hand-off to the app.** A short document — not code — stating exactly what
the Unity app must change: sign in and sign up, converting the existing anonymous
user in place, reading progress from the server instead of the local
`DiscoveryTracker`, queueing solves made with no signal, and warning before a
sign-in that abandons anonymous progress. **Do not modify the Unity project.**

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
- **The anonymous upgrade: print the user id before signing up and after, and
  show they are the same.** Then show a solved marker surviving the upgrade.
  This is the single claim most likely to be true in description and false in
  fact.
- **The answer never leaks:** call `check_answer` with a wrong answer and paste
  the entire raw response, headers included. It must contain no trace of the
  expected value, and a wrong answer must not be distinguishable from an unknown
  marker id.
- **A creator cannot read another creator's trail**, and a team cannot read
  another team's submissions — both proved with curl, as two different signed-in
  users, not reasoned about.
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
