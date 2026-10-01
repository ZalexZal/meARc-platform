# Creators' own 3D models at a stop

*Design, 1 October 2026. Approved in conversation, section by section. Roadmap
phase 9, after the five built-in shapes of version 9.*

## Purpose

A creator can put their own 3D model on a stop, the same way they add a photo
today, and walkers see it standing in the street at that spot.

What the operator decided:

| Question | Decision |
|---|---|
| What kind of models | Objects at human scale: a statue, an artefact, a sign, a character. Fits within a few metres. |
| Who may upload | Any creator, on their own trails, under the same rules as photos. Reviewed when a trail asks to be listed publicly; code-only trails are not reviewed. |
| Largest model | 25 MB |
| When the phone downloads | When the trail is joined |
| Animations | The first animation loops |
| Credit | Required: "I made it", or author + licence + link, shown on the stop |

Success: a creator uploads a GLB from Blender or Sketchfab in the editor, sees
it, sizes and turns it, saves; a walker who joins the trail finds it standing on
the ground at the stop, at the right size, facing the right way, animated, with
its credit on the stop's page.

## Approach

GLB files (binary glTF 2.0), checked in the browser on upload, stored like
photos, and loaded by the app at runtime with Unity's glTFast.

Rejected:

- Converting uploads to Unity AssetBundles on a server: needs a machine running
  Unity per upload. Not possible on Supabase Free.
- Handing the model to Google's Scene Viewer: no Geospatial placement, so the
  model is no longer at the stop.

## 1. What is stored and checked

**Format.** `.glb` only. `KHR_draco_mesh_compression`, `EXT_meshopt_compression`
and `KHR_texture_basisu` are refused with "export without compression": each
needs a native decoder in the app, which puts the Play requirement for 16 KB
page alignment at risk. They can be added later.

**Checks, in the browser, before upload.** Nothing that fails is uploaded.

| Check | Limit | Message names |
|---|---|---|
| File is GLB | magic `glTF`, version 2, JSON chunk first | "not a GLB file" |
| Size | 25 MB | the size and the limit |
| Triangles | 300,000 (sum over triangle primitives; non-indexed counts POSITION/3) | the count and the limit |
| Texture size | longest side 4096 px (PNG IHDR, JPEG SOF read from the embedded images) | the image's size |
| Extensions | `extensionsRequired` only from the list the app can draw (`KHR_materials_*`, `KHR_texture_transform`, `KHR_mesh_quantization`, `KHR_materials_unlit`) | the extension |
| External files | every buffer and image embedded (no `uri` other than none) | "the textures must be inside the file" |

Animated = the file has at least one animation.

**Stored like photos.** Same `marker-media` bucket, path
`<trail>/<stop>/model-<uuid>.glb`, content type `model/gltf-binary`. Counted
against the trail's 200 MB. Deleted with the stop, the trail and the account.

**Saved with the model:**

- height in metres, starting at the model's bounding-box height, 0.2–10 m;
- facing, 0–359° from true north;
- animated;
- triangles and bytes, for Review;
- credit: source `own` or `other`; for `other`, author (required, ≤120),
  licence (CC0, CC BY 4.0, CC BY-SA 4.0, or other text ≤60), link (required,
  https, ≤300).

**On the stop:** `style_key = 'model'`, a sixth shape after pin, sphere, cone,
cube and sign.

## 2. Website, server, Review

### Editor

Basics tab, shape picker, "3D model":

- Choose a `.glb`. The checks above run at once and say exactly what failed.
- A 3D preview (Google's `<model-viewer>`, bundled from npm so it stays inside
  the Content-Security-Policy) the creator can turn.
- Height (m), starting at the model's own; facing, a compass control with
  N/E/S/W that turns the preview.
- Credit, required as above, and one tick box: "I have the right to use this
  model, and it may be shown to everyone who walks this trail."
- Save uploads, then writes the row. Replacing a model deletes the old file.
- The spreadsheet import cannot carry a file: `shape = model` there is refused
  with "add the model in the editor".

### Server, migration 0055

- `markers_style_key_known` accepts `'model'`.
- Table `marker_models`: `marker_id` (primary key, references markers, on
  delete cascade), `path`, `bytes`, `triangles`, `height_m` (0.2–10),
  `heading_deg` (0–359), `animated`, `credit_source` (`own`|`other`),
  `credit_author`, `credit_licence`, `credit_link`, `created_at`, `updated_at`.
  Row-level security as `marker_media`: read where the stop can be read, write
  where the stop can be edited (`may_edit`). Consent guard as for other
  creator writes.
- 25 MB enforced on the server: an insert/update trigger reads the object's
  size from `storage.objects` and refuses anything larger, or a path outside
  the stop's own folder.
- The bucket's allowed types gain `model/gltf-binary`.
- `trail_models(p_world)`: one row per model stop the caller may see, with the
  same visibility as `markers_near` (published, or draft for owner/editors;
  "reveal one at a time" hides what is not yet revealed). Returns the public
  URL, bytes, `updated_at` (the cache key), height, facing, animated and credit.
- `export_user_data` gains the models' metadata. Removal follows the existing
  media removal path (0026), which already covers the whole trail folder.

### Review

A trail in the listing queue shows each model in the same preview with its
credit, so content and licence are checked before approval. Reports on a model
stop work as on any stop.

## 3. The app

### Getting the models

- Package `com.unity.cloud.gltfast` (Unity's runtime glTF loader). No Draco or
  KTX add-on packages. The APK's 16 KB alignment check runs after it is added.
- On joining a trail, on selecting one already joined, and whenever the trail's
  stops change (a stop revealed, a model replaced), `ModelCache` calls
  `trail_models` and downloads the files it does not have, one at a time, to
  `persistentDataPath/models/<stop>-<updated_at>.glb`.
- A card shows progress ("3 models · 34 MB"); it can be hidden (the download
  continues) or stopped.
- More than 50 MB in total while on mobile data: ask first, "Download now" or
  "On Wi-Fi".
- Kept while the trail is joined; leaving a trail deletes its models. Everything
  together is capped at 500 MB: past that, the oldest files of trails other
  than the one being walked go first, and the walked trail's never do.

### In the street

- On the ground at the stop: the terrain anchor at 0 m, not the markers'
  1.5 m. Scaled so the model's bounding box is `height_m` tall, turned to
  `heading_deg` from true north. Not tinted, not billboarded. The pale ring at
  its feet, as on every shape.
- Within 60 m: the model at real size. Farther: the pin, swapping as the walker
  crosses 60 m.
- The first animation loops while the model is visible, and pauses when it is
  off screen or hidden behind a building.
- Not yet downloaded, or the file fails to load: the pin.
- Tapping the model opens the stop. The stop's page shows the credit
  ("3D model: Statue by X · CC BY 4.0"); the link opens in the browser.

### Capture mode

Move works on a model stop as on any other. The Shape button is hidden there:
the model is chosen on the website, and cycling shapes would throw it away.

## Law and terms

- Terms of use: a creator may only upload a model they made or may share, and
  must credit it as its licence requires. Models are content like photos, under
  the same reporting and removal rules.
- Privacy policy: nothing new is collected from walkers. A creator's model and
  credit are kept like their photos and deleted with them.
- Records of processing and Play's Data safety: unchanged (user-generated
  content is already declared).

## Testing

- Upload checks: unit tests with real sample files: a valid animated GLB, a
  Draco-compressed one, one over 300,000 triangles, one with an 8192 px
  texture, one with external textures, and a file that is not a GLB.
- Migration 0055: row-level security for owner, editor, member and stranger; the
  25 MB trigger; `trail_models` hiding drafts and unrevealed stops.
- Editor: Playwright uploads a sample model, checks the preview and the
  messages, saves, reloads.
- App: `MarkerPreview` renders an animated sample GLB through glTFast; then a
  walk in the street.

## Out of scope

- Draco, meshopt and KTX2 compression.
- Life-size reconstructions (buildings, walls): larger files, exact placement.
- Turning or resizing a model from the camera.
- A shared starter library curated by the operator.
- Models in the spreadsheet import.
