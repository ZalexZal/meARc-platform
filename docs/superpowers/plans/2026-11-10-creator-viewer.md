# Creator or viewer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Every account says whether it creates trails or only walks them; only creators pick a line of work; a live badge (insignia) shows the choice, on sign-up, on a one-time screen every existing user sees on their next visit, and next to their name.

**Architecture:** `profiles.role` (creator | viewer, null = not asked) next to the existing `profiles.work`. `web/src/lib/role.ts` holds the types, labels, badge glyphs and load/save; a `Seal.astro` component draws the badge. A site-wide gate sends any signed-in, non-guest account with `role` null to `/choose-role/` (BG) or `/en/choose-role/`.

**Tech Stack:** Supabase Postgres (migration via `pg` over `~/keys/supabase-db-url.txt`), Astro 7 static site, Playwright lab tests, node strip-types unit tests.

**Spec / design:** Alex approved the canvas https://claude.ai/artifact/QuiqqbMVaekFC6qvAG9a8C (artboards "Website sign-up" and "The insignia set") on 10 Nov 2026. Concept notes: the classification spec `docs/superpowers/specs/2026-11-09-classification-design.md` stays in force; this plan adds one layer on top.

## Global Constraints

- **`role` values:**
  - `creator`, `viewer`.
  - Null means not asked yet.
  - Nobody is back-filled: Alex wants EVERY user to go through the screen once.
- **The work question:**
  - Viewers are never asked for a line of work. A viewer's `work` is left as it is, and only creators' work matters.
  - Creators pick one of the four: `teacher`, `guide`, `broker`, `other`. The labels already exist in `work.ts`.
- **Role is a preference, not a permission.**
  - Viewers can still join any trail with a code, including team trails.
  - Creators can also walk trails.
  - Viewers who want to build are offered "Стани създател" / "Become a creator".
- **Badge (insignia):**
  - A square seal means creator: the job glyph plus a small pencil pip.
  - A round seal with an eye means viewer.
  - Before any choice, the seal is a dashed "?".
  - Selected seal: fill `#0066cc` with a white glyph. Unselected: `#f5f5f7` with an ink glyph.
  - One colour only. Seals differ by shape and glyph.
  - Glyph paths (24 viewBox, stroke):
    - teacher `M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 9v6`
    - guide `M12 21V3M6 5h10l3 2.5L16 10H6zM18 13H8l-3 2.5L8 18h10z`
    - broker `M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5`
    - other `M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z`
    - viewer `M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0.01 0z`
    - pencil `M4 20l4-1 10-10-3-3L5 16zM14 7l3 3`
    - ask `M9 9a3 3 0 1 1 4 2.8c-.7.3-1 .8-1 1.5V14M12 17.5v.01`
- **Copy, BG and EN:**

  | Element | BG | EN |
  |---|---|---|
  | Question | "Как ще използвате меАРк?" | "How will you use meARc?" |
  | Creator card | "Създавам маршрути" / "Строя маршрути за ученици, туристи или клиенти" | "I make trails" / "For students, visitors or clients" |
  | Viewer card | "Разглеждам и вървя" / "Вървя по маршрути — с код или от библиотеката" | "I explore and walk" / "Walk trails with a code or from the library" |
  | Work question (creators only) | "С какво се занимавате?" | "What do you do?" |
  | Viewer note | "Като зрител не ви питаме с какво се занимавате — ще виждате обществената библиотека и ще влизате в маршрути с код. Ако по-късно решите да създавате, ще изберете занимание тогава." | translate the BG |
  | Footer | "Можете да смените избора си по всяко време от Настройки." | "You can change this any time in Settings." |
  | Role names | "Създател" / "Зрител" | "Creator" / "Viewer" |
  | Become a creator | "Стани създател" | "Become a creator" |

  The left panel's titles, bodies and "what you get" lists for each state are exactly the mockup's.

  **Left-panel copy per state.** Each state has a title, a body, and up to three "what you get" bullets.

  - **Nothing chosen**
    - Title: "Как ще използвате меАРк?"
    - Body: "Изберете отдясно. Знакът тук се сменя с избора ви и после стои до името ви."
    - Bullets: none.
  - **Viewer**
    - Title: "Зрител"
    - Body: "Разглеждате обществената библиотека и се включвате в маршрути с код."
    - Bullets: Обществени маршрути наблизо / Влизане с код / Без настройки.
  - **Creator, no work chosen yet**
    - Title: "Създател"
    - Body: "Изберете с какво се занимавате — ще ви показваме само нужното."
    - Bullets: none.
  - **Teacher**
    - Title: "Учител · създател"
    - Body: "Уроци на открито: отбори, въпроси за точки, подсказки и класиране на живо."
    - Bullets: Отбори и класиране / Въпроси за точки и подсказки / По ред или свободно.
  - **Guide**
    - Title: "Екскурзовод · създател"
    - Body: "Разходки с истории: въпроси и подсказки без точки, по ред или свободно."
    - Bullets: Въпроси и подсказки, без точки / По ред или свободно / 3D, снимки, видео и звук.
  - **Broker**
    - Title: "Брокер · създател"
    - Body: "Покажете сградата на мястото ѝ: 3D модел на парцела, без отбори и въпроси."
    - Bullets: 3D модел на място / Модел от снимка с AI / Само нужното — без въпроси.
  - **Other**
    - Title: "Създател"
    - Body: "Всички възможности, без ограничения."
    - Bullets: Всичко от останалите три / Сменяте по всяко време.

  EN: translate each state the same way.
- **Approvals:** Alex approved, on 10 Nov, applying this migration to the live DB and pushing the website.
- **APK:** 0.6.5 is already copied into the site on branch `roles` (commit 0d27765). It goes out with the push.

## Review Focus

1. **An existing creator with `work` already set.** The one-time screen pre-selects "Създавам" and their work, so it takes one click. Owner: R2, test.
2. **A guest (anonymous app session) never sees the screen.** Owner: R2, test.
3. **The gate never loops.** `/choose-role/`, sign-in, sign-up, confirm, terms, privacy, reset and accept-terms are exempt. A failed profile read never redirects. Owner: R2, test.
4. **A viewer who opens /my-trails/ or a builder link** sees "Стани създател", not an empty builder, and is never thrown out of a trail they edit. Owner: R3, test.
5. **Sign-up guest upgrade carries `role`,** as it does `work`. Owner: R2, test.

---

### Task R1: Migration 0070 — profiles.role

**Files:**
- Create: `supabase/migrations/0070_role.sql` and `tests/lab/db-role.mjs`.
- Modify: `tests/lab/lib.mjs` (`makeUser` defaults `role: 'creator'` in meta and sets `profiles.role` the same way it handles work).

**Interfaces:**
- Produces `profiles.role text null check (role in ('creator','viewer'))`.
- The owner can UPDATE it. Add a column grant exactly like `work` has: check `information_schema.column_privileges`.
- `handle_new_user` copies a valid `raw_user_meta_data->>'role'`. Keep everything else byte-identical to the current definition, read live with `pg_get_functiondef`. Put the old body in the header for undo.

- [ ] **Step 1:** Write the failing test.
  - An invalid role → 23514.
  - meta role 'viewer' → `profiles.role = 'viewer'`.
  - Absent → null.
  - The owner can update their own role through the API client.
  - `makeUser` default → 'creator'.
- [ ] **Step 2:** Run it. Expected: FAIL.
- [ ] **Step 3:** Write and apply 0070 in a transaction (live; approved).
- [ ] **Step 4:** Run db-role.mjs, db-classification.mjs and signup-work.mjs. Expected: PASS.
- [ ] **Step 5:** Commit.

### Task R2: Role screen, sign-up, gate

**Files:**
- Create:
  - `web/src/lib/role.ts`: types `Role`; `ROLES`; `GLYPHS`; `roleLabel(role, lang)`; `sealState(role|null, work|null, lang)` returns `{shape:'square'|'round'|'ask', glyph, pip, title, body, gets[]}` from the copy table; `loadRole(client)` returns `Role|null|undefined`, where undefined means the read failed; `saveRole(client, role, work?)` writes both in one update.
  - `web/src/components/Seal.astro`: a server-rendered badge with props shape/glyph/selected/size/pip, plus a tiny client helper in role.ts that repaints a seal element from `sealState`.
  - `web/src/components/ChooseRole.astro`, plus pages `web/src/pages/choose-role.astro` and `web/src/pages/en/choose-role.astro`.
  - Unit test `tests/lab/unit/role.test.ts`.
  - Lab test `tests/lab/choose-role.mjs`.
- Modify:
  - `web/src/components/AuthForm.astro`: the sign-up mode adopts the mockup layout. On wide screens it has the live seal panel on the left and the form on the right; on phones the seal sits on top.
    - The role cards are required.
    - The work grid shows only for creators, and is required for them.
    - Metadata carries `role` and `work`. Viewers send no work.
    - Keep every existing field and check (age, parent, terms).
  - `web/src/lib/supabase.ts`: the guest-upgrade path also writes `role`, the same way it writes `work`.
  - `web/src/lib/session.ts`: add a role gate to `requireUser` next to the terms gate. Also export `roleGate()`, called from the base layout on EVERY page. If the user is signed in, not a guest, and `role` is null, send them to the choose-role page with `?next=`. Exempt pages: choose-role, signin, signup, confirmed, accept-terms, terms, privacy, reset, consent, parent. The site's existing global script entry is the base layout: find it.
  - `web/src/i18n/ui.ts`: the copy above.
- **The choose-role page:**
  - The same panel as sign-up, minus the account fields.
  - Pre-filled from existing `work`: if work is set, mode = creator with that work selected.
  - "Продължи" saves and returns to `next`, or to My trails for creators and /trails for viewers.
  - It replaces the old one-time line-of-work card on My trails. Remove that card: role + work now come from this screen.

- [ ] **Step 1:** Write the failing unit tests for `sealState`. Cover every state's title, glyph, shape and pip.
- [ ] **Step 2:** Write the failing lab tests:
  - a role-null user opening /trails/ lands on /choose-role/?next=…;
  - a work=guide user sees creator + guide pre-selected;
  - choosing viewer saves role=viewer and leaves work untouched;
  - choosing creator + broker saves both;
  - a role-set user is never redirected;
  - a guest is never redirected;
  - the exempt pages never redirect;
  - sign-up as viewer sends role=viewer and no work;
  - sign-up as creator without a work shows `err.work`;
  - the seal changes when a choice is clicked: assert the shape/glyph data attributes;
  - 390 px viewport: no sideways scroll.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Rebuild, then run the new tests plus signup-work, work-settings, create-by-work, builder-work (NO_NET=1), view, overflow and trails-filter. Fix any regression caused by the removed one-time card and by makeUser's role default.
- [ ] **Step 5:** Commit.

### Task R3: Viewer pages and the badge next to your name

**Files:**
- Modify:
  - `web/src/components/MyTrails.astro`: for a viewer, show a "Стани създател" card instead of the create form. It shows the four job seals; picking one saves role=creator + work and reveals the create form without a reload. A viewer's own existing trails, if any, still list normally.
  - `web/src/components/TrailEditor.astro`: a viewer who opens the builder sees a slim notice with the "Стани създател" action at the top. They are never blocked from a trail they own or edit.
  - `web/src/components/Account.astro`, Settings panel: a "Как ползвате меАРк" choice. It reuses the role + work picker from ChooseRole (extract a shared component if needed) and replaces the current standalone line-of-work radios.
  - The account header and site header show the user's small seal next to their name, wherever the name appears today. Find where the header shows the signed-in name.
- Test: `tests/lab/viewer-pages.mjs`.

- [ ] **Step 1:** Write the failing lab test.
  - Viewer on /my-trails/: the "Стани създател" card shows, with no create form.
  - Picking Учител shows the create form with category education, and the DB has role=creator, work=teacher.
  - Viewer on the builder of their own trail: the notice shows and the builder still works.
  - Account settings can switch creator → viewer and back.
  - The header seal shape matches the role.
- [ ] **Step 2:** Implement. Rebuild. Run the new test plus the regressions in R2 Step 4.
- [ ] **Step 3:** Commit.

### Task R4: Release

- [ ] Merge `roles` into main (fast-forward) and push once. Wait for Netlify, then run choose-role.mjs, viewer-pages.mjs, signup-work.mjs and trails-filter.mjs with `LAB_BASE=https://artrails.netlify.app`.
- [ ] Confirm /meARc.apk (old /ARTrail.apk redirects) serves 0.6.5 (Content-Length ≈ 46.7 MB) and that the download section shows 0.6.5.
