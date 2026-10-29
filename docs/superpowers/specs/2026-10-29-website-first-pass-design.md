# The website's first pass: profile menu, a daytime map, a shorter home page

> Design, 29 October 2026. Items 1–3 of
> `docs/superpowers/plans/2026-10-29-optimisation-roadmap.md`. Website only; the
> app and the database are not touched.

## Why

The website is the first thing a judge or a new creator sees, and three things
make it look unfinished today:

- **The light theme changes nothing on the home page.** The switch works, but
  the home page, the band at the top of every page, the sign-in pages and the
  footer are drawn "at night" in both themes (`.night` in `global.css`), and the
  town in the hero is painted on a canvas with about 40 fixed colours
  (`lib/town.ts`). In light mode the home page is identical to dark; other pages
  turn light only between a dark band and a dark footer.
- **The home page is too long:** 8.8 screens on a computer (1440×900) and 10.4 on
  a phone (390×844), measured 29 October. The scroll-acted walk alone is 4.4
  screens (`.walk` in `HomeWalk.astro`).
- **The hero overlaps itself on shorter windows.** The scroll hint
  ("ПРЕВЪРТИ И ИЗВЪРВИ МАРШРУТА") is pinned to the hero's bottom while the copy
  above it is centred, so at 1536×730 it touches "Приложение за Android · скоро в
  Google Play" and at 1366×650 the two lines sit on top of each other. On a first
  visit the cookie notice also covers it.

And the header has no account menu: on a computer the account chip only links to
`/account`; phones have a separate navigation menu.

## Goals

1. **A profile menu.** The account icon opens a menu with **Profile**,
   **Settings**, **Builder / My trails** and **Sign out**, on every width.
2. **Light means light, everywhere.** In the light theme every "night" surface
   becomes its daytime version: the home page, the page band, the sign-in pages,
   the footer and the header over the map. The town in the hero is drawn **by
   day**: the same streets, pins, lines and pulses on a light ground. Dark stays
   exactly as it is.
3. **A shorter home page**, by removing two sections and speeding up the walk.
4. **No overlap** in the hero at any window size from 360×640 upwards.

## Non-goals

- No change to page structure beyond the two removed sections, and no new
  sections.
- No new dependencies. The Content-Security-Policy stays as it is.
- The reduce-motion setting stays unread (the owner's decision of 5 October:
  the site moves for everyone).
- The builder, levels and web lite are separate designs.

## Anti-goals (a failure even if it "works")

- A light theme that is light only where it was easy: one dark band left over in
  light mode counts as not done.
- A daytime town that is just the night one with inverted colours. The pulses
  and pins must stay readable on a light ground, at WCAG AA for any text.
- A shorter page that cuts the story: Build, Walk and Find all stay, and each
  step's words stay on screen long enough to read.

## The design

### 1. Profile menu (`Header.astro`)

- **Signed in:** the account chip becomes a button with the person's name (or
  initial on phones) that opens a small menu under it:
  1. **Профил / Profile** → `/account`
  2. **Настройки / Settings** → `/account#settings`: the account page's existing
     "you" section (name, email, password, signed-in devices, blocked people,
     your data), given that anchor. Profile lands on the top of the same page
     (what you walked, badges). *(Claude's call: no new settings page. Theme and
     language stay where they are, in the header.)*
  3. **Моите маршрути / My trails** → `/my-trails` (the builder's way in)
  4. **Излез / Sign out**: the same sign-out as the account page's button
     (`data-signout`), then home.
- **Signed out:** unchanged: Вход and Регистрация.
- Behaviour: opens on click or Enter/Space, closes on Escape, on a click outside,
  and on choosing an item. Arrow keys move between items. `aria-expanded` and
  `aria-haspopup="menu"` on the button. The same menu on every width. The phone's
  existing navigation menu stays for the page links and loses its account links,
  so nothing appears twice.
- Looks: a card in the existing card style (`--surface`, `--line`, the site's
  radius); it follows the theme, and over the map it uses the map's surface like
  the header does today.

### 2. The daytime map

**Tokens.** `.night` is renamed **`.map`**: "the surface drawn as the map",
whatever the time of day. It keeps today's night tokens under the dark theme
(explicit `data-theme="dark"`, or system dark with no explicit choice), and gets
a **day** set under light. Every hard-coded colour in `HomeWalk.astro`,
`Home.astro`, `PageBand.astro`, `AuthShell.astro`, `Footer.astro`, `Header.astro`
and the `.night` rules in `global.css` moves to a token. The day palette is the
builder's call, within these limits:

- ground a warm off-white close to the site's light `--ground`; streets and
  blocks in soft greys; parks a pale green; the river a pale blue;
- pins, lines and pulses in the brand blue (`#0066cc` on light, as the app and
  the rest of the site already use), the amber "+10" kept;
- text on the map at AA contrast at least.

**The town canvas (`lib/town.ts`).** All its colours move into one palette
object with a `night` and a `day` version. The town reads the current theme when
it starts and **redraws when the theme changes** (a `MutationObserver` on
`<html data-theme>` plus the `prefers-color-scheme` media query), without
restarting its animation. Glows that only work on a dark ground (additive white
light) become, by day, darker blue pulses and soft shadows. The haze toward the
horizon fades to the day ground, not to black.

**The header over the map** turns light over a day map, as it turns dark over a
night one today.

**Checked:** every page in `web/check.mjs`'s list, in light and dark, at 390 px
and 1440 px: no leftover night surface in light, no light surface in dark.

### 3. A shorter home page

- **Remove** the questions section (`#faq`, "before you set off") and the closing
  card (`.sec.last`, "your town is waiting"), with their now-unused strings in
  `i18n/ui.ts` in both languages. The header's **Въпроси / Questions** link
  pointed at `#faq`, so it goes too (header and footer).
- **Speed up the walk:** `.walk` from 4.4 stage heights to about **2.6**, and the
  points in `town.ts` where Build, Walk and Find start and end rescaled to match,
  so the story plays at about 1.7× the speed for the same scroll. Each step's
  words still stay on screen for at least half a screen of scrolling.
- **Faster reveals** below the walk: the scroll-scrubbed route line in `Home.astro`
  and the sections' entrance animations shortened so a section has finished
  arriving by the time it fills the screen.
- **Target:** at most **5 screens on a computer (1440×900) and 6 on a phone
  (390×844)**, measured the same way as before (`scrollHeight / innerHeight`).

### 4. The hero, without overlap

- The scroll hint leaves its absolute position and joins the hero's copy, under
  the Android line, so the two can never collide. On windows shorter than 700 px
  it is hidden: the hero already fills the screen there and the hint has no room.
- The cookie notice becomes a compact card in the **bottom-right corner** on
  widths of 900 px and up, clear of the hero's copy. On phones it stays a full-width
  bar at the bottom.
- **Checked** at 360×640, 390×844, 1366×650, 1536×730 and 1440×900, both themes,
  with and without the cookie notice.

## How it is verified

- The site builds (`npm run build`), and `web/check.mjs` passes: both languages,
  both themes, 390 px and 1440 px, no sideways scroll, no fallback fonts, no dead
  links, no raw translation keys, no element stuck mid-animation.
- Screenshots of the home page, `/trails`, `/signin` and `/account` in both themes
  at both widths, before and after, for Alex to look at.
- The page height measured before and after.
- The profile menu driven with the keyboard alone, and with a click outside.

## Left to the builder

- The exact day palette, within the limits above.
- How the walk's start and end points are rescaled in `town.ts`.
- The menu's icon and animation, within the site's existing style.
