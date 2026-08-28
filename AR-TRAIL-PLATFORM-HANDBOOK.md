# AR Trail Platform — Project Handbook

Complete reference for the project. Everything a person (or another assistant) needs to
pick this up cold and continue without re-deriving decisions.

**Status: Phase 0 passed on 2026-08-28. The gate is open.**

A marker placed by clicking a web map in a browser was seen standing on its real
location in Yambol, in the colour chosen in that browser, anchored by ARCore. The
whole chain is proven end to end: browser click -> Postgres row -> `markers_near`
RPC -> phone -> runtime `BuildingData` -> terrain anchor in the street.

What is now **fact**, not decision:

- The RPC seam (§4) works as designed; the app never touches the `markers` table.
- The runtime `CreateInstance` ScriptableObject pattern (§2) carried the entire
  existing UI across to a multi-tenant backend with one new file.
- Terrain anchors at 1.5 m resolve in Yambol with no altitude data (§8, §9).
- Fork over clean start (§2, §13) was correct.
- PostGIS `geography` + `ST_DWithin` returns what the phone needs (§6).

Everything from Phase 1 onward is still a decision, not a fact. Where something is
inherited from the AR building app and *was* proven there, it says so explicitly.

This document is the sibling of `AR Architecture Guide` (the AR building app handbook).
It does not supersede it. That project continues; this one branches from it.

---

## Table of contents

1. [What this is](#1-what-this-is)
2. [Relationship to the AR building app](#2-relationship-to-the-ar-building-app)
3. [Working with Alex](#3-working-with-alex)
4. [The two-client model](#4-the-two-client-model)
5. [Modes](#5-modes)
6. [Data model](#6-data-model)
7. [The marker library](#7-the-marker-library)
8. [The AR pipeline](#8-the-ar-pipeline)
9. [Anchoring and its precision ceiling](#9-anchoring-and-its-precision-ceiling)
10. [Public trails and moderation](#10-public-trails-and-moderation)
11. [Tech stack](#11-tech-stack)
12. [Decisions and why](#12-decisions-and-why)
13. [Inherited traps — do not rediscover these](#13-inherited-traps--do-not-rediscover-these)
14. [Roadmap](#14-roadmap)
15. [Known unknowns](#15-known-unknowns)
16. [Open questions](#16-open-questions)

---

## 1. What this is

A platform for authoring and experiencing geo-anchored AR trails. Two products sharing
one database.

**A website** where a creator signs in, places markers on a map or by typing
coordinates, picks a marker style from a library, writes the text, and groups those
markers into a named **world**. A world has a join code. Other people enter that code —
some as co-editors who can add and move markers, some as observers who can only look.

**A mobile app** that renders those markers on their real locations in AR. Point the
phone down the street, see the markers standing on the buildings, tap one to open an
info panel. The same app serves a guided history walk, a school lesson, and a CTF-style
city game.

The defining shift from the AR building app: **the reader and the author are the same
person.** Content is no longer researched by one developer and consumed by everyone
else; it is authored by whoever signs up.

- **Creators** — open signup. Anyone with a verified email can make a world.
- **Viewers** — join by code, no account required (anonymous session).
- **Scale** — unknown. Design for hundreds of small worlds, not one large one.
- **Languages** — arbitrary, not a fixed EN/BG pair. See §6.
- **Budget** — free/open-source preferred. Supabase free tier covers development.
- **App name and bundle id** — undecided. Do not invent them. Note that **two** bundle
  ids are now needed: the AR building app's is still the URP template default.

---

## 2. Relationship to the AR building app

Fork the Unity project. Do not start clean. Roughly 80% of `Assets/Scripts` transfers,
and — more valuable — every hard-won fix transfers with it (see §13).

| Layer | Fate |
|---|---|
| `MarkerSpawner`, `MarkerView`, `OcclusionService` | Carry over near-unchanged |
| `CubeTapManager`, `TappableObject` | Carry over unchanged |
| `InfoPanelController` | Carry over; becomes schema-driven rather than field-driven |
| `UserLocationService`, `VpsStatus`, `ReadyStateView` | Carry over. **More** important here, not less |
| `AppTheme`, `ThemedElement`, `AppStrings`, `UIFactory`, `UISprites` | Carry over |
| `GeoMath`, `SheetAnimator`, `FlowLayoutGroup`, `SwitchView`, `BuildingRowView` | Carry over |
| `BuildingData` as a runtime `CreateInstance` ScriptableObject | Carry over as `MarkerData`. **This pattern is the whole trick** |
| `TabNavigationController`, `SearchTabController`, `SettingsTabController` | Carry over, restructured around worlds instead of a single city |
| `RemoteBuildingSource` | Replaced by an authenticated API client |
| `CsvParser` | Dies |
| Google Sheet published as CSV | **Dies.** Cannot survive — see §12 |
| `BuildingCategory`, `EraDefinition` | Die as global assets; become per-world creator choices |
| `Cesium for Unity` | Probably unnecessary — see §13 |

**Why the ScriptableObject pattern is the whole trick:** `BuildingData` is a
`ScriptableObject`, and ScriptableObjects can be created at runtime with
`CreateInstance` without ever being saved as assets. The remote layer parses a payload,
builds one in memory, and hands it to the same UI code. In the AR building app this
meant the entire UI survived the move from `Resources` to a Google Sheet untouched.
Here it means the entire AR half survives the move to a multi-tenant backend untouched.
Preserve it.

---

## 3. Working with Alex

- Address him as **Alex**.
- Strong preference for **minimal raw code** — Inspector-driven, visual, low-code where
  possible. Generate scene wiring with Editor tools rather than hand-wiring.
- Wants **click-by-click instructions** that explain every setting, not summaries.
- **Do not assume a component exists in the scene** unless it has been confirmed.
- Wants **decisive root-cause diagnosis**, not branching lists of maybes.
- Solo. No team, no CMS, no translator, no moderator but himself. Every design choice
  that adds recurring human work is a choice to make that work land on one person.

---

## 4. The two-client model

The website and the app **never talk to each other**. Both are clients of one backend,
and the backend holds the only truth.

```
  Creator portal (web)                 AR app (Unity)
  map · metadata · roles               camera · markers · info panel
          │                                     │
     create, edit                        read, capture
          │                                     │
          ▼                                     ▼
  ┌──────────────────────────────────────────────────┐
  │                 Shared backend                    │
  │   Postgres + PostGIS · Auth · Storage · Realtime  │
  └──────────────────────────────────────────────────┘
```

The app sends its coordinates and a world id, gets JSON back, and builds `MarkerData`
objects in memory. The existing three-tier load behaviour from `RemoteBuildingSource`
transfers verbatim and is still correct:

1. On `Start`, publish the cached copy from `Application.persistentDataPath` immediately,
   so the app is usable in the first second.
2. Fetch from the API. On success, publish and overwrite the cache.
3. On failure, stay silent and keep whatever was loaded. Only a first run with no cache
   *and* no network shows an error.
4. Refetch on resume from background, rate-limited.

### The one seam that must not be skipped

**The app never selects from the `markers` table directly.** It calls a Postgres
function:

```sql
markers_near(world_id uuid, lat float, lng float, radius_m int)
```

In v1 this returns everything inside the radius. That is not the reason to build it.

The reason is that CTF mode requires markers that are hidden until unlocked. If the
client reads the table, the phone holds every answer in memory before the player walks
anywhere, and no amount of UI hiding fixes it — the data is already on the device.
Retrofitting server-side filtering after clients ship means rewriting the client.
Building the RPC on day one means CTF mode is later a change to one function body.

This is the same move as the runtime ScriptableObject: keep the seam in one place so
the layer above never learns what happened below.

---

## 5. Modes

Three modes at launch: **guide**, **educational**, **CTF**.

They are **presets over one engine**, not three products. A mode is:

- a set of defaults on world creation,
- which optional fields the editor shows,
- how the app presents the world.

It is stored as `worlds.mode` (text) plus a `worlds.rules` (jsonb) blob. There is no
per-mode table, no per-mode code path, and no per-mode Unity scene. If modes start
growing their own tables, that is the signal something has been modelled wrong.

| | Guide | Educational | CTF |
|---|---|---|---|
| Marker visibility | All visible | All visible | Sequential or proximity unlock |
| Ordering | Optional | Optional | Enforced |
| Info panel | The payload | The payload | Reward for solving |
| Answer submission | No | Optional, self-checked | Yes, server-validated |
| Timing / scoring | No | No | Yes |
| Needs server authority | No | No | **Yes** |

Guide and educational are the same engine with different editor copy. **CTF is the only
mode that adds real backend work**, which is why it is scheduled last (§14) and why the
RPC seam in §4 exists.

### CTF-specific rules, when it is built

- **Never validate answers client-side.** The first participant to open the APK wins.
- **Do not trust GPS.** Mock-location spoofing is trivial on Android. Gate unlocks on
  ARCore's Earth tracking state and accuracy, not raw location — VPS localization needs
  real camera imagery and is far harder to fake.
- **Server timestamps only.** Device clocks are user-controlled.
- The existing Yambol city CTF (answers submitted via web form and QR codes) is the
  reference use case. AR markers replace the QR codes; the answer-checking model is
  the same.

---

## 6. Data model

Six tables in v1. PostGIS enabled; `markers.location` is `geography(Point, 4326)` with
a GIST index, so "everything within 500 m" is one indexed query instead of client-side
Haversine over the whole set.

```
PROFILES        id · display_name · is_anonymous · terms_accepted_at
WORLDS          id · owner_id → PROFILES · name · join_code · visibility · mode
                · rules(jsonb) · status · default_language
WORLD_MEMBERS   world_id → WORLDS · user_id → PROFILES · role
MARKERS         id · world_id → WORLDS · location(geography) · style_key → MARKER_STYLES
                · colour_hex · content(jsonb) · status · version
MARKER_STYLES   key · label · prefab_address · source · owner_id
REPORTS         id · marker_id → MARKERS · reporter_id → PROFILES · reason · state
```

Row-level security on every table. `WORLD_MEMBERS.role` is `owner | editor | viewer`.

### Field notes that matter

**`content` is `jsonb`, not parallel `_en` / `_bg` columns.** The AR building app uses
parallel fields and that was the right call there — one developer, two languages, no
translator. It is the wrong call here, because a creator in Kraków needs `pl` and you
cannot ship a schema migration every time someone speaks a new language. Store
`{"en": {"title": …, "body": …, "link": …}, "bg": {…}}` and fall back to
`worlds.default_language` when the reader's language is absent. That is the same
`Pick()` fallback logic, one level deeper.

**`version` is an optimistic lock.** Update with `where version = $n`; zero rows back
means the other editor got there first. Do not build CRDTs. Two people rarely touch the
same marker in the same second, and when they do, "this marker changed, reload" is an
acceptable answer. Pair it with a realtime subscription so the other editor's map
refreshes.

**`status` carries the draft/published distinction over from the sheet**, and earns its
keep for the same reason: a creator captures coordinates on site weeks before writing
the text, and a nameless marker should not appear meanwhile.

**`visibility` is `private | unlisted | public`.** Unlisted means code-only. Public means
listed in the library, and reaching it requires review (§10).

**`marker_styles.source` is `builtin | user`.** No user styles exist in v1. The column
costs nothing now and means custom prefabs later are a new row type rather than a
migration.

**`is_anonymous`** — creators sign up with a verified email; viewers joining by code get
an anonymous session. Forcing forty CTF participants through email verification on a
Saturday morning in a park is how an event fails. An anonymous account still has a
stable id, so a bad actor can still be blocked.

### Join codes

Short, ambiguity-free alphabet (no `0`/`O`, no `1`/`I`/`l`). Stored on the world,
rotatable by the owner. Rotation must not evict existing members — membership lives in
`WORLD_MEMBERS`, the code is only the door.

---

## 7. The marker library

**Custom prefab upload is deferred**, deliberately, until the browser→app round trip is
proven end to end (Phase 0, §14). Until then, creators pick from a curated library and
choose a colour.

Style and colour resolve exactly as they do in the AR building app today:

```
marker.style_key    (the creator's choice)
  ↓ else
world default
  ↓ else
spawner.defaultPrefab
```

Colour resolves the same way. This means **colour-coded classification works from day
one on plain shapes**, from hex values, with no marker art. That was true in the AR
building app and it is true here.

Ship the library **bundled in the build** at first. Move it to remote Addressables when
the library grows faster than the release cadence — not before. Addressables is the
only mechanism that lets the library grow without a store release, and it exists for
exactly the same reason the Google Sheet existed: adding content must not require a
rebuild.

### When custom prefabs arrive

**Unity cannot load a `.prefab` at runtime.** A prefab is an editor asset; the only
runtime-loadable Unity formats are AssetBundles and Addressables, both of which must be
built by the Unity Editor per platform. A user with a browser cannot produce one. This
is a hard constraint, not a difficulty.

The only viable path is **glTF / GLB loaded at runtime** with `com.unity.cloud.gltfast`
(Unity's official package — loads from a URL or a byte array and instantiates into the
scene). When it is built:

- Enforce file size and triangle caps **server-side**, at upload. One 80 MB model kills
  every phone on the trail.
- Reject on parse failure server-side too; do not ship malformed geometry to devices.
- Treat uploaded models as UGC for moderation purposes (§10). 3D is harder to review
  than text, which is the main reason this phase is expensive.

---

## 8. The AR pipeline

Carried over from the AR building app, proven there on a real device.

### Spawning

`MarkerSpawner` runs on the location service's once-a-second cadence:

- Markers within **500 m** spawn; released past **650 m**. The gap stops flicker at the
  boundary.
- At most **20 markers** at once, nearest first. ARCore only tracks a bounded number of
  anchors well.
- Each is a **terrain anchor at 1.5 m above ground** —
  `ResolveAnchorOnTerrainAsync(lat, lng, 1.5, identity)`. ARCore resolves height against
  real ground, so **no marker carries an altitude**.
- Resolution failure is expected, not exceptional. It fails indoors, in poor VPS
  coverage, and before Earth tracking settles. The next sync retries.
- The marker is parented under the resolved anchor and given a `TappableObject` carrying
  its `MarkerData`, which is why the existing tap chain works unchanged.

### Occlusion

Two mechanisms, both carried over:

- **Streetscape Geometry** — Google's building meshes become invisible `MeshCollider`s
  on *Ignore Raycast*. A camera→marker raycast hides the marker if it crosses a
  building. The raycast stops **5 m short**, so a marker's own facade does not hide it.
- **Depth API** — per-pixel occlusion through the AR background shader for cars, walls
  and people. Dependable only to ~8 m, which is why it cannot replace the above.

**Occlusion fails open.** No service, no camera, no meshes, or the setting off, and
nothing is ever hidden. A missing mesh must never make markers disappear.

Streetscape Geometry coverage in small towns is unknown and patchy — it needs Google's
3D building data. This was never verified in Yambol for the AR building app either. It
is not blocking, because occlusion fails open.

### The Ready State is more important here, not less

`ReadyStateView` exists because ARCore needs several seconds to localize, during which
markers are absent or visibly wrong — indistinguishable from a broken app, at exactly
the moment someone decides whether it works.

In the AR building app that person had downloaded a city guide. Here, that person is
standing in a park with a code someone handed them thirty seconds ago and no investment
in the outcome. The calibration screen, the "Start anyway" escape hatch, and the live
VPS status readout are load-bearing.

**The AR session is never paused.** Turning it off stops Geospatial localization — the
exact thing the Ready State is waiting for. The session runs from launch; the Ready
State covers the feed with an opaque panel.

---

## 9. Anchoring and its precision ceiling

**A web map can only ever produce a latitude and a longitude.** This is the single
constraint that shapes the authoring UX.

| Anchor type | Accuracy | Authorable from a browser? |
|---|---|---|
| Geospatial terrain anchor | Metres | **Yes** — this is what the website produces |
| Geospatial rooftop anchor | Metres | Yes, where building data exists |
| Cloud Anchor | Centimetres | **No** — requires physically scanning the location |

Geospatial anchors are accurate enough for "a marker on that building" and wrong for "a
cup on that windowsill". Cloud Anchors close that gap but hosting one means standing
there with the camera, and persistence beyond 24 hours requires keyless OAuth rather
than an API key.

So the design is **two authoring tiers**:

1. **Coarse placement on the web map** — the default, the fast path, good enough for
   nearly every trail.
2. **On-site refinement in the app** — a capture mode where the creator walks to the
   marker and nudges it, writing corrected coordinates back through the API.

The capture mode was already on the AR building app's roadmap as an optional
convenience. Here it is structural.

**Do not use WGS84 anchors.** They need an absolute ellipsoidal altitude, which differs
from sea level by roughly 35 m in Bulgaria and is unknowable per point without survey
data. This caused at least one failed field test on the previous project.

---

## 10. Public trails and moderation

The public library is the highest-risk feature in the project, and the risk is not
technical.

Google Play requires UGC apps to define objectionable content in enforceable terms of
use, obtain non-skippable user consent to them, provide **separate and clearly labelled**
in-app functions to **report content** and to **block users**, and act on reports. AR is
explicitly named alongside DMs and public feeds as needing stricter controls than
ordinary UGC. Apple's equivalent requirements are comparable.

### The launch gate

**Publishing to public goes through an approval queue.** Private and unlisted worlds
publish instantly; moving a world to `visibility = public` puts it in `submitted`, and a
human — Alex — moves it to `public`. Auto-publish with reactive takedown is what gets an
app pulled, and it puts unbounded reactive work on one person.

This keeps the recurring workload proportional to how many people actually want to
publish, which early on is a handful.

### The abuse vector specific to this product

Someone will eventually place a marker at a school, a hospital, a private house, a
memorial, or a place of worship. **The offence is the location, not the words**, so text
filtering does not catch it. Pokémon Go spent years on this and it was never a technical
problem.

Two cheap mitigations:

- **One admin map** showing every marker across every world, with delete-by-area. One
  PostGIS query, an afternoon of work, and the single most useful moderation tool a geo
  product can have.
- **A geographic blocklist** for categories of sensitive location, applied at placement
  time as a warning and at review time as a hard stop.

### Minimum moderation surface for v1

- Non-skippable terms of use at signup, versioned, with `terms_accepted_at` recorded.
- Report button on every marker and every world.
- Block user, as a separate and clearly labelled action.
- A reports inbox for Alex.
- The ability to remove a marker, a world, or a user, and to remove by area.
- Rate limits: markers per user per day, worlds per user.
- Email verification for creators. Throwaway accounts are the cheapest attack.

### Legal

Alex is in Bulgaria. Open signup makes him a data controller under GDPR: privacy policy,
deletion path, a data processing agreement with the backend provider, and a Play Data
Safety declaration. A privacy policy is mandatory regardless because the app requests
camera and location.

---

## 11. Tech stack

| Piece | Choice | Notes |
|---|---|---|
| Backend | Supabase | Postgres, auth, storage, realtime, RLS in one project |
| Geo | PostGIS | One-click extension. `ST_DWithin` on `geography` + GIST index |
| Web frontend | React / Next.js | |
| Web map | MapLibre GL JS | Open source, no token cost |
| Unity | 6000.4.10f1, URP 17.4.0 | Same as the AR building app |
| AR | AR Foundation + ARCore XR plugin + ARCore Extensions | Geospatial mode enabled |
| Unity ↔ backend | `UnityWebRequest` + JSON, or `supabase-csharp` | Existing fetch/cache pattern fits |
| Future 3D upload | `com.unity.cloud.gltfast` | Not in v1 |
| Input System | 1.19.0, `activeInputHandler: 2` (Both) | **Must stay** — see §13 |

### Costs and traps

- ARCore Geospatial API is free to use, quota-limited per project rather than billed.
- Supabase free tier: 500 MB database, 1 GB file storage, ~5 GB egress, 50k monthly
  active users, 2 active projects. **Free projects pause after a week of inactivity.**
  A paused project on the morning of a CTF event is a bad day — keep it warm or pay for
  the month around an event.
- Play Console $25 once. Apple Developer Program $99 per year. iOS needs a Mac.
- **The signing keystore is the one irreversible mistake.** Lose the file or its
  password and the app can never be updated by anyone, ever. Back it up to two places
  the day it is created. This now applies to two apps.

### Alternatives that were checked and rejected

- **WebAR** is not a shortcut. 8th Wall shut down platform access in February 2026 with
  hosted projects going dark in February 2027. The engine was open-sourced but the SLAM
  and VPS components were not released as usable open source.
- **Niantic Lightship** is unstable ground: the Maps SDK was sunset in October 2025,
  followed by heavy layoffs and the spin-off of Niantic Spatial.

Native Unity plus ARCore Geospatial remains the correct bet.

---

## 12. Decisions and why

**The Google Sheet dies.** Not a preference. A published CSV is a read-only global
artifact; this project needs writes, per-user identity, per-world scoping, and
permissions. The technique has a boundary and this is it.

**Website and app never talk to each other.** Both are clients of the backend. Any
design where the site "sends" content to the app is wrong.

**The app reads through an RPC, never the table.** See §4. This is the one decision that
is expensive to reverse.

**Modes are presets, not products.** See §5.

**Public trails need review; private and unlisted do not.** See §10.

**Custom prefabs are deferred until the browser→app round trip is proven.** Alex's call,
and the right one: the upload path is the most expensive piece and the least useful
until the cheap path works.

**`content` is `jsonb`, not parallel language columns.** See §6. This is a deliberate
reversal of the AR building app's choice, for a reason that only applies to a
multi-tenant platform.

**Viewers are anonymous; creators are verified.** See §6.

**Fork the Unity project rather than starting clean.** See §2 and §13.

**Terrain anchors, not WGS84.** See §9.

**Legacy `Input` for tap detection.** Settled after extensive debugging on the previous
project. `Active Input Handling` is `Both` and must stay. Do not migrate 3D object
picking to the new Input System.

**Occlusion fails open.** A missing mesh must never make markers vanish.

**The AR session is never paused.** See §8.

---

## 13. Inherited traps — do not rediscover these

Every one of these cost real time on the AR building app. They are properties of the
toolchain, not of that project, so they will recur here.

| Symptom | Cause | Fix |
|---|---|---|
| Yellow screen on device | URP Renderer missing **AR Background Renderer Feature** | Add it to **both** renderers |
| `CS0234` InputSystem namespace | Package cache corruption after an Editor crash | Delete `Library/PackageCache` only |
| Gradle `DirectoryNotFoundException` | EDM4U copying into a missing folder | Create `Assets/Plugins/Android` |
| Marker in the wrong place, no permission prompt | Project-level Geospatial checkbox ≠ session config | `ARCoreExtensionsConfig` with `GeospatialMode = Enabled`, linked to the ARCore Extensions object |
| Editor crash on exiting Play | `FlowLayoutGroup` reading destroyed children during teardown | Null-check children; let pills measure themselves rather than nesting fitters |
| Whole UI vanishes after a build tool run | Uninitialised `UnityEvent` field; builder threw partway after deleting everything | Initialise the field; wrap every build tool in `Undo.RevertAllDownToGroup` rollback |
| Wired-up buttons do nothing | `Action<T>` is not serializable, so edit-time assignment is discarded | Serialize concrete references, wire delegates at runtime |
| Sections overlapping | `ContentSizeFitter` on children of a `VerticalLayoutGroup` — both driving the same rect | Fitters only on scroll content and free-floating elements |
| Light mode half-applied | Layout tool painting the shell with fixed colours | Everything carries a `ThemedElement`; **nothing hardcodes a colour** |
| Close buttons drawn as boxes | `✕` and `❚` are not in a Latin-only font atlas | Draw crosses from two rotated bars |
| `21 Ð¼` instead of `21 м` | UTF-8 bytes read as Latin-1 by a repair script | Rewrite; scan the whole project |
| Shader "out of memory" on Android build | `CesiumDefaultTilesetShader` generating ~36 billion variants | Reassign Opaque Material to `CesiumUnlitTilesetMaterial`; tag `Cesium3DTileset` **EditorOnly** |

### Two corrections to earlier belief, carried forward

- **Cyrillic was never broken.** It was repeatedly treated as a blocker on the previous
  project. `LiberationSans SDF` has a dynamic fallback that rasterizes missing glyphs on
  demand from Liberation Sans, which contains Cyrillic. No font work was ever needed.
  Do not spend time on it here.
- **Cesium is probably unnecessary in this project.** Cesium exists in the AR building
  app for the Geospatial Creator's editor-time globe preview. There is no editor-time
  placement here — every marker is spawned at runtime from backend data. If Cesium is
  not needed, the fragile tarball dependency (`file:C:/Users/zalex/Desktop/…tgz`) does
  not come along. **Verify before installing it.**

### Data-parsing rules that still apply

- **Parse coordinates with invariant culture.** On a phone set to Bulgarian, current
  culture reads `.` as a thousands separator and turns `42.48` into `4248`.
- **Format distances locale-aware.** Bulgarian uses a comma as the decimal separator, so
  `1.2 km` becomes `1,2 км`.
- **Validate the response before trusting it.** The old sheet returned an HTML error page
  with HTTP 200 when unshared. An API can do the same through a proxy or captive portal.
  Check the content type and shape, not just the status code.

---

## 14. Roadmap

Phases, not dates. Estimates are for a solo developer and are ranges because nothing
here has been built yet.

| Phase | What | Estimate |
|---|---|---|
| **0** | **Backend skeleton + one marker end to end.** Supabase project, PostGIS on, `markers` table, `markers_near` RPC, a throwaway web page that inserts one row, and the Unity app resolving it as a terrain anchor outdoors. **This is the gate for everything else.** | 10–15 h |
| 1 | Auth, worlds, world members, join codes, roles, RLS policies | 15–20 h |
| 2 | Creator portal: map, click-to-place, coordinate paste, marker editor, style and colour picker | 30–40 h |
| 3 | App rework: code entry, remote source swap, `MarkerData`, info panel from `content` jsonb | 25–35 h |
| 4 | Realtime co-editing + optimistic locking | 8–12 h |
| 5 | Moderation: terms, report, block, reports inbox, admin map | 20–30 h |
| 6 | Public library: visibility states, approval queue, discovery UI | 20–30 h |
| 7 | Capture mode: on-site refinement writing back to the API | 10–15 h |
| 8 | CTF mode: unlock rules, server-side answer validation, scoring, anti-spoof | 30–45 h |
| 9 | Custom prefabs: GLB upload, server-side validation, glTFast runtime loading | 25–40 h |
| 10 | Store preparation, privacy policy, Data Safety, internal testing track | 15–25 h |
| 11 | iOS port (needs a Mac) | 10–16 h |

Phase 0 exists as a separate phase deliberately. It is small, it is unglamorous, and it
answers the only question that matters before any of the rest is worth building: does a
coordinate typed in a browser reliably become a marker standing on the right spot
outdoors?

---

## 15. Known unknowns

Things that are genuinely not known and should not be asserted either way.

- **Streetscape Geometry coverage in Yambol and towns like it.** Needs Google's 3D
  building data, thorough in large cities and patchy in small towns. Check by ticking
  **Show Occluders** on `OcclusionService` and building. Not blocking — occlusion fails
  open.
- **Whether the website can warn creators about VPS coverage.** ARCore exposes a VPS
  availability check *in the SDK, on device*. There appears to be no public web endpoint
  for it, which would mean the website cannot tell a creator that the point they just
  clicked will not localize — only the app can, once someone stands there. **Verify this
  before designing around it.** If it holds, the mitigation is a coverage warning in the
  app's capture mode rather than in the web editor.
- **How many markers a phone handles across several overlapping worlds.** The 20-anchor
  cap was tuned for one dataset in one city.
- **Whether Supabase free-tier limits hold** once real worlds exist. Text and coordinates
  are cheap; 500 MB is a lot of marker rows. Egress during a live event is the number to
  watch.

---

## 16. Open questions

1. **App name and bundle id.** Both permanent once published. Two are now needed — the
   AR building app's is still `com.UnityTechnologies.com.unity.template.urpblank`.
2. **Can a public trail be cloned or forked?** Powerful for reuse; a licensing and
   attribution question the moment it exists.
3. **Is a world geographically bounded?** One city, or can a world span countries? Bounds
   make discovery, caching and the admin map much easier.
4. **Offline behaviour during an event.** A park with forty phones and no signal is a
   realistic scenario. Cache the whole world on join?
5. **Who pays for hosting when it grows past the free tier**, and is there any intended
   revenue model?
6. **What happens to a world when its owner deletes their account?** Orphan, transfer, or
   delete. GDPR makes this non-optional.
7. **Does the marker library need per-mode subsets** — CTF checkpoint shapes, educational
   icons — or is one library with colour enough?

---

*Written 2026-08-25. Phase 0 verified against running code on 2026-08-28: marker `A`
(`#72007A`, world `c1bd0005`) placed from a browser and observed standing on its real
location in Yambol. Phases 1-11 remain unverified.*
