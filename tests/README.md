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
is gitignored because it holds live credentials. Point `ARTRAIL_CONFIG` somewhere
else if yours lives elsewhere, and set `ARTRAIL_OWNER` / `ARTRAIL_OWNER_PASSWORD`
to use a different creator account.

Everything it makes — the trail, the identities, the report — it deletes on the
way out, in a `finally`, and it prints what is left so you can see that it did.

It costs three sign-ins, one of them an email account. Supabase throttles those,
so do not run it in a tight loop.
