# Phase 0 — one marker, end to end

> **PASSED 2026-08-28.** Marker `A` (`#72007A`) was placed by clicking a web map
> and observed standing on its real location in Yambol, anchored by ARCore. Every
> step below is now a record of what was done, not a plan. Kept because the traps
> and the reasoning still apply to Phases 1-11.

The gate for the whole project. It answers one question and no others:

> Does a coordinate typed in a browser reliably become a marker standing on the
> right spot outdoors?

Nothing in Phase 1–11 is worth building until the answer is yes. Handbook §14.

**Definition of done:** you stand on a street in Yambol, holding a phone running
the forked app, and a marker is standing on the building whose coordinate you
clicked on a web map at your desk — placed there by a row in Postgres that the
app fetched through `markers_near`, not by anything hard-coded in the build.

---

## The shape of the work

Seven steps. Two of them are yours alone (they need a browser and a human), some
are mine, one is a walk outside.

| # | Step | Who | Time |
|---|---|---|---|
| 1 | Create the Supabase project | Alex | 10 min |
| 2 | Enable PostGIS, run the migration | Alex (I wrote the SQL) | 5 min |
| 3 | Seed one world + one marker by hand, verify the RPC | Alex | 15 min |
| 4 | The throwaway insert page | me, then you test | 1 h |
| 5 | Open the Unity fork, clear the inherited traps | Alex, I give the clicks | 1–2 h |
| 6 | The swap: one new C# file, one component change | me, you wire it | 2–3 h |
| 7 | Build to phone, walk outside | Alex | 1 h + weather |

**The single most important discovery from reading your code:** step 6 is far
smaller than the handbook assumes. See it below before you plan your week around
the 10–15 h estimate.

---

## Step 1 — Create the Supabase project

Go to `supabase.com`, sign in (GitHub sign-in is fine and saves you a password),
then **New project**.

Every field, and why:

- **Organization** — make one, name it anything. Free tier allows 2 active
  projects per org. You are using one of them here.
- **Project name** — `ar-trail-dev`. Name it *dev*, deliberately. When this
  becomes real you will want a separate production project, and a project called
  `ar-trail` that is actually your scratchpad is a trap you set for yourself.
- **Database password** — generate one and **save it in your password manager
  now**. You will not need it for normal work (the dashboard and the API keys
  cover everything), but it is the only way to connect with `psql` or any
  external tool later. Resetting it is possible; it invalidates every connection
  string you have written down.
- **Region** — **Frankfurt (eu-central-1)**. Two reasons and both matter. It is
  the lowest latency to Bulgaria of the EU options, and it keeps personal data
  in the EU, which is not optional for you: §10 makes you a GDPR data controller
  the moment signup opens. Choosing a US region now means a migration later, and
  migrating a live Postgres is never a pleasant afternoon.
- **Plan** — Free.

Provisioning takes about two minutes.

### Then collect two values

**Project Settings → API**:

- **Project URL** — looks like `https://abcdefghijk.supabase.co`
- **Project API keys → `anon` `public`** — a long JWT starting `eyJ...`

Send me both. They are safe to send.

### On the anon key being "safe"

People panic about this, so: the `anon` key is **designed to be shipped inside
public clients**. It is in every Supabase web app's JavaScript bundle and it will
be in your APK. It identifies the project and nothing else. The thing that
actually protects your data is Row Level Security on the tables — which is why
the migration turns RLS on for both tables before it inserts a single row.

The key you must never share, never put in the app, and never paste into a chat
is **`service_role`**. That one bypasses RLS completely. It lives on a server or
in your password manager, nowhere else.

### One free-tier fact to diary

**A free project pauses after 7 days with no activity.** Restarting is a click
and takes a minute, but §11 is right that discovering this on the morning of a
CTF event is a bad day. During development it will simply never idle that long.

---

## Step 2 — PostGIS and the migration

### 2a. Enable PostGIS through the dashboard, not the SQL

**Database → Extensions**, search `postgis`, toggle it **on**.

Do it this way rather than letting the migration's `create extension` line do it.
Supabase installs extensions into a dedicated `extensions` schema, and the
dashboard toggle gets that placement right. My migration's
`create extension if not exists postgis;` then finds it already present and does
nothing — it is there so the file is self-contained for a future clean project,
not because you should rely on it.

### 2b. Run the migration

**SQL Editor → New query**. Paste the entire contents of
`supabase/migrations/0001_phase0_init.sql`. **Run**.

Expected result: *"Success. No rows returned."*

### 2c. Verify, don't assume

Three checks, in the dashboard:

1. **Table Editor** — `worlds` and `markers` both exist.
2. **Database → Functions** — `markers_near` and `generate_join_code` are listed.
3. **Table Editor → the RLS indicator on each table** — both tables show **RLS
   enabled**, with two `phase0_dev_*` policies between them.

If check 3 shows RLS *disabled* on either table, stop and tell me. Everything
downstream assumes the table is shut and the RPC is the only door.

### What the migration actually set up, in one paragraph

`markers.location` is `geography(Point, 4326)` with a GIST index, so "everything
within 500 m" is one indexed lookup rather than Haversine over every row on the
phone. `markers_near` is `SECURITY DEFINER`, meaning it runs with the function
owner's rights and can read the table even though your clients cannot — that is
the §4 seam in one keyword. The `version` column auto-increments through a
trigger on every update, so a stale editor's `where version = $n` matches zero
rows and you find out you lost the race instead of silently overwriting someone.

---

## Step 3 — Seed one world and one marker by hand

Before any web page exists, prove the database works on its own.

**Verified already, so you can skip worrying about it:** the project URL, the anon
key, the `markers_near` grant and the RLS setup were all tested from outside the
dashboard on 2026-08-26 and work. If something fails below, it is the SQL in
front of you, not the project setup.

### 3a. Get a real coordinate

1. Open **google.com/maps**.
2. Find the building you want the marker to stand on. Zoom in far enough that
   individual buildings are distinguishable.
3. **Right-click exactly on the building's facade** — the wall you will be
   looking at when you hold the phone up.
4. The **very top item** of the menu that opens is two numbers, like
   `42.484200, 26.503500`. That top item is a button.
5. **Left-click it.** The pair is now on your clipboard.
6. Paste it into Notepad. **The first number is latitude, the second is
   longitude.** Write that down next to them; you will need to know which is
   which twice more.

Choosing the spot matters more than the precision does:

- **Somewhere you can physically walk to**, because step 7 means standing there.
- **Open sky and visible building facades.** ARCore localizes against Google's
  imagery of the streetscape. A courtyard, a narrow alley or heavy tree cover
  makes the field test fail for reasons that have nothing to do with your code.
- **Not your own home**, if you would rather not have your address in a database
  you may later make public.

### 3b. Insert the world

1. In the Supabase dashboard, click **SQL Editor** in the left sidebar.
2. Click **+ New query**.
3. Paste this exactly as it is — nothing in it needs editing:

```sql
insert into public.worlds (name, join_code, mode, status, default_language)
values ('Yambol Test', public.generate_join_code(6), 'guide', 'published', 'bg')
returning id, join_code;
```

4. Press **Ctrl + Enter**, or click the green **Run** button at the bottom right.
5. A results table appears underneath with two columns, `id` and `join_code`.
6. **Copy the `id` value.** It is a UUID — 36 characters with dashes, like
   `3f2a9c14-8b7e-4d21-9f60-1c5e7a8b2d33`. Click the cell to select the text.
7. Paste it into Notepad under your coordinate.

The `join_code` is a six-character code from the ambiguity-free alphabet — no
`O`/`0`, no `I`/`1`/`l`. Nothing uses it yet; Phase 3 is where the app asks for
it. Worth keeping anyway.

### 3c. Insert the marker

1. **+ New query** again (or select all in the editor and overwrite).
2. Paste this:

```sql
insert into public.markers (world_id, location, style_key, colour_hex, content, status)
values (
  'PASTE-THE-WORLD-UUID-HERE',
  st_makepoint(LONGITUDE, LATITUDE)::geography,
  'default',
  '#45C4B0',
  '{"bg": {"title": "Безистен", "body": "Тест маркер."},
    "en": {"title": "Bezisten", "body": "Test marker."}}'::jsonb,
  'published'
);
```

3. **Replace three things:**
   - `PASTE-THE-WORLD-UUID-HERE` → the uuid from 3b. **Keep the single quotes.**
   - `LONGITUDE` → your **second** number.
   - `LATITUDE` → your **first** number.

   There are no quotes around the two numbers. If you accidentally leave them in,
   Postgres will tell you so rather than doing something silently wrong.

4. Run it. Expected: **"Success. No rows returned."**

#### The coordinate-order trap — the one that will actually get you

**Google Maps gives you `lat, lng`. PostGIS `st_makepoint` takes `lng, lat`.**

They are backwards from each other. In Bulgaria latitude is about `42` and
longitude about `26`, so a swap is easy to spot: if the first number inside
`st_makepoint` starts with a 4, you have swapped them.

Swap them and the marker lands in Somalia, the RPC returns nothing because you
are three thousand kilometres outside the radius, and you will spend an hour
suspecting ARCore. Say "lng, lat" out loud every time you type `st_makepoint`.

### 3d. Verify it came back

New query, paste, replace the uuid, and note that **this one takes lat first** —
the RPC signature is in human order on purpose, precisely because `st_makepoint`
is not:

```sql
select * from public.markers_near(
  'PASTE-THE-WORLD-UUID-HERE',
  LATITUDE,
  LONGITUDE,
  500
);
```

**Expected: exactly one row, with `distance_m` very close to 0.** That row is
byte-for-byte what the phone will receive.

Zero rows means one of three things, in order of likelihood:

1. **You swapped lng/lat** in 3c. Check the marker: run
   `select st_astext(location) from public.markers;` — it prints
   `POINT(26.5 42.48)`, longitude first. If it says `POINT(42.48 26.5)`, that is
   the bug.
2. **`status` is not `published`.** The RPC filters drafts out by design.
3. **The world uuid does not match** between 3b and 3c.

### 3e. The verification that actually counts

The SQL Editor runs with elevated database privileges. **It proves the data is
there; it does not prove the phone can reach it.** Those are different questions
— the phone arrives as `anon`, through PostgREST, subject to RLS and function
grants.

Tell me when 3a–3d are done and I will call `markers_near` from outside the
dashboard with the anon key, exactly as the app will. That is the check that
matters before you build anything to a device.

## Step 4 — The throwaway insert page

`web/index.html` — one file, no build step, no framework. MapLibre and
supabase-js load from CDN. It shows a map, you click, it writes a row.

It is called throwaway because it is: it has no auth, no validation, no styling
worth keeping, and it dies the moment Phase 2's real editor exists. Its entire
job is to prove that a browser click becomes a row.

**Serving it:** Python is on your machine, so from the `web` folder:

```
python -m http.server 8080
```

then open `http://localhost:8080`. You can also just double-click the file —
Supabase's API allows any origin — but the local server is closer to reality and
costs nothing.

**Configuration:** copy `web/config.example.js` to `web/config.local.js` and
paste your project URL and anon key. `config.local.js` is already in
`.gitignore`, so your keys never reach GitHub even though they would be harmless
there.

---

## Step 5 — Open the Unity fork and clear the inherited traps

The fork is at `C:\Users\zalex\ARTrail`. It has never been opened.

### 5a. First open

Unity Hub → **Add** → **Add project from disk** → `C:\Users\zalex\ARTrail` →
open it with **6000.4.10f1** (already installed — do not let the Hub upgrade it).

**This first import will take a long time — 10 to 30 minutes.** I deliberately
did not copy the 13 GB `Library` folder, so Unity is rebuilding every shader,
texture and script from scratch. That is normal and it is a one-time cost. Do
not touch anything while the progress bar moves.

### 5b. Expect exactly one error, and it is a good one

When `Main.unity` opens, a GameObject named **`Cesium3DTileset`** will have a
**missing script**, because I removed the Cesium package from `manifest.json`.

This is intended. Handbook §13 predicted it and I verified it: not one C# file
in your project references Cesium. It existed only for the Geospatial Creator's
editor-time globe preview, and this project has no editor-time placement — every
marker is spawned at runtime from the backend.

**Delete that GameObject. Save the scene.**

What you get for it: the fragile 338 MB tarball dependency on your Desktop is no
longer required to open this project, and the `CesiumDefaultTilesetShader`
build-time trap (§13, ~36 billion shader variants, "out of memory" on Android
build) can never fire here.

### 5c. Check the three traps that bite before you notice them

These cost real time on the previous project. Verify each now, while you have
the Editor open and nothing is at stake.

1. **AR Background Renderer Feature — the yellow screen.**
   `Assets/Settings` → click each **Renderer** asset (there is usually more than
   one — a Mobile one and a PC one). In the Inspector, the **Renderer Features**
   list must contain **AR Background Renderer Feature**. §13: it must be on
   **both**. Missing it means the camera feed never draws and the device shows a
   flat yellow screen, with no error to tell you why.

2. **Active Input Handling must stay `Both`.**
   **Edit → Project Settings → Player → Other Settings → Active Input Handling**.
   It must read **Both**. §12 settled this after extensive debugging: 3D object
   picking uses legacy `Input`, the UI uses the new system, and both have to be
   live. Do not "clean this up".

3. **`Assets/Plugins/Android` must exist.**
   Check the Project window. If it does not, create the folder. EDM4U copies
   Gradle dependencies into it during a build and throws
   `DirectoryNotFoundException` if it is absent — an error that reads like a
   Gradle problem and is not one.

### 5d. Confirm it compiles

The Console should show **no red errors** after import settles. Yellow warnings
are fine. If you see `CS0234` about the InputSystem namespace, that is §13's
package-cache corruption: close Unity, delete **only** `Library/PackageCache`,
reopen.

### 5e. The API key question — do this before you build

Open **Edit → Project Settings → XR Plug-in Management → ARCore Extensions**.
There is an **Android API Key** field, already filled in — the fork inherited
your working key from the AR building app.

Go to Google Cloud Console → **APIs & Services → Credentials** → click that key →
look at **Application restrictions**.

- If it says **None** — you are fine, it will work for the fork as-is.
- If it says **Android apps** with a package name listed — **it will not work for
  the fork**, because the fork's package is now `com.alex.artrail.dev`. Add a
  second entry: package `com.alex.artrail.dev` plus your debug keystore's SHA-1
  fingerprint.

Why this deserves a step of its own: a restricted key does not produce a clear
error. Geospatial simply never localizes. On the street that is indistinguishable
from poor VPS coverage, bad weather, or standing too close to a wall — and you
will blame Yambol instead of a checkbox.

To get the debug SHA-1, in PowerShell:

```
keytool -list -v -keystore "$env:USERPROFILE\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android
```

---

## Step 6 — The swap: one new file

**This is the part that is much smaller than the handbook assumes**, and it is
because of how you built the AR building app.

I read the code. The picture:

```
RemoteBuildingSource  ──►  BuildingDatabase.SetBuildings(List<BuildingData>)
                                     │
                                     ├──► MarkerSpawner reads AllBuildings
                                     ├──► Search / Settings / InfoPanel read it
                                     └──► everything else reads it
```

`BuildingDatabase.SetBuildings()` is a **single static injection point**, and
`MarkerSpawner` never talks to the source at all — it only reads the database and
listens to `OnBuildingsChanged`.

So Phase 0's Unity work is:

1. **Add one new file**, `RemoteMarkerSource.cs`, which fetches from the RPC
   instead of the CSV and calls the same `BuildingDatabase.SetBuildings()`.
2. **In the scene**, disable the `RemoteBuildingSource` component and add
   `RemoteMarkerSource` in its place.

That is the whole change. `MarkerSpawner`, `OcclusionService`,
`InfoPanelController`, `CubeTapManager`, the tab UI, the theming — none of it is
touched. This is the runtime-`CreateInstance` ScriptableObject pattern paying out
exactly as §2 says it would.

### What I deliberately will NOT do in Phase 0

- **Not renaming `BuildingData` to `MarkerData`.** That rename touches a dozen
  files for zero behavioural gain, and Phase 0's job is to answer one question.
  It belongs in Phase 3 when the info panel becomes `content`-jsonb-driven.
- **Not deleting `RemoteBuildingSource` or `CsvParser`.** Disabled, not deleted.
  If the new path misbehaves you can re-enable the old one in one click and know
  instantly whether the problem is the backend or the AR.
- **Not touching the info panel.** For Phase 0 the marker's title and body map
  onto the existing name/description fields. Good enough to prove a marker is the
  right marker.

### How the new source works

Same three-tier behaviour as `RemoteBuildingSource`, because it is already
correct (§4):

1. `Start` → publish the cached JSON from `persistentDataPath` immediately.
2. Fetch from the RPC → publish and overwrite the cache.
3. Fetch fails → stay silent, keep what is loaded.
4. Refetch on resume, rate-limited.

The request itself:

```
POST https://<project>.supabase.co/rest/v1/rpc/markers_near
apikey: <anon key>
Authorization: Bearer <anon key>
Content-Type: application/json

{"p_world_id":"...","p_lat":42.4842,"p_lng":26.5035,"p_radius_m":500}
```

Three rules carried over from the old source, all still load-bearing:

- **Parse every coordinate with `CultureInfo.InvariantCulture`.** On a phone set
  to Bulgarian, current culture reads `.` as a thousands separator and turns
  `42.48` into `4248`. This is in §13 because it has already happened once.
- **Validate the response shape before trusting it.** The old source checked that
  the CSV did not start with `<`, because an unshared sheet returned an HTML
  error page with HTTP 200. An API behind a captive portal or a proxy does the
  same thing. Check the content type and the shape, not the status code.
- **Send coordinates from `UserLocationService`, not a constant.** The RPC is
  radius-based; it needs to know where the phone is.

One Phase-0-specific wrinkle: the app has no world picker yet, so the world id
goes in an Inspector field on the component. Phase 3 replaces that with the join
code entry screen.

---

## Step 7 — Walk outside

Build to the phone (**File → Build Settings → Android → Build and Run**), then go
stand near the coordinate you seeded.

### What should happen

1. The app opens straight into the camera feed with the **Ready State** panel
   over it. The AR session runs from launch and is never paused (§8) — pausing it
   stops Geospatial localization, which is the exact thing the panel is waiting
   for.
2. The VPS status readout climbs. Localization typically takes several seconds
   outdoors with sky visible and buildings in frame. **Point the phone at
   buildings, not at the ground or the sky.**
3. The panel clears, and the marker appears — standing 1.5 m above the ground at
   your coordinate, height resolved by ARCore against real terrain, which is why
   no marker in this entire system ever carries an altitude (§9).

### If it does not appear

Diagnose in this order — the cheap checks first:

1. **Did the fetch succeed?** Check the debug overlay / logcat for the marker
   count. If it is 0, the problem is the backend or the network, and you have not
   reached AR at all.
2. **Is Earth tracking actually tracking?** `GeospatialDebugOverlay` shows the
   state and accuracy. If accuracy is tens of metres, you are not localized —
   walk into more open street view and wait.
3. **Terrain anchor resolution failing is expected, not exceptional** (§8). It
   fails indoors, under heavy tree cover, and before Earth tracking settles. The
   next sync retries. Give it a minute of walking before concluding anything.
4. **Marker in the wrong place entirely?** §13: the project-level Geospatial
   checkbox is not the same thing as the session config. Confirm
   `ARCoreExtensionsConfig` has `GeospatialMode = Enabled` and is linked to the
   ARCore Extensions object in the scene.
5. **Yellow screen?** Step 5c trap 1. You missed a renderer.

### Do not test through a window

Geospatial needs sky and real building geometry. Indoors it will not localize,
and that is not a bug to debug.

---

## What Phase 0 is not

No auth. No join codes in the app. No world list. No roles, no RLS policies worth
the name, no editor UI, no moderation, no modes. The two `phase0_dev_*` policies
let anyone with the anon key write anything, which is fine for a project only you
know the URL of and is the first thing Phase 1 deletes.

When the marker is standing on the right building, update the handbook's status
line — it currently says nothing has been verified against running code — and
Phase 1 starts.
