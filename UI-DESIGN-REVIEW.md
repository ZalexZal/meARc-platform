# UI design review — 2 September 2026

> Thirty rendered screens in both themes and both languages, plus a walk through
> the running app on a Samsung A54 (Android 16). Visual companion with before and
> after mock-ups: **https://claude.ai/code/artifact/8630039f-20f2-476d-8180-e76dcb416e48**

Everything here is the design layer. The functional work from the same night — the
first-launch crash, the member-roster leak, the camera permission that never asked,
the trail chip that led nowhere — is fixed, committed and verified separately.
**Nothing on this list is a bug.** It is all judgement and all of it is arguable.

Ordered by return per hour, not by how much they annoy me.

---

## 1. The whole app is set in Liberation Sans — the biggest single win

Every label on every screen uses `LiberationSans SDF`, the Arial clone TextMeshPro
falls back to when nobody picks a typeface. `Assets/TextMesh Pro/Fonts/` contains
that face and nothing else, and `UIFactory.Text` assigns
`TMP_Settings.defaultFontAsset` to every label it makes.

It is not a bad face. It is the **absence of a decision**, and it reads as one on
sight — before anyone reads a word or notices a layout. Nothing else on this list
moves the impression as much per hour spent.

**Cost:** one font asset, one line in `UIFactory`, one rebuild. An afternoon.

**Choosing one.** The app is a map read outdoors, one-handed, often in sun: that
argues for open apertures and a large x-height, and against anything delicate.
Bulgarian Cyrillic is non-negotiable — plenty of otherwise good faces have Cyrillic
that was an afterthought, and *Ямбол* set badly is the first thing a Bulgarian judge
will see.

- **Text:** IBM Plex Sans or Source Sans 3. Both have genuinely designed Cyrillic,
  both are open licence, both hold up at 32px on a phone.
- **Display:** optional. One face used well beats two used carelessly.
- **Avoid:** Inter and Space Grotesk — both fine, both now read as the default
  choice of someone who did not choose.

---

## 2. One teal is doing nine jobs

`#45C4B0` is currently the brand, the primary button, the active tab, the selected
marker, the text caret, the section eyebrow, the distance readout, the progress bar,
**and the correct-answer state**.

The last one is the actual problem. "You got it right" should not be the same signal
as "this is a button". And the palette already separates `StatusGood` / `StatusPoor`
from `Accent`, with a comment in `AppTheme.cs` saying status must never read as
branding — the question screens then use the accent for correct anyway.

**Fix:** honour the distinction that is already written down. Brand teal for identity
and actions; `StatusGood` for right; `StatusPoor` for wrong; the accent off anything
that is merely a number.

**Cost:** half a day.

---

## 3. Browse is the screen that gives the game away

Every other screen has had a pass. This one has not, and it is the second screen a
judge opens. Four problems compound:

- A filled **Back to map** chip in the top-left, heavier than the primary action
  below it — and redundant, because the tab bar is already the way back.
- The title is **right-aligned**. Every other screen in the app is left-aligned.
- Three filter headings — `BY ERA`, `BY KIND`, `CLOSEST TO YOU` — where the pills
  under them only exist at runtime, so the rendered screen shows three orphaned
  labels. Two of those filters were marked vestigial in `PHASE-1.md` and were meant
  to have been removed.
- The list starts below the fold, under about 800px of chrome and void.

**Fix:** the same eyebrow-plus-title as the cards, left-aligned; drop the back chip;
one row of sort pills instead of three headings; the list starting on the first
screenful, because the list *is* the screen.

**Cost:** a day.

---

## 4. Five type steps doing eleven jobs

Display 62 is currently a card title, a screen title and a section title at once.
When one size means three levels the reader has to use position to work out
hierarchy, which is the job the size was supposed to do.

| Step | Now | Proposed |
|---|---|---|
| Display 62 | My trails · Enter a code · Search | Screen titles only |
| Title 48 | Sheet headings | Sheet and card titles |
| Body 42 | Buttons, rows, copy | Buttons and row primaries |
| Secondary 36 | Subtitles, meta, body copy | Reading copy |
| Caption 32 | Meta, notes, eyebrows | Meta and notes |
| **Eyebrow 28** | *borrowed from Caption* | **Its own step, letterspaced** |

One step added, each step given a single job. A pass over `AppUIBuilder` and nothing
else.

**Cost:** half a day.

---

## 5. Empty space that is reserved rather than composed

Three screens hold large voids for content that may never arrive.

- **Question page** reserves ~340px for the verdict bubble. Keep the reservation —
  a verdict that shoves the options down as it appears is worse — but fill it with
  the rule chip and the running score so it is not blank.
- **Video page** shows a 550px black rectangle before anything loads. Black reads as
  broken; a poster frame or the marker's own colour as a wash does not.
- **Browse** ends in ~800px of nothing, which stops being a problem once the list
  starts above the fold.

**Cost:** half a day.

---

## 6. Smaller things, in the order I would do them

- The marker sheet's **grabber implies a drag** that only works downward. Either
  make it draggable to a taller state or remove the affordance.
- **Distances are inconsistent** — `~63 m` in one place, `180 m` in another. One
  rule: approximate under 100, exact above.
- The **nav bar is 190 tall**, which is generous. 160 gives a screenful back on
  shorter phones without crowding anything.
- **Light theme has been rendered but never walked.** The code card looked right;
  the map with inverted tiles has not been seen in daylight on a real screen.
- The **trail chip ellipsises** long names at 600px. Two lines, or a shorter measure
  with the mode chip beneath.
- **Empty and failed states are typographically identical.** A failure should not
  look like an absence.

**Cost:** a day, together.

---

## If you only do one thing

**Change the typeface.** An afternoon including the rebuild, it touches every screen
at once, and it is the only item here that changes the verdict someone forms in the
first two seconds.

Second, the accent split — "correct" and "button" sharing a colour is the one item
that is arguably a correctness problem rather than a taste one. Third, Browse.
