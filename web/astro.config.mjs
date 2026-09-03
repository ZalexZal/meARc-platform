// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// Static output. Every page here either renders the same for everybody or reads
// its data in the browser with the anon key, so there is nothing for a server to
// do and nothing a server could hold that the browser should not.
//
// i18n with no default prefix: Bulgarian lives at /, English at /en/. The
// audience is Bulgarian and burying them one level down to keep the routing
// tidy would be tidying the wrong thing.
export default defineConfig({
  site: 'https://artrail.example',
  i18n: {
    locales: ['bg', 'en'],
    defaultLocale: 'bg',
    routing: { prefixDefaultLocale: false, redirectToDefaultLocale: false },
  },
  vite: {
    plugins: [tailwindcss()],

    // MapLibre ships its tile parser as a web worker, resolved through
    // `new URL(..., import.meta.url)`. Vite's dependency pre-bundling rewrites
    // that URL and the worker never starts.
    //
    // Nothing reports it. The style JSON downloads, 111 layers parse, and then
    // the map sits there with styleLoaded false and no source caches, having
    // asked for exactly four files and not one tile. No console error, no
    // failed request, a correctly sized canvas painting the style's background
    // colour - which reads as "the map is empty" rather than "the map is
    // broken".
    optimizeDeps: { exclude: ['maplibre-gl'] },
    worker: { format: 'es' },
  },
});
