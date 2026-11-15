# Web lite, captains, event starts and the guest warning

> Design, 30 October 2026, from Alex's answers that day. Item 6 of
> `docs/superpowers/plans/2026-10-29-optimisation-roadmap.md`, plus what it
> needs underneath. Inspiration: YambolTrails (`~/Desktop/YambolTrails/YambolTrails/web`:
> `GameView.tsx`, `docs/gps.md`, `docs/game.md`, `0019_member_leaves.sql`,
> `0025_gps_ready.sql`, `GuestGate.tsx`).

## Why

A walker without the app, or without an ARCore phone, can still walk any trail
on the website: the map, the stops, the questions, the team and the board, with
no camera. It makes the project complete for a judge who will not install an
APK, and it is the way in for people who do not want to download anything.

## Decided (Alex)

- Every kind of trail is playable on the website, scored trails and live events
  included, and scores count the same as in the app.
- A stop is reached by **GPS only**, inside its radius. No QR.
- Anti-cheat on top of the server's checks: a reading worse than **50 m** is
  refused, **two consistent readings** in a row before a stop opens, and answers
  sent from the website are **marked for the organiser**.
- **Captain** (YambolTrails' rules, plus two): the team's creator is its
  captain. The captain giving up ends the game for the whole team; anyone else
  leaving leaves alone. The captain can also **hand the captaincy to a
  teammate** and **remove a player** from the team.
- **Live events have a start**, set to start **automatically at a time** or
  **by hand** with a Start button.
- **A GPS lobby** before the start, as in YambolTrails: the first step after
  making or joining a team is "allow location"; each phone reports whether
  location works (never where it is); teammates see each other's state and the
  organiser sees how many phones are ready, team by team.
- **The security gap is closed**: a stop counts as reached only if the server
  agrees the walker was there.
- **The guest warning**, in the app and on the website: before a guest starts
  walking, "you are playing as a guest" with Create an account, Sign in, or
  Continue as a guest.
- **The finish bonus is paid at the moment the trail is finished**, not when the
  profile is next opened.
- No demo mode for now.

## The parts, in build order

### 1. A stop is reached only where it stands (database; app)

`record_visit` today trusts the phone. With XP on visits, a script could claim
every public stop. It gains the same position check `check_answer` already has
(0045): `record_visit(p_marker, p_via, p_lat, p_lng, p_accuracy, p_mock)`.
Refused: a mock location, accuracy worse than 50 m, a position farther than the
stop's radius + accuracy + 200 m (the camera shows stops up to 500 m away, so a
tap from a little outside the radius stays valid, as it does for answers), and a
jump faster than 60 m/s since the last accepted position. The two-argument
version is dropped, so nothing can go round it. The app sends its position with
every visit (new APK). Until it is installed, the 0.6.3 on the phone records no
visits; walking still works.

### 2. The bonus at the moment of finishing (database)

`record_finish(p_user, p_world)` decides "finished" exactly as `my_profile`
does today (every published stop done; on a scored trail a question settled by
the team; a game needs a team) and inserts `walked_trails`, which already pays
the bonus. It runs after every accepted visit, and for **every member** of a
team whenever its progress changes (an answer, a skip by the organiser), so a
team that finishes together is paid together. `my_profile` keeps calling it as
a safety net.

### 3. Captains, starts and the GPS lobby (database, website, app)

- `teams.captain_id` (filled from `created_by`). `transfer_captain(team, user)`,
  `remove_member(team, user)`; a removed player may join again with the code
  (Alex, 30 October). `leave_team` by the
  captain of a team of more than one asks first: hand over and leave, or give
  up for everyone (`teams.gave_up_at`: answers refused, the board shows it).
- `worlds.start_mode` (`none` / `manual` / `auto`), `starts_at`, `started_at`.
  A trail with a start shows nothing to walkers until it has started: stops are
  not sent and answers and visits are refused. "Started" is `started_at` set by
  the organiser's **Start**, or `now() >= starts_at` for automatic, so no clock
  job is needed. Teams can form and get ready before.
- `team_members.gps_ok`, `gps_checked_at`; `set_gps_ready(team, ok)`; the team
  detail returns each member's state; the board shows the organiser
  "phones ready N / M" and the teams with phones not ready, until the start.
- Website: the start settings in the builder (beside team size), the Start
  button and the readiness panel on the board, the lobby on the team page.
- App: the captain's controls in the team sheet, each member's GPS state, the
  phone reporting its own, and "starts at …" before an event begins (new APK).

### 4. Web lite: `/play?id=…` (website)

- **The way in**: from a trail card ("Walk on the website" beside "Open in the
  app"), a code, or a join link. Joining uses `join_world` / `join_listed`.
- **The guest warning** (part 5) before the first stop.
- **The lobby**: make or join a team (or walk alone where allowed); step 1 is
  location (the YambolTrails `GpsStep`: ask now, or the steps to unblock it for
  this phone's browser); then the code, the members with their GPS state, the
  captain's controls, and on an event the countdown to the start.
- **The game**: a full-screen map (MapLibre with OpenFreeMap, as the builder),
  your position and its accuracy, the stops in the creator's colours, the
  next-stop card with distance and direction, the team's points and place. GPS by
  `watchPosition` (high accuracy), the rules in "Decided" above, a fresh reading
  2.5 s after the first good one, the screen kept awake, tracking paused while
  the page is hidden.
- **A stop** opens by itself inside its circle: its text, photos, audio, video,
  the question (`check_answer` with the position and `p_source = 'web'`), hints
  (`reveal_hint`), the afterword. Results drawn as the app draws them: correct,
  wrong, wait with a countdown, out of order, refused for position, sent for
  review. Where the app would show the camera, "See it standing in the street:
  get the app".
- **Live team sync** as YambolTrails: a teammate's solve appears on the other
  phones without a refresh (Supabase Realtime on the team's progress).
- `marker_submissions.source` (`app` / `web`); the organiser's board shows
  how many of a team's answers came from the website.

### 5. The guest warning (website, app)

YambolTrails' gate, in meARc's terms (a guest's walk is kept on the server
under the guest session, so it is lost with the browser or the phone, not at
once): "You are walking as a guest. Your walk is kept only on this
{phone/browser}; make an account to keep your XP, level and badges anywhere."
Create an account, Sign in, Continue as a guest. Asked once per browser tab
(website) or once per install (app), before the first stop. Scored trails still
need an account, as the database requires.

## Non-goals

- No AR on the website, no QR check-in, no demo mode.
- No change to the app's camera, map or doors beyond what parts 1, 3 and 5 name.

## How it is verified

- Database: each new rule through the public API with throwaway accounts
  (deleted), on the live database, as for 0055 and 0056: visits refused from far
  away, faked, inaccurate or teleported; the bonus paid at the last stop to every
  teammate; captain hand-over, removal and rejoining, giving up; a trail before
  and after its start, automatic and manual; GPS readiness counts.
- Website: Playwright walks a trail on the live database with simulated
  positions (as YambolTrails' `gps.ts`): two phones in one team, a solve seen
  by the other, the lobby, location refused and then allowed, BG and EN, phone
  width, both themes.
- App: compiled, previewed with UIPreview, built as an APK; the phone test is
  Alex's.

## Left to the builder

The exact layout of the lobby and the game within the site's existing style,
the realtime channel names, and the order of work inside each part.
