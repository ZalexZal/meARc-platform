# Phase 1 — identity, membership, and shutting the door

Phase 0 proved the pipe works. Phase 1 is where the database **stops trusting
everyone**.

Right now two policies — `phase0_dev_anon_all_worlds` and
`phase0_dev_anon_all_markers` — let anybody holding the anon key read, write,
edit and delete every row. That key is inside the APK and in the repo. Phase 1
deletes them and replaces them with identity: who you are, which worlds you
belong to, what your role permits.

**Nothing visible gets built.** It is the least rewarding phase in the project
and the one where mistakes have the longest tail, because RLS is the only thing
between the data and the internet.

**Definition of done:** an authenticated creator can create a world and only see
their own; a second account cannot see it; an anonymous viewer who redeems a
join code can read that world's published markers and nothing else; and every
one of those claims is verified with `curl` from outside the dashboard, not
assumed from the SQL editor.

---

## Decisions taken before starting

Answered by Alex on 2026-08-28.

| # | Question | Decision |
|---|---|---|
| 1 | Does the app survive RLS lockdown? | **Yes** — published markers in `unlisted`/`public` worlds stay readable without login. Deleted in Phase 3. |
| 2 | Roadmap order | **Phases 2 and 3 swap.** Full app rework comes next; the creator portal follows. |
| 3 | Terms of use | **In scope.** Versioned, non-skippable, `terms_accepted_at` recorded. |
| 4 | Email verification | **Deferred.** Confirmation off during development, on before anyone else signs up. |
| 5 | Roles | `owner \| editor \| viewer`. **No separate guest role** — see below. |
| 6 | Account deletion | **Cascade.** Deleting a profile deletes its worlds and their markers. |

### Why there is no "guest" role

The requested behaviour — type a code, look at the map, explore, no account — is
already the design. It is built from two orthogonal things, not one role:

- `world_members.role = 'viewer'` — **what you may do**: read, not edit.
- `profiles.is_anonymous = true` — **how you got in**: an anonymous session, no
  email, no password, no signup screen.

A fourth role named `guest` would duplicate the first axis and create a
distinction with no answer to "how is this different from viewer?".

**It must not be truly account-free.** §10 requires a clearly-labelled way to
block users. Someone with no account has no stable id and cannot be blocked,
rate-limited or reported — one bad actor at an event and the only recourse is
shutting the world down. An anonymous session is invisible to the person using
it but is a real row with a real uuid underneath. That is exactly why §6 chose
it.

### Terms apply to anonymous users too

Play requires consent from **users**, not from account holders. So the terms gate
fires on first launch before entering a world, not only at email signup, and
`terms_accepted_at` is recorded on anonymous profiles as well. This is Phase 1
schema plus Phase 3 UI.

### Cascade needs guardrails later

`on delete cascade` on `worlds.owner_id` destroys co-editors' work and any event
in progress. Before this is reachable by anyone but Alex (Phase 5), it needs an
explicit typed confirmation naming what will be destroyed, and an export offered
first. Noted, not built now.

---

## The seven pieces

| | What | Why |
|---|---|---|
| 1 | `profiles` table | §6 — `display_name`, `is_anonymous`, `terms_accepted_at`, `terms_version`. Keyed to `auth.users` |
| 2 | `world_members` | §6 — `owner \| editor \| viewer`. Membership lives here; the code is only the door |
| 3 | Supabase Auth enabled | Email for creators, anonymous sessions for viewers |
| 4 | `join_world(code)` RPC | Redeems a code into a membership row. Rotation must never evict members |
| 5 | Real RLS on four tables | The actual work |
| 6 | `markers_near` respects membership | The §4 seam earns its keep: one function body changes, the client does not |
| 7 | `worlds.owner_id` real FK | Currently nullable with no constraint |

---

## Step 1 — `profiles`, hung off Supabase Auth

Supabase owns `auth.users` and it cannot be altered. The convention is a
`public.profiles` table keyed 1:1 to it, populated by a trigger on insert.

```
PROFILES
  id                uuid  PK, FK -> auth.users(id) on delete cascade
  display_name      text
  is_anonymous      bool  not null default false
  terms_accepted_at timestamptz
  terms_version     text
  created_at        timestamptz
```

`is_anonymous` is read from the JWT claim Supabase sets for anonymous sign-ins,
not trusted from the client.

**Why a trigger rather than the client inserting its own profile:** a client that
creates its own profile row can create one for somebody else's id.

---

## Step 2 — `world_members`

```
WORLD_MEMBERS
  world_id  uuid  FK -> worlds(id)   on delete cascade
  user_id   uuid  FK -> profiles(id) on delete cascade
  role      text  check (role in ('owner','editor','viewer'))
  joined_at timestamptz
  PRIMARY KEY (world_id, user_id)
```

The composite primary key means a person cannot hold two roles in one world.

`worlds.owner_id` stays as the fast answer to "whose is this", and a matching
`owner` row goes in `world_members` so permission checks only ever consult one
table.

---

## Step 3 — Auth configuration

Dashboard, **Authentication → Providers**:

- **Email** on. **Confirm email OFF** for now (decision 4). Turned on before a
  single other person signs up.
- **Anonymous sign-ins** on. This is what makes code-only viewing work.

Anonymous users are real `auth.users` rows with `is_anonymous` in the JWT. They
persist on the device; a reinstall produces a new identity.

---

## Step 4 — `join_world(code)`

```sql
join_world(p_code text) returns uuid
```

`SECURITY DEFINER`, because the caller cannot read `worlds` before they are a
member — this is the same seam trick as `markers_near`.

- Looks up the world by `join_code`, case-insensitive.
- Inserts `world_members(world_id, auth.uid(), 'viewer')`, doing nothing if the
  row already exists.
- Returns the world id, or raises if the code is unknown.

**A join code always grants `viewer`.** Editors are promoted by the owner from
the portal. A leaked viewer code costs an unwanted reader; a leaked editor code
costs the trail. Two different codes per world is the alternative, and it is
worse — it doubles what a creator has to keep straight for a rare case.

**Rotation must not evict members.** Membership lives in `world_members`;
changing `worlds.join_code` only changes the door, not who is already inside.

---

## Step 5 — the RLS policies

The real work. Written per table, per operation, and **verified from outside the
dashboard** — the SQL editor runs with elevated privileges and proves nothing
about what a client can do.

**`profiles`** — read your own; update your own; never delete directly.

**`worlds`** — read if you are a member, **or** if `visibility` is
`unlisted`/`public` and `status` is `published` (decision 1, the temporary one).
Insert if authenticated, and you become owner. Update and delete: owner only.

**`world_members`** — read rows for worlds you belong to. Insert only through
`join_world`. Update role: owner only. Delete: owner, or yourself leaving.

**`markers`** — clients never select this table. Direct read stays **denied to
everyone**; `markers_near` is the only door. Insert/update/delete: `owner` or
`editor` of that world.

### The temporary policy, marked for deletion

```sql
-- PHASE 1 ONLY. Delete in Phase 3 when the app enters join codes.
-- Keeps the working build alive while the app has no login.
create policy "temp_anon_read_published_worlds" on public.worlds ...
```

It carries that comment so it cannot be mistaken for a considered permission.

---

## Step 6 — `markers_near` respects membership

The function body changes; **the client does not**. It gains a membership check:
return markers only if the caller is a member of that world, or the world is
`unlisted`/`public` and published.

This is the §4 seam paying out a second time. The Unity app and the web page
both keep working with no edit.

---

## Step 7 — verification

Not optional and not done in the SQL editor. With `curl` and two real tokens:

1. Creator A makes a world. Reads it back. ✅
2. Creator B cannot see A's private world. ✅
3. Anonymous C redeems A's code, reads published markers. ✅
4. Anonymous C **cannot** read A's draft markers. ✅
5. Anonymous C **cannot** insert or edit a marker. ✅
6. Nobody can `select` from `markers` directly. ✅
7. The Unity app still works untouched. ✅
8. Rotating the code does not evict C. ✅

Any failure is a policy bug, and policy bugs are silent until someone finds them.

---

## What breaks

**The throwaway marker dropper stops being able to write.** It uses the anon key
with no session, and the dev policies it relied on are gone. It becomes
read-only, which is enough to keep confirming the app's data path.

Authoring moves to SQL until the portal exists — and since Phases 2 and 3 have
swapped, that is a longer stretch than originally planned. If it becomes
annoying, the cheap fix is a sign-in box on that page; it already talks to
Supabase.

---

## After Phase 1 — revised order

Phases 2 and 3 have swapped (decision 2).

| Phase | What | Estimate |
|---|---|---|
| **2 (was 3)** | **App rework** — join code entry, `BuildingData` → `MarkerData`, info panel from `content` jsonb, and the UX pass: "Search buildings" → markers, the vestigial BY ERA / BY TYPE filters removed, "buildings discovered" retired | 30–45 h |
| **3 (was 2)** | Creator portal — map, click-to-place, marker editor, style and colour picker, responsive, both languages, light and dark | 30–40 h |
| 4 | Realtime co-editing + optimistic locking | 8–12 h |
| 5 | Moderation — terms, report, block, inbox, admin map, deletion guardrails | 20–30 h |
| 6 | Public library — visibility states, approval queue, discovery | 20–30 h |
| 7 | Capture mode — on-site refinement writing back | 10–15 h |
| 8 | CTF mode | 30–45 h |

**Consequence of the swap, stated plainly:** the app becomes genuinely good
before there is any comfortable way to author content for it. Every marker will
come from SQL or the read-only dropper until the portal lands. That is the price,
and it is a real one.

**Node.js is not installed on this machine.** It is not needed for Phase 1 or 2,
and it is a prerequisite for 3.
