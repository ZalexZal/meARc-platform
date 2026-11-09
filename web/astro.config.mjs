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

// Content-Security-Policy. Astro writes it into every page as a meta element,
// hashing each script it renders, so a script injected into a page - through a
// trail name, a stop's text, anything a user typed - does not run. The only
// outside script is MapLibre for the editor's map, from cdnjs.
//
// Styles stay on 'unsafe-inline': pages build rows with style="" attributes in
// innerHTML, which hashes cannot cover, and a stylesheet cannot run code.
// frame-ancestors cannot be set from a meta element; netlify.toml sends
// X-Frame-Options instead.
const SUPABASE = process.env.PUBLIC_SUPABASE_URL || 'https://tajbebyhmvppqlswyjiq.supabase.co';

export default defineConfig({
  site: 'https://artrails.netlify.app',
  // "Build a trail" used to be a page of its own. The name and mode are now
  // asked on My trails, so old links and bookmarks land there with the form
  // already open.
  redirects: {
    '/create': '/my-trails/?new=1',
    '/en/create': '/en/my-trails/?new=1',
  },
  i18n: {
    locales: ['bg', 'en'],
    defaultLocale: 'bg',
    routing: { prefixDefaultLocale: false, redirectToDefaultLocale: false },
  },
  security: {
    csp: {
      // 'wasm-unsafe-eval' lets model-viewer and three.js compile their WebAssembly
      // decoders; it allows WebAssembly only, not eval() of JavaScript.
      scriptDirective: { resources: ["'self'", "'wasm-unsafe-eval'", 'https://cdnjs.cloudflare.com'] },
      styleDirective: {
        resources: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdnjs.cloudflare.com'],
      },
      directives: [
        "default-src 'self'",
        // The API and realtime (co-editing), and the editor's map tiles.
        // blob: is a creator's own 3D model, read in the builder before upload.
        `connect-src 'self' blob: ${SUPABASE} ${SUPABASE.replace(/^https:/, 'wss:')} https://tiles.openfreemap.org https://*.hf.space https://nominatim.openstreetmap.org`,
        // Uploads, QR codes (data:), map sprites (blob:), and pictures a
        // creator linked from anywhere.
        "img-src 'self' data: blob: https:",
        `media-src 'self' blob: ${SUPABASE}`,
        "font-src 'self' https://fonts.gstatic.com",
        // MapLibre starts its worker from a blob.
        "worker-src 'self' blob:",
        "child-src 'self' blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ],
    },
  },
  vite: {
    plugins: [tailwindcss()],

    // maplibre-gl is imported from its pre-bundled distribution, which carries
    // its worker inside it - see the comment in TrailEditor.astro. Excluding it
    // from pre-bundling here only ever fixed the dev server; the production
    // build broke the worker just the same, and did it silently.
  },
});
