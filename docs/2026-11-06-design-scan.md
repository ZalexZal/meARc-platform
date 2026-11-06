# Design scan: from a game to a professional tool

6 November 2026. App scanned on the A54 (0.6.4 build, dark and light) and through all 56 generated app screens; website scanned on every page at 1440 px and 390 px, light and dark, signed out and signed in as a creator (64 screenshots, `tests/lab/scan-web.mjs`).

The bar, as set: Apple's own apps and Instagram. Quiet surfaces, one accent, content first, every rule kept, and a small physical response to each touch, never a show.

## What already meets the bar

- **The tab bar.** A lens springs across, follows the finger, ticks the phone per tab. This is the reference for the rest.
- **The press on every control.** It shrinks to 95% and springs back (`TapFeedback`, added to the controls by the UI builder). Haptics are already called from 14 places.
- **Sheets with detents and a drag handle.**
- **Profile's lists.** Grouped iOS-style lists, chevrons, a large title that collapses on scroll.
- **The question screens.** Right, wrong, locked with a countdown ring: clear states with clear colour.
- **Light mode in the app.** Clean and calm.
- **The website's trail page and builder settings panel** (from the lab).

## The app

### A. Make it a tool, not a game (copy and content)

| # | Today | Proposal |
|---|---|---|
| A1 | **11 badges** fill most of Profile ("Flag runner", "Sharp eye", "Summit"…), plus "5 of 11 badges" in the stats. | **Remove badges** from the app and the website account page. The database tables stay (nothing breaks, the data is kept), only the screens go. |
| A2 | Welcome: *"A treasure hunt in your city. Find the stops, answer the questions, beat the other teams."* | One calm line for all three audiences, e.g. *"Places that tell their own story. Walk a city, a lesson or a building that isn't built yet."* "Try it now" stays. |
| A3 | Stop status **"Found"** in green; "Trail complete, well done!" | "Visited" in the secondary text colour; a quiet check mark. Success colour only for a correct answer. |
| A4 | Terms screen is a wall of text with "badges", "beat", and "under You". | Three short points with icons (location, safety, account) plus a link to the full terms; age question below. Same legal content, a third of the reading. |
| A5 | XP and 50 levels ("Walker I") on Profile. | **Your call (question 1).** For a professional tool I'd keep only *trails walked* and *stops visited*. Points and standings stay *inside* a trail with points (a teacher's quiz still needs them). |

### B. Visual quality

| # | Finding | Proposal |
|---|---|---|
| B1 | **Dark mode is a light map under a grey wash**, so it reads as muddy, and the labels lose contrast. | A real dark map style (Stadia has one; MapTiler later too). That's the biggest visual upgrade in dark mode. |
| B2 | **Too many floating layers on the map.** Trail chip + tip card + next-stop card + tab bar cover over half the screen; stop 2 hid behind the tip card; a pin label collided with the locate button. | One bottom sheet that holds the next stop *and* the tip (the tip becomes a line in the card, not a second card). The chip shrinks to a single line. The map gets at least 55% of the screen back. |
| B3 | **The map credit is set as large as body text** and overlaps pins and the locate button. | A small ⓘ in the corner that opens the credits (allowed by Stadia/OSM rules). |
| B4 | **Type feels large and loose next to the map.** Card titles wrap, the tip card's text is bigger than the card's own title, and similar texts use different sizes from screen to screen. | One defined scale used everywhere (e.g. 17 body, 15 secondary, 13 caption, 28 sheet title, 34 large title), measured against iOS on the A54 before changing. |
| B5 | The stop sheet opens full height even with two lines of text; there's no picture. | The sheet sizes to its content (medium detent), with a hero photo across the top when the stop has one, Instagram-style. |
| B6 | "Choose a trail" said three times on the empty map (chip title, chip subtitle, card). | Chip: "No trail". One empty-state card with one button. |
| B7 | The video player shows a grey box until play. | Show the video's first frame, with a play button on it. |
| B8 | The Team screen's member list is plain text ("Alex Scan (you) ★ captain · GPS ✓"), and the moderator note is a red box. | Proper list cells: avatar initials, name, a small GPS dot, captain as a label. Captain actions in a long-press menu. |
| B9 | The Report screen's reasons have no selection indicator. | Radio rows like the question screen. |

### C. Bugs found

| # | Bug |
|---|---|
| C1 | **Camera tab:** the ARCore notice card overlaps the next-stop card, and a stray handle shape shows above it. The notice should be its own sheet. |
| C2 | **Settings → Theme:** the selected pill is narrower than "Like the phone", so the text spills over its edges. |
| C3 | **Camera refused:** the warning text is cut off at the top. |
| C4 | **The account email field** shows only ~34 characters. Check whether long emails are cut or just scroll. |
| C5 | Two leftovers: "under You" on the English terms screen (fixed in code, not yet built) and the Lab app's welcome title still reads "AR Trail". |

### D. Motion: life on each tap, never overdone

One shared spring for everything (the tab bar's), so the whole app moves with one feel:

1. **Sheets** rise with that spring and rubber-band slightly past the top when dragged.
2. **Next stop changes** with the card content sliding across, not swapping in.
3. **Pins** drop in with a tiny bounce when a trail opens, one after another (40 ms apart). The next stop's pin breathes slowly.
4. **The map** glides to the next stop when you finish one ("fly to", 600 ms).
5. **Correct answer:** the check mark draws itself, with a success haptic. **Wrong:** a short horizontal shake of the option, with an error haptic (already partly there).
6. **Numbers that change** (points, distance) roll rather than jump.
7. **Toggles and the segmented control** slide their thumb on the same spring.
8. **Loading:** skeleton rows that shimmer, not spinners.

Everything respects the phone's "reduce motion" setting.

## The website

| # | Finding | Proposal |
|---|---|---|
| W1 | **Game copy on the home page:** *"Градът е игралното поле"* ("The city is the playing field"), *"Играчите отиват там…"* ("The players go there…"), "Създай маршрут". | Rewrite for the three audiences: a short hero line, then three tiles (**Schools · Tourism · Real estate**), each with one sentence and one picture. |
| W2 | **The display font** (heavy, quirky) gives a playful tone at every heading. | A neutral display face (Inter Display / SF Pro feel, tight tracking) for headings. The map visuals keep the character. |
| W3 | **The builder is one very long page.** Below the stop editor come Editors, Review, Standings and Delete, all at once. | Tabs at the top of the trail: **Stops · Sharing · Results · Settings**. Delete moves into Settings. |
| W4 | Builder's "Still missing" box lists *optional* items ("English title — optional"). | Show required items only; optional ones as a quiet hint inside their step. |
| W5 | Builder header: "БЕЗ ТОЧКИ · ПО РЕД САМО АЗ" (mode and visibility run together, no separator). | A separator, or the visibility as a small pill. |
| W6 | Footer and home say "Android app · coming soon to Google Play". | Since we're not publishing: "Android app", with a QR/download for the demo APK. |
| W7 | The cookie card covers content on every page on phones until dismissed. | A slim bar at the bottom edge on phones. |
| W8 | Phone header: menu, theme, language and Sign up crowd one row. | Theme and language move into the menu; the row keeps logo, menu and one button. |
| W9 | Account page: "0 / 11" badges counter, levels. | Follows A1/A5. |
| W10 | To verify: in full-page captures the builder's Back bar sits over the stop form, and the home page sections below the hero show empty. Both may only be capture artefacts (sticky bar, scroll-reveal). | Check by hand before fixing. |

## Questions for Alex

1. **XP and levels:** remove them with the badges (my recommendation for a professional tool), or keep them?
2. **Points, teams and standings** stay for school trails, right? (Quiz-style lessons need them.)
3. **The display font change** on the website: OK to replace the quirky heading font with a neutral one?
