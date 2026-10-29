# Website first pass: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A profile menu, a light theme that changes the map surfaces, a shorter home page and a hero without overlap.

**Architecture:** Astro components and one global stylesheet. Night surfaces become theme-aware through tokens; the hero's canvas town reads a palette that follows `<html data-theme>` and the system scheme.

**Tech Stack:** Astro 7, Tailwind 4, GSAP, TypeScript, Playwright (checks).

**Spec:** `docs/superpowers/specs/2026-10-29-website-first-pass-design.md`

## Global Constraints

- No new dependencies; the Content-Security-Policy is unchanged.
- Dark theme looks exactly as before.
- Reduce-motion stays unread.
- Nothing outside the spec changes (Alex, 29 Oct: "do only the things that are explained and disclosed").
- Both languages: every new string in `i18n/ui.ts` in BG and EN.

## Review Focus

- Theme switched while the home page is open: the town redraws without restarting.
- System dark with no explicit choice: map surfaces stay night.
- A window 1366×650 or 360×640: no text overlaps in the hero.
- Profile menu: Escape and a click outside close it; signed-out visitors never see it.
- English pages (`/en/`): menu items, sign-out return to `/en/`.

---

### Task 1: Profile menu
**Files:** `web/src/components/Header.astro`, `web/src/i18n/ui.ts`
- [ ] The signed-in chip becomes a button (`aria-haspopup="menu"`, `aria-expanded`) opening a menu: Профил → `/account`, Настройки → `/account#settings` (the panel already exists), Моите маршрути → `/my-trails`, Излез → `signOut()` from `lib/supabase.ts`, then `/` or `/en/`.
- [ ] Escape, click outside and choosing an item close it; arrow keys move focus.
- [ ] The phone menu drops its "My trails" link (now in the profile menu); its sign-in link stays (the only one on phones).
- [ ] New keys `nav.settings`, `nav.signout` in both languages.

### Task 2: Hero without overlap
**Files:** `web/src/components/HomeWalk.astro`, cookie notice in `web/src/layouts/Base.astro` / `web/src/styles/global.css`
- [ ] Scroll hint moves into the hero copy under the Android line; hidden below 700 px tall.
- [ ] Cookie notice: compact card bottom-right from 900 px wide; full-width bar below.

### Task 3: Remove two sections
**Files:** `web/src/components/Home.astro`, `Header.astro`, `Footer.astro`, `i18n/ui.ts`
- [ ] Remove `#faq` and `.sec.last` with their strings, and the `nav.faq` link.

### Task 4: A faster walk
**Files:** `web/src/components/HomeWalk.astro`, `web/src/lib/town.ts`, `web/src/components/Home.astro`
- [ ] `.walk` height 4.4 → 2.6 stage heights; story points in `town.ts` rescaled; reveals below shortened.
- [ ] Measure: ≤ 5 screens at 1440×900, ≤ 6 at 390×844.

### Task 5: The daytime map
**Files:** `web/src/styles/global.css`, `web/src/lib/town.ts`, `HomeWalk.astro`, `Home.astro`, `PageBand.astro`, `AuthShell.astro`, `Footer.astro`, `Header.astro`
- [ ] `.night` → `.map` with night tokens under dark and day tokens under light.
- [ ] Hard-coded colours in those files → tokens.
- [ ] `town.ts`: one palette object (`night`, `day`), chosen from the theme, swapped live on theme change.

### Task 6: Verify
- [ ] `npm run build`; `node check.mjs`; screenshots before/after in both themes at 390 and 1440 and the five hero sizes; page heights.
