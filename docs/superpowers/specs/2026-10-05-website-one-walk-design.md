# The website, reworked: One Walk

Approved by Alex on 5 October 2026 from the clickable design
(https://claude.ai/artifact/GsZS39hRsHYQ1xzLbe8ham), with two changes asked for
on review: the lower half of the home page has to belong to the hero, and every
point of the hero's network is joined by a thin line and pulses.

## What it is for

A visitor understands the idea in seconds and wants to try it: a creator pins
stops to real places, a player walks there and finds each one standing in the
street through the camera. The page shows that instead of describing it.

## Decisions

| | Decision |
|---|---|
| Hero | A made-up night street map on a canvas. Markers stand on street corners, every marker is joined to its neighbours by a thin blue line, pulses travel the lines, and the cursor (a tap on a phone) is the walker: markers near it light up, rise into pins and fire pulses on. With no pointer, a walker dot wanders the streets by itself. |
| Story | The map stays pinned while three steps scroll past: Build (five numbered stops drop in and are linked), Walk (the dot walks the streets to stop 2; the app's one-line card counts the metres down), Find (the map closes in on the stop and becomes a phone camera with the marker on a building, a question and +10). |
| Home page below | Night, like the hero: four trail types (Guided, Freefall, Educational, Competition), the five builder steps, "Made for a school trip", questions, a closing call to action with a live network, all revealed on scroll. A dashed route line runs down the page and lights a pin at each section as it is reached. |
| Other pages | The same language: a night heading band with the live map on content pages, sign-in pages on the night map, pill buttons, rounder cards and fields, the new header and footer. Working pages (My trails, the builder, account) follow the visitor's light or dark theme. |
| One way in | "Build a trail" leaves the header. Signed in, the header shows My trails; My trails has a "New trail" tile that opens the name and mode right there and goes straight to the builder. /create redirects to /my-trails?new=1. |
| Builder | Guided steps instead of tabs: Basics (titles, text) → Place (pin, radius, shape, colour) → Question (optional; was "Answer") → Hints (optional) → Media. Previous, Skip (on the two optional steps), Next, and Done on the last. Leaving a step saves it; Next checks it first. A tapped-in stop opens at Basics; the step bar jumps to any step of a stop that already exists. |
| Copy | Bulgarian (informal ти) and English. Claims that could not be backed up are gone: "0.5 m anchoring accuracy", "iOS is coming". The app is "coming to Google Play", not a download. |
| Motion | Canvas paused off screen and in a hidden tab. Reduced motion gets the finished states: no zoom, no drifting walker, everything revealed. |
| Stack | Astro + Tailwind 4 + TypeScript + GSAP, already installed. No React and no shadcn: the network is a plain TypeScript canvas module. |

## Not in scope

Real map tiles in the hero, an iOS mention, a Play Store badge (only once the
listing is live), changes to the database.

## Done when

- The home page, My trails, the builder and every other page build, pass the
  production build's checks, and render at 390 and 1440 px wide in both themes
  without a sideways scroll or a console error.
- The builder saves a stop through all five steps against the real database.
- `main` is pushed and Netlify serves it at artrails.netlify.app.
