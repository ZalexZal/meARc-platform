# Phase 2 — the app UI

> **Built 2026-08-29. Map confirmed on device 2026-08-30.**
>
> Walked in Yambol: OpenStreetMap tiles load and align, markers appear at the
> places they were dropped, and the reader's dot tracks correctly as they move.
>
> That validates the part most likely to have been silently wrong. Pins and tiles
> are placed by two different code paths that both go through `MapView.Project`
> in metres; if that projection were off, the markers would have drifted from
> their buildings as the map panned. They did not.
>
> Not yet exercised on device: the camera tab, guidance across the map/camera
> switch, the compass-driven edge pills, proximity alerts, the first-run
> walkthrough, and light mode.

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

OpenStreetMap raster tiles under the markers.

Tiles are placed by projecting each tile's own north-west and south-east corners
through `MapView.Project` — the same call the pins go through. That is what keeps
a pin over the right building: both answers come from the same question in the
same units, rather than one being in metres and the other in a tile grid.

- North up. Pins sit at their true bearing and true distance.
- Pan by dragging, zoom by pinching, and a **Recentre** control that appears only
  once the reader has moved away.
- Every tile is cached to disk on first sight, so a street walked once works with
  no signal afterwards.
- Inverted for the dark theme, once per tile at decode time. A white map behind
  dark chrome glares at night and washes out in sun.
- The reader's dot has a white outer ring in both themes. Over a dark map a dark
  halo is no halo, and this is the one mark on screen that must never be hard to
  find.
- A scale bar and two distance rings, because a tile of a town centre still does
  not answer "how far is that".
- Guidance draws a straight ray to the target. **Not a route** — the app does not
  know the streets, and pretending it did would send someone into a wall.
- Pins are named while there are eight or fewer; past that only the selected one
  keeps its label.

> **Before release.** `MapTileLayer.urlTemplate` points at
> `tile.openstreetmap.org`. Their [tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
> forbids that for a released app — it is fine for development at this volume and
> nothing more. Shipping means pointing it at MapTiler, Thunderforest, Stadia or a
> self-hosted renderer. It is one string, deliberately. The attribution line is
> already on screen and is required whichever provider you use.

## Icons

Fourteen icons, rasterized from signed distance fields in a 24×24 box — the same
box Material and Lucide use, so weights and proportions are comparable rather than
invented per icon.

They are drawn rather than typed because the font atlas carries Latin and Cyrillic
and nothing else; a Material Icons glyph renders as an empty box on device. The
first attempt assembled them from stacked rectangles and circles in the builder,
and the camera came out looking like an apple — a round body with a stem off to
one side. Shapes assembled by eye do that.

Every shape was rendered and checked before it shipped.

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

## Performance

The first build was laggy, and the map was not the reason.

`MapView` laid itself out every frame, writing colours, sizes and positions
whether or not anything had moved. A uGUI canvas rebuilds and re-batches **in
full** whenever any element on it is dirtied, and setting a colour marks it dirty
even when the value is unchanged — so every frame was rebuilding all four panels,
the nav bar and the marker sheet. `BearingArrow` did the same on every arrow, and
`TapFeedback` wrote a CanvasGroup alpha every frame on every disabled button.

| Change | Why |
|---|---|
| Nothing is written unless the value changed | The single largest cost. Unchanged writes still rebuild the canvas. |
| Layout runs only when something asks for it | `MarkDirty()` on pose, pan, zoom, theme, guidance. Standing still costs nothing. |
| The map has its own nested canvas | Panning no longer re-batches the chrome. It needed its own `GraphicRaycaster` too — a graphic registers against its nearest canvas, so the split would otherwise have cost every tap on the map. |
| Arrows tick at 4 Hz, not 60 | A walking reader turns far slower than sixty hertz. |
| The camera feed stops blitting off-tab | A full-screen texture drawn every frame behind an opaque panel. The session stays up; localization is the slow part. |
| Tile textures capped at 96 | About 25 MB, on a phone also running an AR session. |

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

1. **Which tile provider ships?** See the box under The map. This is the one
   decision that has to happen before anyone but you installs the app.
2. **Copy.** The strings still say "buildings" in places where the data model has
   become markers. Worth a pass in both languages.
