# meARc - legal file

The operator's own records: what the law asks meARc to have written down,
kept up to date, and be able to show a regulator (the Bulgarian Commission for
Personal Data Protection, CPDP) or a NOIT jury. Written 2026-09-27; review
whenever the app starts keeping a new kind of data.

| Document | Law | What it is |
|---|---|---|
| [records-of-processing.md](records-of-processing.md) | GDPR art. 30 | Every kind of personal data, why, for how long, who else touches it |
| [dpia.md](dpia.md) | GDPR art. 35 | The risk assessment for children's data and location, with the measures taken |
| [processors.md](processors.md) | GDPR art. 28, 44-49 | The companies that process data for meARc, and the contracts to sign |
| [breach-response.md](breach-response.md) | GDPR art. 33-34 | What to do in the 72 hours after a leak |
| [content-moderation.md](content-moderation.md) | DSA art. 14-17 | How reports are handled and how removals are explained |

## Where the public texts live

- Terms of use and privacy policy: `web/src/components/LegalPage.astro`,
  published at `/terms/` and `/privacy/` (BG) and `/en/terms/`, `/en/privacy/`.
  Their version is `TERMS_VERSION` in `web/src/lib/terms.ts` and
  `termsVersion` in the app's `SupabaseConfig.cs`; change both together.
- The in-app summary of the terms: `AppStrings.cs`, keys `terms.*`.
- Parent-facing explanation: `/parent/` (`Consent.astro`, keys `cons.*`, `par.*`).

## Decisions on record

| Date | Decision | By |
|---|---|---|
| 2026-09-25 | Endgame is a Google Play release | Operator |
| 2026-09-27 | Minimum age 13. 14 and older alone; 13 only with a parent's account (email link, or a code from the parent's account) | Operator |
| 2026-09-27 | Badges and walked trails belong to the account and survive team or trail deletion | Operator |
| 2026-09-27 | Repositories stay private | Operator |
| 2026-09-27 | The operator is 18 or older | Operator |
| 2026-09-27 | A parent account sees the child's activity, downloads the child's data, manages several children, and can create the child's account (a code) | Operator |
| 2026-09-27 | The age answer only moves towards more protection: "13" can never be changed back to "14+" by the user (migration 0051). A slip is fixed by the operator on request. "12 or younger" locks the device's sign-up | Legal review |
| 2026-09-29 | Stay on Supabase Free: a daily keep-alive, and an encrypted weekly backup the operator runs (8 weeks kept) | Operator |
| 2026-09-29 | Guest accounts unused for 6 months are deleted automatically | Operator |
| 2026-09-29 | Feedback from the app and website, kept 12 months; not accepted from a 13-year-old before a parent agrees | Operator / legal review |

Why 13 and not younger: Google's ARCore terms forbid the Geospatial API in any
service "directed to children" under COPPA (under 13), and meARc is built on
it. Why a parent at 13: Bulgaria sets the age of digital consent at 14
(Personal Data Protection Act art. 25c, under GDPR art. 8).

## Still the operator's to do

- Sign Supabase's DPA (see processors.md). Netlify's is part of its terms.
- Have the terms and privacy policy read once by a lawyer before the
  production release. The pages say they are an unreviewed draft until then.
