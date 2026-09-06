# Putting the site somewhere

The site is a static build. There is no server, no Node process to keep alive
and no database connection from the host — every page is HTML, and everything
live happens in the browser talking straight to Supabase. Anything that can
serve a folder of files will do.

## Building it

```sh
cd web
npm ci
PUBLIC_SUPABASE_URL="https://<ref>.supabase.co" \
PUBLIC_SUPABASE_ANON_KEY="<the anon key>" \
npm run build
```

That writes `dist/`. Upload the contents of `dist/` and you are done.

Both values are baked into the JavaScript at build time. That is fine and
intended: the anon key is public by design — it is the same key that ships
inside the APK, and every table it can reach is guarded by row-level security.

**The `service_role` key is a different thing entirely.** It bypasses RLS
completely. It does not belong in a build variable, in this repository, or in
anything a browser can read. If you ever paste it into a deploy panel, rotate
it.

Without the two variables the build still succeeds and the site renders, but
`db()` returns null and every page that needs an account says so instead of
breaking. `web/config.local.js` sets the same two values on `window` for local
work; it is gitignored and is not involved in a deploy.

## What the host needs to do

- Serve `dist/` as the site root.
- Serve `index.html` for a directory URL — `/play/` must return
  `/play/index.html`. Almost every static host does this by default.
- HTTPS. Not optional: the app's camera and location permissions, and Supabase's
  auth cookies, all require it.

Nothing else. No redirects file, no rewrite rules, no build step on the host.

## When the trail codes stop working

If pages load but signing in fails, the two variables were missing or wrong at
**build** time, not at run time — rebuild with them set. You can check what a
build actually contains:

```sh
grep -o 'https://[a-z]*\.supabase\.co' dist/_astro/*.js | head -1
```

## Adding a domain later

Nothing in the site knows its own URL, so a domain change needs no rebuild.
The one place that cares is Supabase: **Authentication → URL Configuration →
Site URL and Redirect URLs** have to list the new origin, or the confirmation
and password-reset links will point at the old one.
