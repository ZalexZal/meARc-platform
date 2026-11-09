# Classification: who you are, and what a trail is

9 November 2026. Design only; nothing is built until Alex approves this.

## Why

AR Trail now serves three different jobs (Direction, 6 Nov): teachers,
tour guides and estate brokers. The builder shows everyone everything:
teams, order, questions, hints, standings, start times. A broker placing a
building on a plot sees a school quiz tool; a tour guide wades through
points and teams. Alex's words: "Not every user needs to see all of the
settings and types of trail."

Two classifications fix this:

1. **The person's line of work** decides what the builder offers them.
2. **The trail's category and city** let people find trails: tourism in
   Yambol, real estate near me, and so on.

**Success:** a broker signs up, makes a trail and places a building
without ever seeing the words "team", "points", "question", "hint" or "in
order". A visitor opening the trail list can narrow it to "Tourism ·
Yambol" or "near me" in one or two taps.

## Goals

- Each account has a line of work: **Estate broker · Teacher · Tour guide ·
  Other**. "Other" shows every option.
- It is asked **at sign-up, for everyone** (Alex), on the website and in
  the app, and can be changed in **Settings** (Alex).
- The builder **hides completely** what a line of work doesn't need (Alex),
  rather than tucking it away.
- Every trail has a **category**: **Education · Tourism · Real estate ·
  Other** (Alex), and a **city**, **worked out from its stops** (Alex) and
  correctable by the creator.
- Trail lists (website and app) can be filtered by category and city and
  sorted by distance ("near me", which already exists).

## Non-goals

- Line of work is a **preference, not a permission.** The database keeps
  accepting every kind of trail from everyone; hiding is done in the
  interface. Switching to "Other" brings everything back.
- No verification that someone really is a broker or teacher.
- No change to how a trail is walked in the app, apart from browsing.
- No new trail "modes" in the database; the existing four
  (guide / freefall / educational / ctf) stay.

## Anti-goals (would be a failure even if it works)

- A walker (student, tourist, client) blocked or confused by a "line of
  work" question they can't answer. "Other" must read as a normal choice
  for them.
- A trail made before this change losing its questions, teams or order
  because its owner's line of work now hides them.
- A city that is wrong and can't be fixed, or a list filter that hides
  trails without saying so.

## The line of work

### What each one sees in the builder

| | Estate broker | Teacher | Tour guide | Other |
|---|---|---|---|---|
| "Teams and standings?" when creating | hidden: always no teams | shown | hidden: always no teams (Alex) | shown |
| "In order?" when creating | hidden: always any order | shown | shown (Alex) | shown |
| Question step (with hints) | hidden | shown | shown, without points (Alex) | shown |
| Results tab (standings, review) | hidden | shown when the trail has teams | hidden | as today |
| Settings: team size, start time | hidden | shown when the trail has teams | hidden | as today |
| Settings: one stop at a time | hidden | shown when in order | shown when in order | as today |
| 3D visual tiles | all five; "Generate with AI" and "Insert a 3D model" first *(my call)* | all five | all five | all five |
| Default trail category | Real estate | Education | Tourism | Other |

Tour guides (Alex, 9 Nov): no teams, but questions and hints yes - a quiz
for tourists without points - and the order choice stays. Since their trails
have no teams, the point and hint-cost fields stay hidden, as they already
are on every trail without teams.

The resulting database mode follows from the visible answers, as today:
broker → `educational` (no teams, any order); tour guide → `guide` (in
order) or `educational` (any order); teacher and other → any of the four.

### Beyond the builder: no "teams" or "order" talk for real estate

Alex (9 Nov): for brokers, "no teams, no order" - those words should not
reach them at all. *My reading, to confirm while reviewing:*

- The line "No teams · In order" (`modeLine()` in `web/src/lib/modes.ts`,
  used by My trails, the trail list, the trail page, Review and the builder)
  is **not shown for Real-estate trails**, for anyone; their cards and page
  show the category and city instead ("Недвижими имоти · Ямбол").
- A broker's own pages (My trails, Account) never show standings links,
  team counts or points.
- Other categories keep the mode line, followed by category and city.

### Asking it

- **Website sign-up** (`web/src/components/AuthForm.astro`): a "Your line of
  work" radio group next to the existing age group, the same pattern.
  **Required, nothing pre-selected** *(my call)*; "Other" carries the hint
  "for people who only walk trails, too", so a walker is never stuck.
- **App sign-up** (`AccountSectionView`, `SupabaseAuth`): the same four
  choices, on the same screen as name/email/password.
- **Guests** (anonymous app sessions, `profiles.is_anonymous`) are not asked;
  they cannot build trails.
- **Existing accounts** *(my call)*: asked once, the next time they open My
  trails on the website or sign in in the app; until then they are treated
  as "Other", so nothing disappears unasked.

### Changing it

- Website: Account → Settings, a "Line of work" choice (Account.astro).
- App: Profile → Settings, a row opening the same four choices.
- Changing it applies at once to what the builder shows. Existing trails
  keep everything they have (see "Old trails" below).

### Wording (BG / EN)

Брокер на недвижими имоти / Estate broker · Учител / Teacher · Екскурзовод
/ Tour guide · Друго / Other, with a one-line hint under "Other": "Всички
възможности — и ако само ще вървите по маршрути." / "Every option — and
for people who only walk trails."

## The trail's category and city

### Category

- Set when the trail is created: pre-filled from the creator's line of work
  (table above), changeable on the same form and later in the trail's
  Settings.
- Shown on trail cards and the trail page next to the mode line, as a word
  ("Туризъм"), not a code.
- **Old trails** *(my call)*: back-filled once: a trail with teams →
  Education; everything else → Other. The owner can change it.

### City

- **Which place** *(my call)*: the town or city the stop belongs to
  (Nominatim `city`, else `town`, else the `municipality` seat), never a
  village, suburb or district, so the city list stays short and a plot just
  outside Yambol files under Yambol. Filtering uses a stable key (the
  English name, lower-cased, e.g. `yambol`), not the display text, so a
  correction can't split one city in two; the creator corrects it by picking
  from known cities or typing a new one.
- Worked out when the first stop is placed, and again if every stop has
  moved more than about 5 km from where the city was found: reverse
  geocoding with OpenStreetMap's free Nominatim service (no key;
  one request per trail, well inside its 1-request-per-second rule).
- Stored in **both languages** ("Ямбол" / "Yambol"), asked for with
  `accept-language=bg` and `accept-language=en`.
- The creator can correct it in the trail's Settings ("Град").
- Old trails: back-filled once from their first stop by a one-off script.
- Whether Nominatim is called from the browser (builder) or from an Edge
  Function is left to the builder; the browser needs `nominatim.openstreetmap.org`
  added to the CSP's connect-src.

### Browsing

- **Search** (Alex, 9 Nov): a search box on the website's trail list and in
  the app's trails tab, matching the trail's name and its city, in either
  language, ignoring case and Bulgarian/Latin accents. It combines with the
  filters below.
- **Website trail list** (`TrailList.astro`, /trails): category chips (All ·
  Education · Tourism · Real estate · Other), a city choice listing only
  cities that have public trails, and the existing "Near me" sort. Filters
  combine; the empty state says which filter hid everything and offers to
  clear it.
- **App trail list** (`TrailsDoor`, "Near you"): the same category chips
  above the list; it is already sorted by distance (`trails_near`). The
  city is shown on each row. Needs an app build.

## Data (Supabase)

- `profiles.work text null check (work in ('broker','teacher','guide','other'))`.
  Null = not asked yet (treated as "other"). Written by the sign-up flow
  and by Settings; readable by its owner.
- `worlds.category text not null default 'other' check (category in
  ('education','tourism','estate','other'))`.
- `worlds.city jsonb null` (`{"key": "yambol", "bg": "Ямбол", "en": "Yambol", "lat": 42.48, "lng": 26.50}`: lat/lng = where it was found, for the 5 km rule) and
  `worlds.city_auto boolean default true` (false once the creator edits
  it, so geocoding never overwrites a correction).
- `create_world` takes an optional category; `public_trails`, `trails_near`,
  `my_worlds` and `trail_summary` return category and city.
- One migration, additive and reversible, plus a one-off back-fill script
  (categories, cities).

## Old trails and switching

- A trail's features belong to the trail, not to the person. If a teacher
  becomes "Estate broker", their existing quiz trail keeps its questions and
  teams in the app; in the builder the hidden steps stay hidden, but a line
  says "This trail has questions; switch your line of work to Teacher or
  Other to edit them." *(my call)*
- Editors of someone else's trail see it according to their own line of
  work, with the same line where something is hidden.

## Constraints

- Free services only (Alex): Nominatim, Supabase free, no paid geocoding.
- BG and EN for every new word.
- Website changes go live on push (Netlify); app changes need a new APK,
  then `tools/publish-apk.sh`.
- Competition deadline 29 Nov 2026.

## Left to the builder

- Exact component structure, and whether line-of-work rules live in one
  shared table (suggested: `web/src/lib/work.ts`, one map from line of work
  to visible features, used by MyTrails, TrailEditor and Account).
- Browser vs Edge Function for geocoding; retry and caching.
- Chip and select styling, within the site's existing design.
- Lab tests: a broker sign-up that never meets team/question words; a
  teacher who sees everything; category and city filters on /trails;
  existing trails untouched.
