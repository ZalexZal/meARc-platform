# Phase 2 — the app UI

> **Built 2026-08-29.** Compiles clean against Unity 6000.4.10f1. Not yet run on device.

This is the Glass Trail concept from the approved prototype, built into the Unity
app. It replaces the three-tab Camera / Search / Settings shell.

## How to see it

Open `ARTrail/Assets/Scenes/Main.unity`, then **Tools ▸ UI ▸ Build App UI**.

The builder now owns everything under the Canvas: it deletes what it made last
time and makes it again. That is the whole screen, from one menu item, with no
hand-wiring left to lose. `Tools ▸ UI ▸ Lay Out App UI` is gone — it existed to
style a hand-made scene, and there is no longer a hand-made scene.

It never touches the AR side: XR Origin, AR Session, ARCore Extensions, the Main
Camera and the anchors are left exactly as they are. The one exception is
switching Streetscape Geometry on in the extensions config, which it already did.

## The shape

**Three tabs, in the order the walk happens: Map, Camera, Settings.**

The app opens on the **Map**. That is the point of the whole rework. A camera
that opens itself is pointed at whatever the phone happened to be over, and it
asks for the one permission the reader has no reason to grant yet. A map answers
"what is around me" without asking for anything.

**Browse** — the searchable list with its era and type filters and the discovery
card — is a fourth panel with no tab of its own. It belongs to Map: the map
answers what is around you, browse answers what exists. Giving it a tab would put
a fourth thing in a bar whose job is to be readable at a glance while walking.
It is reached from the map's bottom panel and has a Back to map button of its own.

## The map

Drawn, not tiled. Nothing is fetched, so it works with no signal and costs nothing
to render. The price is no streets; it is paid back by a scale bar and two
distance rings around the reader, which answer "how far is that" more directly
than a tile of a town centre at 200 m does.

- North up. Pins sit at their true bearing and true distance.
- Pan by dragging, zoom by pinching, and a **Recentre** control that appears only
  once the reader has moved away — it is labelled, not icon-only, because
  recentring has no universally read symbol and this is the worst moment to make
  someone guess.
- The reader's dot carries an accuracy circle at the reported horizontal accuracy,
  so the map shows how much it is guessing.
- Guidance draws a straight ray to the target. **Not a route** — the app does not
  know the streets, and pretending it did would send someone into a wall.
- Pins are named while there are eight or fewer; past that only the selected one
  keeps its label, because two names crossing each other are worse than none.

The projection is a local east/north offset in metres scaled to pixels.
Swapping in raster tiles later means adding a tile layer under the content and
leaving the rest of `MapView` alone, because pins are placed from metres, not
from a tile's pixel grid.

## Guide me there

`GuidanceService` is static, so the target survives the switch between map and
camera. That was the claim the first prototype made and did not keep. The same
`GuidanceBanner` component renders it on both screens, reading the same state.

Below 15 m the arrow is replaced by a filled dot and the distance reads
"You have arrived" — at a few paces a direction is noise, and pointing
confidently at nothing is worse than admitting you got there.

## The camera

No gate. The Ready State is deleted: it existed so the app would not open on a
camera, and the map now does that job. Calibration is still told truthfully — by
the dot in the corner and by a banner when accuracy is poor — but it decides what
the reader will see, never whether they may look.

- **Edge pills** name the nearest marker off to the left and off to the right.
  A camera view is a window sixty degrees wide onto a world that is three hundred
  and sixty; without these, a reader standing among four markers sees an empty
  street and concludes the app is broken. Driven by compass bearing, so they work
  before any anchor has resolved.
- A **dock** at the bottom names the marker the chrome is talking about, with its
  colour, its bearing and its distance. Tapping it opens the sheet.
- Everything over the feed sits on a solid surface, never on glass. A camera feed
  is the one background the app does not control, and translucent chrome over it
  is unreadable roughly half the time.

## The marker sheet

Built at the Canvas root, not inside a tab, because it is reachable from the map,
the camera and the browse list. It carries the marker's own colour beside its
name, its distance and bearing, **Guide me there** as the primary action, and
Learn more and **Hide this marker** underneath.

## Hidden markers

Anyone can publish a marker onto a public street, so the reader needs a way to
make one go away that does not depend on anybody agreeing with them.

`HiddenMarkers` is local and immediate: no account, no connection, no moderator,
and it takes effect on the next frame rather than the next review. Settings ▸
Privacy shows the count and offers Show all again — and offers nothing when
nothing is hidden. When accounts land this becomes the local half of a
server-side block; the stored ids are the same ids.

## States

One `StateCardView` with five configurations rather than five screens: locating,
loading, nothing nearby, load failed, offline. The action button is hidden
outright when there is nothing useful to press — that is the difference between
an empty state and a dead end. Retry bypasses the fetch throttle, because
answering "not yet" to a button press is how a retry button earns a reputation
for doing nothing.

## Measured, not eyeballed

| What | Was | Now |
|---|---|---|
| TextMuted on Surface, dark | 3.77:1 | 4.9:1 (`#8E959F`) |
| TextMuted on white, light | 3.98:1 | 5.9:1 (`#5F656D`) |
| Smallest touch target | 64 ref px, about 24dp | 128 ref px, 48dp |
| Smallest text | 26 ref px, about 10dp | 32 ref px, about 12dp |
| Notch and gesture bar | ignored | `SafeAreaPad` on content; backgrounds still full-bleed |

Reference resolution is 1080×1920, matched on width, which is about 2.6 reference
pixels per dp on a typical phone. That ratio is why the touch target constant is
128 and not 48.

Marker colours are chosen by whoever made the trail, so they can land anywhere —
including exactly on the app's own teal. Separation is carried by a ring drawn
around every dot in whichever of white or near-black contrasts more with the
marker itself, not by the marker colour. That is what keeps a teal pin legible on
a teal-accented map.

## Proximity alerts

`ProximityAlerts` fires when the reader walks within 60 m of a marker they have
not read yet, and rearms at 110 m so standing on the boundary does not chime
repeatedly. `ProximityToast` slides a card in on any tab; tapping it opens the
marker, which is where **Guide me there** already lives.

This is the in-app half, and the setting says so under it. A notification while
the app is *closed* needs Unity's mobile notifications package, Android
background location permission and a foreground service to hold a fix — a
separate piece of work, not a line in this one.

## The walkthrough

`TutorialFlow`: four cards on first run, skippable, replayable from Settings.
It explains the two things nothing else can — that markers are pinned to real
coordinates rather than floating in front of the camera, and that the camera is
somewhere the reader goes rather than something the app does to them. The
progress dot carries position by width as well as colour.

## Deliberately not built

- **Welcome, terms and join-code screens.** They need accounts and the
  `join_world(code)` RPC, which is Phase 1. Building them now would mean shipping
  buttons that do nothing.
- **Report a marker.** Decided against for v1 on 2026-08-29: hiding already
  solves the reader's actual problem, and reporting only starts to matter once
  strangers are publishing markers. Revisit with the portal.

## Open questions

1. **Does the drawn map stay?** Raster tiles are a drop-in under the content
   layer. Recommendation on 2026-08-29 was to judge it on device in Yambol
   first — that is a twenty-minute test against a multi-day build, and the thing
   that would flip it is specific: whether you can tell which side of a street a
   marker is on.
2. **Copy.** The strings still say "buildings" in places where the data model has
   become markers. Worth a pass in both languages.
