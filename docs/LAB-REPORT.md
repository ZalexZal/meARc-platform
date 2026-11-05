# Lab report: the "play in the app, show on the web" experiment

4–5 November 2026. Branch `lab/overnight-2026-11-04` in both repos, as git worktrees in `~/Desktop/ARTrails-lab/`. Nothing pushed; the main checkouts are untouched (same commits, same uncommitted files).

## Status (5 Nov)

**Website: merged to main and live** (commit `634bcda`, deployed on artrails.netlify.app), except the "one code box" wording on How to play, which waits for the app. **App: lab APK built 5 Nov (`AR-Trails/Build/ARTrail.apk`, com.alex.artrail.lab 0.6.4-lab, release-signed); phone test pending.** Live site: viewer suite 41/41.

## What is in it

| # | Change | Where | Verdict |
|---|---|---|---|
| 1 | **The website shows a trail, it no longer plays it.** New `/view?id=` page: plain mode line, stop count, start time of a live event, "Open in the app" and a QR code, a map with the stops a stranger may see (same rules as the app: start time, one-at-a-time), stop titles, and on trails with points a standings list that refreshes itself every 20 s. No question or answer is ever fetched. `/walk` links redirect to `/view`. Web lite (`Walk.astro`, `lib/walk.ts`) deleted. | web | **Push.** It is the vision, and the terms (`LegalPage`) already said "creators on the website, walkers in the app". Web lite contradicted your own terms. |
| 2 | **Modes are two plain answers.** "With points / No points" × "In order / Free order" everywhere: new-trail form (two questions instead of four mode names), builder, review, trail list, trail cards, home page, badges, app chip and trail rows. Database keys unchanged. | web + app | **Push.** |
| 3 | **One word for a stop.** "Спирка/stop" everywhere a person reads; the thing standing in AR is its "знак/sign". Legal pages left alone. | web + app | **Push.** |
| 4 | **Trail settings in one panel.** One-at-a-time, team size, start, finish XP moved out of the header into a folded "Trail settings" panel with a one-line summary and help as visible text (tooltips never show on a phone). Settings a trail cannot use are hidden (team size without points, one-at-a-time without order). | web | **Push.** |
| 5 | **One code box.** The app's "I have a code" takes a trail code *or* a team code. A team code joins its trail, then the team. Needs one new DB function (below). How-to text and app strings updated. | app + DB | **Push after the phone test.** |
| 6 | **Bug fix: Educational trails walked in step order in the app.** Next-stop card, strip and map route treated only "freefall" as unordered. Now they use `TrailService.IsOrdered`, like the server. | app | **Push** (real bug, independent of the rest). |
| 7 | My trails cards: mode line, "Trail page" link once others can see it, Standings button only on trails with points. | web | **Push.** |
| 8 | Codes shown and copied in capitals, as the app's boxes show them (the server ignores case). | web | **Push.** |
| 9 | "How to play" names the app's real buttons ("Влез с код", "Профил", "Докладвай проблем", "Скрий от картата"); it used names that no longer exist. Locked-stop line in the trail graph: "Отваря се след предишната спирка". | web + app | **Push.** |
| 10 | Lab app identity: "AR Trails Lab", `com.alex.artrail.lab`, 0.6.4-lab (24). | app | **Remove** when merging (for side-by-side install only). |

## Database (reversible)

One new function, nothing existing touched: `public.lab_trail_code_for_team(text)`, authenticated only.
- Applied from `noit-platform/supabase/lab/lab_0001_one_code_box.sql`.
- **Undo:** `psql "$(cat ~/keys/supabase-db-url.txt)" -f noit-platform/supabase/lab/lab_revert.sql`
- To keep it: copy it as migration 0062 (drop the `lab_` prefix).

## Tests (all against the live database, throwaway accounts deleted after each run)

| Suite | Result |
|---|---|
| `tests/lab/view.mjs`: viewer, desktop + phone, light + dark | 41/41 |
| `tests/lab/builder.mjs`: two questions, settings panel, cards | 19/19 |
| `tests/lab/onecode.mjs`: team code → trail → team, through the API | 8/8 |
| `tests/lab/overflow.mjs`: no sideways scroll, 6 pages × 2 widths | 12/12 |
| Site-wide `check.mjs` | 317 pass, 45 fail, **identical to main** |
| Unity compile + `UIPreview.CaptureAll` | 0 errors, 112 screenshots |

The 45 site-check failures exist on main too. 37 are the checker counting the clipped background canvases and the home page's swipe row as overflow (`overflow.mjs` shows no page actually scrolls sideways). 8 are `intent://` app links it cannot open.

## Not yet done

- **APK build and on-phone test**, waiting until the laptop is free (about 35 minutes with `BEE_BUILD_THREADS=1`).
- **AR in the Lab app will not localise.** ARCore uses keyless auth, which is tied to the package name. To field-test AR in the Lab app, add an Android OAuth client for `com.alex.artrail.lab` with the release SHA-1 in Google Cloud. Or build the lab with the real package name and accept that it replaces the installed app.
- First-run screens, Group mode and the AI agent were deliberately not built.

## Found along the way (true on main too)

1. **A fresh clone cannot build the app.** The Inter SDF font assets (`Assets/Fonts/Inter/*SDF.asset`) are gitignored, while `TMP Settings.asset` and a material point at them, so text throws NullReferenceExceptions. On main they exist only on this laptop, with the matching changes uncommitted. Either commit them, or document the regeneration step.
2. `ProjectSettings.asset` still holds the Windows keystore path. `BuildApk` overrides it from `~/keys` on either OS, so it is harmless, but it is noise in every diff.
3. The website said trail codes are "lower case" and team codes "upper case". Both are matched case-insensitively and the app shows capitals.
