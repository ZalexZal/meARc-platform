# Design decisions — creator portal and app

Answers given by Alex on 2026-08-26, with their consequences. These close several
of the handbook's §16 open questions and add constraints the portal must be built
against from the first line, not retrofitted.

---

## The decisions

| # | Question | Answer |
|---|---|---|
| 1 | Who creates? | Alex only. No other creators for now. |
| 2 | Portal devices | Mobile **and** desktop browser. Create from anywhere. |
| 3 | Languages | Bulgarian and English, in both portal and app. |
| 4 | Landing page | Yes — leads to downloading the app. |
| 5 | Aesthetic | Portal and app share one design language. |
| 6 | Map base | Standard street map, not satellite. |
| 7 | Dark mode | Yes. Light and dark, both products. |
| 8 | Brand | No logo, no name yet. Accent: **Teal** (`#0F7A6B` / `#45C4B0`). |
| 9 | References | None. |

---

## What each one costs, and what it changes

### 1. Alex is the only creator — for now

This is the most load-bearing answer here, and it is worth being explicit about
what it does and does not license.

**It does not mean skip auth or RLS.** The handbook's §10 moderation surface, the
approval queue and the role model all exist because the platform is designed for
open signup, and Phase 1 still builds them. Building single-tenant now and
multi-tenant later means writing the app twice.

**It does mean the interface can be dense.** No onboarding tour, no empty-state
hand-holding, no progressive disclosure protecting a novice from options. One
expert user who wrote the handbook does not need a wizard. This saves real work
in Phase 2 and is trivially reversible later — adding hand-holding to a dense
tool is much easier than extracting a dense tool from a wizard.

### 2. Mobile and desktop browser — with one precision caveat

The portal is responsive. Two layouts over one codebase:

- **Desktop** — map fills the window, marker list docked left, editor panel right.
- **Mobile** — map fills the screen, editor rises as a bottom sheet over it. This
  mirrors the app's existing `SheetAnimator` behaviour, which is the point.

**The caveat, and it is a real one.** A phone browser standing on the actual
street is *not* a precision placement tool. Browser geolocation is GPS, accurate
to roughly 5–20 m, which is **worse** than clicking the right rooftop on a map at
a desk. Handbook §9 is unambiguous: a web map produces a latitude and a
longitude, and that is the ceiling.

So "use my location" in the mobile portal is a **map-centring convenience, never
a placement method**. It moves the viewport to roughly where you are; you still
place by clicking the map. Actual on-site precision is Phase 7's capture mode in
the app, where ARCore is doing the work. Building the mobile portal so that it
implies otherwise would ship a feature that silently produces bad trails.

### 3. Bulgarian and English in the portal too

This is a bigger commitment than it looks, because it means **two separate
translation layers**:

- **Marker content** — already solved by design. `content` jsonb, keyed by
  language, falling back to `worlds.default_language` (§6).
- **Portal interface strings** — buttons, labels, errors, validation messages.
  This is new and did not exist as a web concern before.

The app already solves the second one with `AppStrings` and `LocalizedLabel`. The
portal needs the same shape: one dictionary, one language switch, no hardcoded
user-facing strings anywhere. **Set this up before writing the first screen.**
Retrofitting i18n means touching every component that was ever written without
it, and it is a genuinely miserable job.

### 4. A landing page that leads to the app

Consequences, none of them free:

- **A domain is now required.** Not optional — it is the thing a join code
  resolves to and the thing you print on a poster.
- **Hosting for a public page.** The static page can live anywhere (GitHub Pages,
  Cloudflare Pages, Vercel free tier).
- **A Play Store listing to link to**, which is Phase 10. Until then the landing
  page links to an internal testing track or simply says "coming soon".
- **Deep links.** Ideally opening a world link on a phone with the app installed
  goes straight into that world, and to the store if it is not. That is Android
  App Links plus a `assetlinks.json` file on the domain, and it is fiddly enough
  to deserve its own slot rather than being assumed into Phase 2.
- **A privacy policy has to live somewhere anyway** (§10, §11) — the same domain
  serves it.

### 5. One design language across portal and app

**The palette already exists and should not be reinvented.**
`Assets/Scripts/UI/AppTheme.cs` defines 14 semantic roles — `Background`,
`Surface`, `SurfaceAlt`, `Line`, `TextPrimary`, `TextSecondary`, `TextMuted`,
`Accent`, `OnAccent`, `Scrim`, and four status roles — with a tuned light and
dark palette for each, already proven on a real device.

The portal does not need new colours. It needs **the same 14 roles expressed as
CSS custom properties**:

```css
:root {
  --background: #F1F1EF;  --surface: #FFFFFF;  --surface-alt: #E8E9E6;
  --line: #D3D5D1;        --text-primary: #16181B;  /* ...etc */
}
```

One name per role, two products, two themes. The rule that made this work in the
app carries over verbatim and is the single most important styling rule in the
project: **nothing hardcodes a colour.** §13 lists "light mode half-applied" as a
bug that already happened once, caused by exactly that.

Worth noting what the role names buy you: `StatusGood/Fair/Poor/None` are
deliberately separate from `Accent` so that VPS calibration state never reads as
branding. Keep that separation on the web — a green "saved" toast must not use
the accent, and the accent must never mean "good".

### 6. Standard street map

MapLibre GL JS with a standard street style. Streets and building footprints stay
legible, which matters because markers are placed *against buildings*.

Trade-off accepted: coloured markers pop less against a full-colour base map than
they would against greyscale. Mitigation is marker styling — a solid fill, a
white halo, and a drop shadow — not desaturating the map.

### 7. Light and dark, both products

The map is included. A dark portal with a blazing white map is the most common
version of this mistake. MapLibre styles are JSON, so a dark base style is
swapped in on theme change rather than filtered with CSS.

### 8. Accent: Teal — decided 2026-08-26

```
Accent    light #0F7A6B   dark #45C4B0
OnAccent  light #FFFFFF   dark #04201C
```

Measured, not eyeballed:

| Check | Light | Dark |
|---|---|---|
| Accent vs Background | 4.62:1 | 9.06:1 |
| Accent vs Surface | 5.23:1 | — |
| OnAccent on Accent | 5.23:1 | 7.96:1 |

All pass 4.5:1. Light is the tighter of the two at 4.62:1, so **do not lighten
the light-mode teal** — it has almost no headroom above the threshold.

#### The consequence: StatusGood had to move

Teal at hue 171° sat 25° from `StatusGood` at 145°, with a luminance contrast
between them of **1.10:1**. Two colours that close in both hue and lightness are
hard to tell apart side by side, and under red-green colour vision deficiency —
roughly 8% of men — they are close to identical. The VPS calibration readout uses
`StatusGood`, and it now lives in an interface whose accent is teal.

So `StatusGood` moved away from the accent rather than the other way round: the
accent is a brand decision that was just made deliberately, while the status
colours are functional signals whose only job is to be unmistakable.

```
StatusGood   light #2E7D4F -> #41762B     hue gap 26.5° -> 69.2°
             dark  #5FCF8E -> #74D96B     hue gap 25.4° -> 55.5°
```

Contrast against their backgrounds is unchanged or better (light 4.46 -> 4.82,
dark 10.01 -> 11.01). Reverting is two lines in `AppTheme.cs` if the new green
looks wrong on the device.

**The deeper fix is not colour.** Widening the hue gap helps, but red-green
deficiency compresses that whole part of the spectrum regardless. Calibration
state must never be carried by colour alone — the existing readout text and the
`VpsIndicatorController` shape are what actually make it legible, and they stay.

#### Markers are not the accent

Worth stating because it is easy to conflate: teal is **chrome** — buttons,
links, selected states, the app's identity. Individual markers carry their own
`style_key` and `colour_hex`, chosen per marker by whoever made them (§6, §7).
A creator colour-coding a trail in red, amber and green is untouched by this
decision, and colour-coded classification on plain shapes still works from day
one with no marker art.

### Where the accent lives

Two files, and they must change together:

- `ARTrail/Assets/Scripts/UI/AppTheme.cs` — `Light()` and `Dark()`
- `NOIT APP/web/tokens.css` — `--accent`, `--on-accent`



The neutrals and the text ramp in `AppTheme` are solved, tuned and shipped.
Re-picking them would be churn.

What was genuinely open was **the accent** — the one colour that is the brand. It
currently sits at `#8B82E8` violet in dark and `#4A42A0` in light. Two values,
because an accent that carries enough contrast on `#0B0D10` is too pale on
`#F1F1EF`; every candidate needs a light and a dark variant.

Constraints the chosen accent had to satisfy:

- **4.5:1 contrast** against both `Background` and `Surface`, in its own theme.
- **`OnAccent` legible on it** — the colour of text sitting on an accent button.
- **Distinct from all four status colours**, especially `StatusGood` green and
  `StatusPoor` red, so "this is a button" never reads as "this is a warning".
- **Legible on a live camera feed**, which is a harder surface than any web page:
  unpredictable, often bright, often cluttered.

### 9. No references

Nothing to match. The app's existing look is the reference.

---

## Still open

- **App name and bundle id** (§16 Q1). The fork currently runs on the throwaway
  `com.alex.artrail.dev`. Permanent once published.
- **Domain name**, now required by decision 4.
- **Whether the landing page ships in Phase 2 or waits for Phase 10**, since it
  cannot link to a real store listing before then.
