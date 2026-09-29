# Closed-test readiness (version 8) — design

Approved by the operator on 2026-09-29 through four decisions: build the
feedback button; stay on Supabase Free with a keep-alive and a weekly backup
the operator runs; delete guest accounts after 6 months unused; prepare the
Play reviewer account and screenshots now.

## Goal

Move AR Trail from "built" to "ready for Google Play's closed test"
(12 testers, 14 days), keep every promise the privacy policy makes, and give
the closed test a way to collect what testers say.

## 1. Feedback

- **Table `feedback`**: id, user_id (cascade on account deletion), source
  (`app` | `web`), app_version, device, where (screen or page), message
  (1–2000 characters), reply_ok, created_at, handled_at.
- **`send_feedback(...)`**: any signed-in session, guests included. A
  13-year-old whose parent has not agreed is refused and shown the contact
  address instead: a child's free text is not processed before consent.
  At most 10 per person per day.
- **Reviewer**: `feedback_queue()` and `feedback_handled(id)`, both for
  platform admins only. It shows the account email only when the sender ticked
  "you may reply by email".
- **App**: You → Send feedback. The sheet has a message, a reply-by-email switch
  (only for accounts with an email), and Send. Version and phone model are
  attached and shown before sending.
- **Website**: a Feedback link in the footer leads to `/feedback` (BG/EN), which
  needs a signed-in account. `/review` gets a Feedback section.
- **Rights**: included in `export_my_data`, deleted with the account, and gone
  12 months after it was sent.

## 2. Keeping the privacy policy's promises (scheduled jobs, pg_cron)

Daily at 02:30 UTC:
- last answer positions older than 1 day (the policy's promise; until now this
  only ran when somebody answered);
- parent codes 30 days after they expired or were used;
- feedback older than 12 months;
- **guest accounts** (anonymous, no email) with no sign-in or session refresh
  for 6 months, together with everything hanging off them.

The privacy policy states all four. Trigger functions stop being executable by
clients (cosmetic: Postgres refuses the call anyway).

## 3. Staying awake and recoverable on the Free plan

- **Keep-alive**: a Netlify scheduled function (daily) calls `public_trails`
  with the anon key from Netlify's own environment, so no key is added to the
  repository.
- **Backup**: `tools/backup.ps1`, run weekly by the operator. It uses PostgreSQL
  17's `pg_dump` for a data dump of `public`, `auth` and `storage`, plus every
  media file, into `C:\Users\zalex\keys\backups\<date>\`, outside every
  repository. The database URL is read from `C:\Users\zalex\keys`. The schema is
  already recoverable from the migrations. Restore steps go in
  `docs/legal/backup-and-restore.md`, and the processing record is updated.

## 4. Play reviewer account and screenshots

- The reviewer account is `zalex8623+playreview@gmail.com` (it arrives in the
  operator's inbox). Its password is generated and stored in
  `C:\Users\zalex\keys\play-reviewer.txt`, never printed. It is adult, has
  accepted the terms, and has no trails of its own.
- Screenshots come from the attached phone with a test location in central
  Yambol, set through Android's shell test providers and removed afterwards.
  That keeps the operator's home off the store listing. They are cropped to
  exactly 2:1 (Play refuses anything longer). The AR camera shot needs outdoors
  and stays on the operator's list.

## 5. Release 0.3.0 (4)

App and website ship together. Every test runs against the live site: s20,
s22, the seam test and a new feedback test. The APK and AAB are signed. Then
the README version history, the launch kit and the roadmap are updated.

## Out of scope

The sensitive-place warning, the admin map, 3D models, iOS, an offline answer
queue, and the NOIT pitch (after the outdoor tests).
