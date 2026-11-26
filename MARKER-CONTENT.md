# What a marker holds

> Written 2026-08-31, after Alex chose the screen treatments and described the
> creator side: uploaded video and audio, questions, a creator-chosen consequence
> for a wrong answer, and game modes — CTF and Freefall to begin with.
>
> This is the design note for that. The screens are the easy half.
>
> **Historical (the August design note).** What was built differs in places:
> there are four modes (`guide`, `educational`, `freefall`, `ctf`), so
> `educational` stayed (0028, which also made order and one-at-a-time reveal
> server rules); every scored game needs a real account (0035); the question is
> of three kinds (exact, choice, free text); media are rows in `marker_media`, not a
> `media` list in the content; and "Phase 2.5" is long finished. The current
> description is the main `README.md`.

## Settled

| Screen | Treatment |
|---|---|
| Welcome, Terms | **Plain.** Read once. The terms are boring on purpose and dressing them up would be worse. |
| My trails, Code entry | **Card**, over a **blurred** map. The reader is on their way in, so showing where they are going is right — and the blur says *not yet*. |
| Inside a marker | **Sheet.** The reader never leaves the map. |

---

## The part that changes the database

**A correct answer must never be sent to the phone.**

`markers_near` returns `content` as jsonb. If the answer sits in that jsonb, then
the answer is in the HTTP response, and anyone who can run a proxy has it before
they have walked anywhere. For a guided tour that would be untidy. For a CTF it is
the whole game, given away.

This is the same principle that already keeps `markers` unreadable and
`markers_near` the only door — extended one step: **the app is told what to ask,
never what the answer is.**

So a marker's task splits in two:

- **`content.task`** — the prompt, the options, how many points, what happens if
  you are wrong. Public. The phone needs all of it to draw the screen.
- **`marker_answers`** — a separate table holding the accepted answer. **No select
  policy at all**, exactly like `markers`. Nothing reads it but one function.

And one new RPC:

```
check_answer(p_marker uuid, p_answer text) returns jsonb
```

`SECURITY DEFINER`. It compares, records the attempt, applies the creator's
wrong-answer rule, and returns only the verdict, the feedback text, and the new
state — solved, locked until a time, points now at, or skipped.

The client never decides whether an answer is right. It asks and is told.

### Open answers need a comparison rule

"XV век", "15 век", "15", "петнадесети" are all the same answer from a person and
four different strings to a computer. The check should trim, fold case, strip
punctuation, and hold a **list** of accepted forms rather than one. The creator
portal should show that list plainly — a creator who cannot see what will be
accepted will write one form and then wonder why everybody fails.

---

## Marker content, extended

```jsonc
{
  "en": { "title": "…", "body": "…", "link": "…" },
  "bg": { "title": "…", "body": "…", "link": "…" },

  "media": [
    { "kind": "video", "path": "worlds/<id>/m/<id>/inside.mp4", "seconds": 134 },
    { "kind": "audio", "path": "worlds/<id>/m/<id>/keeper.m4a", "seconds": 220 }
  ],

  "task": {
    "kind": "choice",              // or "open"
    "prompt":  { "en": "…", "bg": "…" },
    "options": [ { "en": "…", "bg": "…" }, … ],   // choice only
    "points": 10,
    "on_wrong": "retry",           // retry | lock | deduct | skip
    "lock_seconds": 300,           // lock only
    "deduct": 5                    // deduct only
  }
}
```

`media` is a list, not a field, because Alex's description — upload video **and**
audio **and** a question — means one marker can hold several things. That is what
the sheet has to be built for, and it is the difference between a marker being a
page and a marker being a small sequence.

---

## The four wrong-answer rules, and what each one really costs

| Rule | What the reader sees | What it needs behind it |
|---|---|---|
| **Retry** | The bubble stays, the options re-arm. | Nothing. The honest default. |
| **Lock** | "Try again in 4:32", counting down. | A server-held `locked_until`. |
| **Deduct** | Points fall, visibly. | A server-held score. |
| **Skip** | The marker closes and greys out on the map. | A server-held "done, failed". |

Three of the four need a server-side record of what each reader has done. That is
one new table:

```
marker_progress
  world_id, marker_id, user_id   -- primary key
  attempts       int
  solved_at      timestamptz
  locked_until   timestamptz
  points_awarded int
```

### The reinstall problem, which is real

An anonymous identity does not survive a reinstall — that is stated in the terms
and it is honest. It also means **a lockout does not survive a reinstall either.**
Someone locked out for five minutes can reinstall and start clean.

For a guided tour, nobody cares. For a CTF with a leaderboard, it is the whole
scoreboard.

The fix is not clever engineering; it is a rule: **a world in CTF mode requires a
real account.** Email, not anonymous. Anonymous readers can still walk any Guide
or Freefall trail without signing up, which is the behaviour that made anonymous
sign-in worth building. Worth deciding before the portal lets anyone make a CTF.

---

## What a game mode actually changes

A mode is not a skin. It changes three things, and it is worth being explicit
about which, because the app has to branch on them:

| | **Guide** | **Freefall** | **CTF** |
|---|---|---|---|
| Which markers show on the map | all | all | **only unlocked ones** |
| Order | any | any | a chain: solving one reveals the next |
| Score | none | optional | yes, and a leaderboard |
| Identity | anonymous fine | anonymous fine | **real account** |

`worlds.mode` already exists in `0001` with `check (mode in ('guide','educational','ctf'))`.
Two changes needed: add `freefall`, and decide whether `educational` survives — on
this table it is Freefall with questions, and a mode that is another mode with a
flag set is a flag, not a mode.

**CTF hiding markers is the constraint the whole backend was built around.** It is
why `markers_near` exists instead of a table read, and it pays out here: the
function can simply not return a marker the reader has not unlocked. No client
change at all.

---

## Media: the boring numbers that decide this

- A two-minute 720p video is roughly **20–40 MB**.
- Supabase's free tier is **1 GB stored, 5 GB egress a month**.
- Ten markers with video is ~300 MB stored — fine. Fifty readers watching all ten
  is **15 GB of egress**, which is three times the allowance.

So: **audio wherever audio will do.** A two-minute recording is about 2 MB —
twenty times cheaper — and for a keeper's account or a story, it is also better
than a video of somebody talking. Video should be the exception, and the portal
should say the size next to the upload.

Three more things that follow from being outdoors:

- **Never autoplay.** Sound starting by itself in a street is startling, and it
  spends someone's data without asking.
- **Warn once on mobile data**, then remember the answer.
- **Media does not cache offline.** Marker text does — it is already written to
  disk — but a 30 MB video is not something to quietly keep. A trail walked with
  no signal shows its text and says the video needs a connection.
- **Stop the camera feed while a video plays.** The blit is already switched off
  when the reader leaves the camera tab; playing video over a live AR session is
  paying for two cameras to show one picture.

---

## What this adds to the roadmap

Nothing here changes Phase 1. It lands between Phase 1 and the portal:

1. **Phase 1** — accounts, membership, RLS. Written, not yet applied.
2. **Phase 2** — the app. Screens chosen; onboarding and marker content to build.
3. **New: Phase 2.5 — tasks.** `marker_answers`, `marker_progress`,
   `check_answer`, the media bucket, and the sheet that plays and asks.
4. **Phase 3** — the creator portal, which is where all of this gets authored.

Phase 2.5 exists because the portal cannot author a thing the app cannot show,
and the app cannot show a thing the database will not hold. The order is forced.

---

## Settled while building it, 2026-09-01

- **Both media kinds play through `VideoPlayer`.** An `AudioSource` with
  `UnityWebRequestMultimedia` wants the whole file in memory and understands
  three formats; `VideoPlayer` streams and uses the platform's own media stack.
  The portal can accept what a phone records rather than what Unity decodes.
- **`media` and `task` are not localised into `en`/`bg` blocks.** A video is one
  file whatever language the reader has chosen, and the question carries its own
  per-language prompt inside itself.
- **The trails list shows role and mode, not a marker count.** A count cannot be
  had without an RPC written to leak one — `markers` has no select policy. This
  is the first place the security model has cost a piece of UI, and the trade is
  the right way round.
- **A rejected option stays rejected.** It keeps its cross and stays unpressable
  for the rest of the visit, so a second attempt cannot spend a second deduction
  on an answer already known to be wrong.
- **A creator's rule is announced before the first attempt.** Somebody about to
  lose five points for a guess is entitled to know that beforehand.

## Open questions

1. **Does `educational` stay a mode, or become a flag on Freefall?**
2. **Does CTF require a real account?** Recommended yes — see the reinstall
   problem. It is a one-line rule now and a rewrite later.
3. **Is a CTF a chain or a set?** Solving one marker revealing exactly one next
   marker is a very different world from all markers being open and scored.
