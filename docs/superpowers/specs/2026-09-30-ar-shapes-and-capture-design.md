# AR shapes and capture mode (version 9): design

Asked for by the operator on 2026-09-29: "a couple of simple shapes that can be
picked from the editor and appear in the real world", "canvases people can type
on", and capture mode integrated properly. The operator delegated the details
for the night; these are the choices made.

## Shapes

Five, all generated from code (no artist, no downloads). Each stands on the
same flat ring, which is what shows where the stop is:

| Key | Looks like | Tinted |
|---|---|---|
| `default` / `pin` | the existing pin on a ring | the head |
| `sphere` | a ball hovering over the ring | the ball |
| `cone` | a traffic cone | the cone |
| `cube` | a box resting on the ring | the box |
| `sign` | a board on a short post, with text the creator types, turned to face the reader | the frame; the face is white with dark text |

- **Database (0054):**
  - `markers.style_key` may only be one of these, or null (a check
    constraint that phase 9's uploaded models will widen).
  - The sign's words live in `content.<lang>.sign`, at most 80 characters, so
    they are translated like everything else.
- **Website editor:** a "Shape in the camera" picker under the colour, with
  sign-text fields (BG and EN) that appear only for Sign. Saved with the rest
  of the stop, under the same version check.
- **App:**
  - One prefab per shape, filled into `MarkerSpawner.styles`, which existed
    and was never filled.
  - `MarkerView.SetSign` writes the text; a sign with no text shows the stop's
    name.
  - An unknown key falls back to the pin.
- **Checked by:** `MarkerPreview` photographing every shape, a database test,
  a website test of the picker, and a seam check that a shape and its sign
  text reach the app.

## Capture mode, completed

It could already move one of your stops, by one-metre nudges or "put it where
I'm standing", then save. Now:

1. **Add a stop here.** In the camera, for the owner and editors of the open
   trail. It creates the stop at the phone's position (the camera's own pose
   when AR is tracking, otherwise GPS if it's good to 12 m), as a **draft**
   named "New stop", and goes straight into Move.
2. **Shape** in the capture bar cycles through the five shapes. The marker in
   the camera changes at once, and the choice is saved.
3. **Drafts are visible to the trail's owner and editors** (`markers_near`
   now includes them for those roles and returns `status`). Walkers never see
   them. Saving the stop on the website publishes it, as it always has.

Refused, as elsewhere:
- a faked position;
- a fix worse than 12 m;
- more than 200 stops a day (the existing rate limit).

## Not in this version

- The creator's own 3D models (phase 9).
- Choosing a shape per trail.
- Showing the shape on the map (the map keeps the pin).
- Writing a stop's text from the phone: the website does that better, and the
  draft waits there for it.
