# tests

## seam.mjs

The website and the app never speak to each other. Everything a creator sets
reaches a walker by being written to one table and read out of another, so the
seam between the two halves is exactly that set of writes and reads — and the
way it breaks is quiet: a field that stops arriving, a queue that stops being
filled, a rule that one side enforces and the other does not mention.

This builds a trail using the website's own calls — including the direct table
writes it makes through row-level security, not only its RPCs — and then reads
it all back using the app's own calls, checking that each thing arrives. Then it
goes the other way: a typed answer into the review queue and the creator's
decision back out, a report, a moderator's adjustment appearing on the team card,
the board and the card agreeing on one number.

Run it after changing either half, and after building the real trail.

```
cd tests && npm install        # once, for pg
PGPASS='...' npm run seam
```

It needs `web/config.local.js` for the anon key — that file
is gitignored because it holds live credentials, and the key has to be written
in double quotes as in `web/config.example.js`. Point `ARTRAIL_CONFIG` somewhere
else if yours lives elsewhere. `PGPASS` is the database password for the Supabase
session pooler; the project reference is written in `seam.mjs`. The creator
account it signs in as is a fixed test account; set `ARTRAIL_OWNER` /
`ARTRAIL_OWNER_PASSWORD` to use a different one (the old default may no longer
exist, since every trail and account was cleared on 21 November 2026).

Everything it makes — the trail, the identities, the report — it deletes on the
way out, in a `finally`, and it prints what is left so you can see that it did.

It costs three sign-ins, one of them an email account. Supabase throttles those,
so do not run it in a tight loop.

It checks 46 things. It was last run before the November migrations (0056–0073),
so a failure on a newer column or rule is more likely a stale check than a bug.

## lab/

The suites written during the November rounds, one per feature: the builder, the
viewer page (`view.mjs`), roles and line of work, classification, teacher tools
(`teacher-tools.mjs`), visibility (`visibility.mjs`), the radius ring, the A5
sign-up stage, the AI translate row, and so on. Most drive a real browser with
Playwright; the `db-*.mjs` ones call the database directly.

```
tests/lab/build.sh                 # builds the site from web/config.local.js and serves it on :4399
node tests/lab/<suite>.mjs         # one suite, against http://localhost:4399
LAB_BASE=https://artrails.netlify.app node tests/lab/<suite>.mjs   # against the live site
node --experimental-strip-types --test tests/lab/unit/*.test.ts   # the unit tests
```

What they need, none of which is in the repository:

- `web/config.local.js` (the public URL and anon key) and `web/node_modules`
  (`playwright`, `pg` and supabase-js are read from there).
- The database URL in `~/keys/supabase-db-url.txt`. `lib.mjs` makes throwaway
  confirmed accounts called `lab-test-<tag>-<time>@example.com` straight in
  `auth.users` and deletes them at the end of a run. `phone-clean.mjs` removes
  the ones left by an interrupted run or by `phone-setup.mjs`.
- A Playwright Chromium in `~/.cache/ms-playwright` (the path is written in
  `lib.mjs`).
- `visibility.mjs` needs migration 0072 applied; `review-queue.mjs` skips until
  0069 is. `shots/` and `lab/check-site.txt` are output, not tests.

Everything runs against the live database, so use it as the other tests are used:
not in a loop, and not while somebody else is testing.
