# What the app has to change

> Written 2026-09-03, after migrations `0005`–`0013` were applied and the website
> was built against them. **This is a specification, not a patch.** No Unity file
> was touched.
>
> Everything below is verified working over HTTP with the anon key — the same key
> that ships inside the APK — by `web/verify_flow.mjs` and `web/verify_phase2.sh`.
> Where something is not verified, it says so.

---

## The short version

Four changes, in this order:

1. **Sign in and sign up**, converting the existing anonymous user in place.
2. **Read progress from the server** instead of the local `DiscoveryTracker`.
3. **Submit answers** through `check_answer` rather than deciding locally.
4. **Queue solves made with no signal**, and say so on screen.

The first is what stops a reinstall destroying somebody's trails. The rest is
what makes the same account mean the same thing on both clients.

---

## 1. Accounts

### The one rule that must not be got wrong

A first-time walker is signed in anonymously so the app opens without a form.
That anonymous user is a **real row** in `auth.users` with real progress hanging
off its id.

When they sign up, the app must call **`updateUser`** on the *existing* session:

```
PUT /auth/v1/user
Authorization: Bearer <the anonymous session's access token>
{ "email": "...", "password": "..." }
```

That converts the row in place — same uid — so every team membership, solved
stop and submission stays attached with nothing to migrate.

**Calling `signUp` instead mints a second user and strands the first one.** It
looks like it works, because the new account is empty and empty looks clean.

Verified: an account that solved a stop while anonymous keeps that stop, keeps
its id, and signs in with a password afterwards. **Not verified:** GoTrue's own
email-change call, because it sends mail and confirmations are on with the send
allowance spent. Turn confirmations off or wire real SMTP and this becomes
testable end to end.

### Signing in to a different account

If somebody signs into an account they already had, on a device that has
anonymous progress, the two are **not merged**. Warn before it happens, then keep
the account's history. Merging has no correct answer — two start times, two
teams, the same marker solved twice.

### Where it goes

Welcome and Settings, as decided. `nav.signin` / `nav.signup` on the site are the
same two words.

### There are no account types

Nobody is "a creator". The same person owns the trail they built and plays
somebody else's at the same time. Capability is per trail, in
`world_members.role` (`owner` / `editor` / `viewer`), read through `world_role()`.
Never gate a feature on a global flag.

---

## 2. Progress moves off the device

`DiscoveryTracker` currently holds "found" in `PlayerPrefs`. That makes a
reinstall destroy a group's afternoon and makes a leaderboard impossible.

**Read:**

```
POST /rest/v1/rpc/my_progress   { "p_world": "<uuid>" }
→ [ { marker_id, points, solved_at, solved_by }, ... ]
```

Returns only the caller's own team. Keep the local store as a **cache** for
offline drawing, not as the truth.

**Progress belongs to a team**, and a solo player is a team of one that the
server creates on their first solve. The app never has to mention the word.

---

## 3. Answering

```
POST /rest/v1/rpc/check_answer   { "p_marker": "<uuid>", "p_submitted": "..." }
→ { "verdict": "correct" | "incorrect" | "pending_review", "points": <int> }
```

Three kinds, and the app does not need to know which is which — it sends what the
reader typed and renders the verdict:

- **exact** — compared case-insensitively, surrounding whitespace stripped; the
  creator may list several accepted spellings.
- **choice** — send the chosen index as a string (`"2"`). The options travel with
  the marker in `content`; the correct index never leaves the server.
- **free** — comes back `pending_review`. Show that honestly: it is not a
  failure, and points arrive later when the creator decides.

**The answer never reaches the phone.** A wrong answer and a marker that does not
exist return byte-identical replies, on purpose, so nothing can be mapped by
watching the errors. Do not add a client-side check "to save a round trip" — that
is the whole seam.

### `pending_review` needs a state in the UI

Today a marker is found or not found. There is now a third: *submitted, waiting
on a person*. It needs its own treatment on the marker sheet and in the strip, or
a reader will assume they got it wrong.

---

## 4. Offline

Answers are checked on the server precisely so they are never on the phone, which
means **a stop cannot be verified without a signal**. This is not a defect to
engineer around; both comparable city games in Bulgaria require mobile data for
the same reason.

- **Guided and Freefall** keep working offline — nothing needs checking.
- **Competitive** needs a connection. Say so before the walk starts, not in a
  dead street.

Where a submission is made with no signal, queue it and sync when the connection
returns, showing it as *waiting to be checked* rather than as solved. A verdict
that arrives ten minutes later is fine; a verdict the app invented is not.

---

## 5. Competitive trails refuse anonymous users

Registering a team on a `ctf` trail with an anonymous account raises `28000` with
`a competitive trail needs a real account`. That is enforced in the database, not
in the UI.

The app should ask for an account **before** the reader walks to the first stop,
not after they have answered it. `trail_summary` returns `needs_account` for
exactly this.

---

## 6. Everything a person can see, they can take and delete

Both already exist and both are wired on the website:

```
POST /rest/v1/rpc/export_my_data       → one JSON document
POST /rest/v1/rpc/what_delete_removes  → what the delete will cost, before it happens
POST /rest/v1/rpc/delete_my_account    → does it
```

`delete_my_account` takes no user id, so it cannot be aimed at anybody else.
Deleting an account that owns trails deletes those trails and every marker in
them, for everyone who joined — which is why `what_delete_removes` exists and why
the confirmation must show its answer.

---

## The RPCs the app will use

| Call | Who | What it is for |
|---|---|---|
| `markers_near` | anyone | unchanged; still the only door to markers |
| `join_world` | signed in | unchanged |
| `trail_summary` | anyone | stop count, team count, `needs_account` |
| `my_progress` | signed in | what this team has solved |
| `check_answer` | signed in | submit an answer, get a verdict |
| `world_leaderboard` | anyone | standings, no markers, no answers |
| `create_team` / `join_team` / `leave_team` | signed in | teams of 1–4 |
| `my_history` | signed in | trails joined, teams, points |
| `export_my_data` / `what_delete_removes` / `delete_my_account` | signed in | the account's own data |

Everything else in `public` is either internal or creator-only, and `0011`
revoked it from clients. If a new call answers "could not find the function",
it needs an explicit grant — that is the default now, and it is deliberate.

---

## Still open

- **Confirmations are on and SMTP is the default 3-an-hour allowance.** Real
  registration needs Resend or Postmark before anyone but you signs up, and it
  is what blocks proving the upgrade end to end.
- **The tile provider.** The portal uses OpenFreeMap; the app's release decision
  is still unmade, and OpenStreetMap's public tiles are not licensed for it.
- **Media.** Markers can carry video and audio and there is still no bucket, no
  size limit and no answer on who absorbs the egress when thirty phones stream
  the same clip.
- **Live team sync.** If one member solves a stop, the others' phones do not
  find out until they refresh. Realtime makes it cheap; it is a decision, not an
  oversight.
