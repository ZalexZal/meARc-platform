# Data protection impact assessment (GDPR art. 35)

**Service:** meARc - app and website. **Assessed:** 2026-09-27.
**Assessor:** the operator. **Updated 2026-11-26** for the changes listed in
section 4 (marked) and not yet re-assessed. **Next review:** before the production release on
Google Play, and whenever a new kind of data is collected.

## 1. Is a DPIA required?

Two of the EDPB's criteria apply: data about **vulnerable people** (13-year-olds
use the app) and **location data**; two criteria mean a DPIA is expected. The
CPDP publishes its own list of operations that need one - check it against
this document when it is revised. Either way, this is it.

## 2. The processing

Walkers join city trails, reach stops (by camera or GPS), answer questions and
play in teams; creators build trails; parents consent for 13-year-olds. Full
list in [records-of-processing.md](records-of-processing.md).

## 3. Necessity and proportionality

| Question | Answer |
|---|---|
| Is location necessary? | Yes: the service is walking to real places. Nearby searches are not stored. On scored trails the answer position is needed to stop remote cheating, and only the last accepted one is kept, for a day. |
| Is the age answer necessary? | Yes, to apply art. 8 (Bulgaria: 14). Only a band is kept, never a date of birth. |
| Is the parent's email necessary? | Yes, to verify consent (art. 8(2) "reasonable efforts"). Opening an emailed link proves the inbox. |
| Could less be collected? | Display names are optional; guests play guided trails without an email. No advertising, analytics or tracking SDKs. |
| Retention minimal? | Positions 1 day; everything else until the account is deleted, which the user can do at any time. |

## 4. Risks and measures

| Risk | Likelihood / severity before | Measures | Residual |
|---|---|---|---|
| A child's location exposed to strangers | Possible / high | Positions are never shown to other users; only distance and speed of refusals reach an organiser; the last position expires after a day; RLS on every table | Low |
| Under-13s using the app (ARCore forbids Geospatial for them; COPPA) | Possible / high | Neutral age screen (three answers, no hint which unlocks what; the website's sign-up has not asked since November because `ASK_AGE` is false in `web/src/lib/config.ts`); "12 or younger" refused and locked on the device; Play target audience 13+ | Low |
| A child consents for themselves | Possible / medium | Consent only through a parent's inbox (emailed link) or a parent account's code; parent sessions must come from an emailed link, not a password; until then the server refuses every play action | Low-medium (a child controlling a second inbox cannot be ruled out; this is the recognised "reasonable effort" standard) |
| Harmful user content reaching children | Possible / high | Terms define forbidden content; report on every stop, trail and team name; block; reviewer inbox; removals with a statement of reasons. Changed 12 Nov 2026 (0072): a trail is public when its owner says so, with no review before listing, and the app's Report buttons are hidden | Medium or higher: re-assess; it depends on the operator reviewing reports promptly |
| Harassment through teams or trails | Possible / medium | Block removes both people from each other's trails and hides team names; trail organisers can disqualify teams | Low |
| Account takeover | Unlikely / medium | Passwords at least 8, current password required to change it, email confirmation (once switched on), sign out everywhere | Low |
| Leak from the database | Unlikely / high | No service key anywhere public; RLS; minimal data; breach procedure ([breach-response.md](breach-response.md)) | Low |
| Transfers outside the EU | Certain / low | Data hosted in Frankfurt; SCCs / DPF with Supabase and Netlify | Low |

## 5. Conclusion

With the measures above the residual risk is **acceptable**; prior
consultation with the CPDP (art. 36) is not required. Two conditions:

1. Email confirmation must be switched on before public release, so accounts
   and parents' links rely on real inboxes. (Status 2026-11: the emails now send
   through Gmail; whether sign-up confirmation is on is the operator's decision.)
2. Reports must be reviewed at least every few days while the app is public.
