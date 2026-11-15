# meARc: the optimisation phase, a roadmap

> Written 29 October 2026 with Alex. The base is built (README versions 1–15,
> app 0.6.3 build 23, migrations 0001–0055). This phase makes it a product
> ready for a real launch and for two competitions. Each item below gets its own
> design and plan before it is built; this file is the order and the reasons.

## Why now, and how it is judged

- **John Atanasov competition**: live demo. Date not announced yet (usually end
  of November or early December). Internal target: **polished by 15 November**.
- **НОИТ**: around February 2027. The 2026-27 categories are not out; the
  2025-26 reglament's cards (Приложения 6а–6ж) are the working reference. All
  split **20 general / 25 design / 35 implementation / 20 presentation**.
  The likely card, 6е „Разпределени приложения“, also scores version control and
  automated testing.
- A Play Store listing is not required by either, but helps the picture.

What the cards reward that this phase targets: intuitive navigation, easy
reading, Bulgarian language norms, colour modes and screen sizes, speed,
stability, and "completeness" (a lite way in without installing anything).

## Decided (Alex, 29 October)

| Area | Decision |
|---|---|
| Name and domain | **meARc**. The domain ending is decided when it is bought. |
| Map tiles | Stadia stays during development; **MapTiler** before launch. |
| Email | **Brevo**, a separate account and project. Later. |
| Auto-translate | BG ↔ EN with a **Gemini API key, in a Supabase Edge Function**. |
| From YambolTrails | The builder's ease of use, XP and levels, Google sign-in, the contact form, auto-translate. meARc keeps its own 11 badges. |
| Levels | **50 levels** to begin with, based on **stops reached**. |
| Which stops count | Stops on **public (approved) trails and other people's trails**, never on a trail you own or edit. A stop reached from the map (inside its radius, when the camera can't calibrate) counts the same as one tapped in the camera. Each stop once per person. The practice trail never counts. |
| Finished trails | A finished trail gives **extra XP**, with a **cap** so it can't be farmed. |
| Web lite | A way to **walk trails on the website**, without AR, for people who don't want to install the app, built from YambolTrails' working play screen. |
| Last, because they slow testing | Google sign-in, Brevo emails, the public contact form. |
| Not now | НОИТ documentation in Bulgarian, promo materials, the domain ending. |
| iOS | Planned, for extra credit. Needs a Mac. |

## The order

Quick, visible fixes first: each one ships in a day or less and makes every
later screenshot and demo better. Then the builder, because trails are the
content everything else needs. Then levels, because the web lite shows them.
Then the web lite, the largest piece.

### 1. Profile menu (website)

The profile icon in the header opens a menu: **Profile**, **Settings**,
**Builder / My trails**, **Sign out**. Today the computer header has only an
account chip that links to `/account`, and phones have a separate menu.
One menu for both widths, keyboard and screen-reader ready, closing on a tap
outside and on Escape.

### 2. Light theme (website)

The light theme does not work properly. Known by design: the home page, the
band at the top of every page, the sign-in pages and the footer are drawn
"at night" in both themes (`.night` in `global.css`), and `HomeWalk.astro`,
`Home.astro` and `global.css` hold about 150 hard-coded colours. To do: a list
of what is wrong in light, page by page, at both widths; then every colour from
a token, and a light version of the night surfaces (or a decision to keep them
dark).

### 3. Home page: less scrolling (website)

It takes too long to reach the bottom. The scroll-acted walk (Build, Walk, Find)
alone is 4.4 screens tall (`.walk` in `HomeWalk.astro`), and six sections
follow it. To do: shorten the acted walk, merge or cut sections, and measure the
page's total height before and after at 390 px and 1440 px.

### 4. Builder

- **Ease of use**, taking the best of YambolTrails' studio (`Builder.tsx`):
  compared step by step with our five-step builder.
- **A default stop**, so nobody gets stuck: a new stop starts ready to save
  (pin, the trail's colour, a placeholder title), and the steps that are
  optional say so.
- **"This is missing"**: a live checklist of what a stop and a trail still need
  before they can be saved, published or listed, with a link to the field.
- **Translate**: a button beside each BG/EN field pair, calling the Edge
  Function. Only the trail's owner and editors may use it, since it spends the
  Gemini quota. Model fallback as in YambolTrails (`api/translate/route.ts`).

### 5. XP and levels (database, website, app)

- XP from stops reached on eligible trails (see *Decided*), from the existing
  `stop_visits` record. A finished-trail bonus with a cap.
- 50 levels, each needing a little more XP than the one before. Names that fit
  any city, in both languages.
- Shown on the website (header, account) and in the app (Profile), with
  "Level up" when a walk crosses a boundary.
- The rules live in the database, like everything else that scores.

### 6. Web lite: walk a trail on the website

YambolTrails' play screen, rebuilt on meARc's backend: a full-screen map, the
next stop, check-in by GPS inside the stop's radius, the stop's contents and its
question, the team and the board. No camera. It calls the same functions as the
app (`markers_near`, `marker_detail`, `check_answer`, `record_visit`), so the
rules stay on the server and a stop reached here counts like a map visit.
A clear "Get the app for AR" where the app would show the camera.

### 7. A wider UI/UX pass (website and app)

Bulgarian language norms across both, readability, contrast, touch targets,
the first Camera opening (black for 2–3.5 s), and anything the passes above
turn up.

### 8. Last

Google sign-in (website, then app; a guest keeps their walk), Brevo for the
confirmation and parent emails, the public contact form, MapTiler.

## Alongside, not in the order

- **Two-phone team test** before the John Atanasov demo.
- **Weekly database backup on Kubuntu** (needs `postgresql-client-17`); the
  last backup is from 4 October.
- **Continuous integration**: run the browser checks and the seam test on every
  push, which the cards score.
- **Data controller and a project mailbox**, for the privacy policy.
- **iOS** when a Mac is available.

## Done on 29 October

- Kubuntu is a build machine: keys in `~/keys`, Node 22, the website builds, the
  Unity project imports with no compile errors, and `BuildApk` finds the
  keystore on either system.
- The keys are backed up, encrypted, on Google Drive.
