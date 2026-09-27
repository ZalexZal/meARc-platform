# Records of processing (GDPR art. 30)

**Controller:** Alexander Zamov, operator of AR Trail - zalex8623@gmail.com.
No representative (established in the EU). No DPO: AR Trail's core activity is
not large-scale systematic monitoring, nor large-scale special-category data
(art. 37).

Art. 30(5) exempts organisations under 250 people only when processing is
occasional, low-risk and has no special categories. AR Trail's processing is
continuous and includes children, so this record is kept.

| # | Purpose | People | Data | Legal basis | Kept for |
|---|---|---|---|---|---|
| 1 | Accounts and sign-in | Users (13+), guests | Email, password hash (held by Supabase Auth), display name, account dates, IP in auth logs | Contract (6(1)(b)) | Until deletion; logs 90 days |
| 2 | Terms acceptance and age | Users, guests | Terms version and time, age band (14+ / 13) | Legal obligation / accountability (6(1)(c), 7(1), 8) | Until deletion |
| 3 | Parental consent | 13-year-olds and their parents | Parent's email, parent account id, how consent was given (email or code), request/answer times, terms version seen, codes made (with the child's name the parent wrote) | Consent of the holder of parental responsibility (6(1)(a), 8) | While the child's account exists; unused codes until the parent's account is deleted |
| 4 | Playing trails | Users | Trails and teams joined, stops reached (camera/map), answers (including wrong), hints unlocked, points, badges, walked trails | Contract | Until deletion; answers to others' trails stay anonymised |
| 5 | Fair play | Users on scored trails | Position, accuracy and mock flag sent with each answer; last accepted position; refusal kind, distance and speed (no coordinates) | Legitimate interest (6(1)(f)) - integrity of competitions | Last position 1 day; refusals as long as the trail |
| 6 | Building trails | Creators, editors | Trail content, media, coordinates, editor invitations, co-editor list, presence (not stored) | Contract | Until the trail or account is deleted |
| 7 | Moderation and safety | Reporters, reported creators, blocked users | Reports (reason, target, reporter), blocks, removal notices and reasons, disqualifications | Legitimate interest (6(1)(f)); DSA art. 16-17 | Reports and notices while the account exists |
| 8 | Nearby search | Anyone using the app | A position sent as "what is near this point"; not stored | Contract | Not stored |
| 9 | AR placement | App users | Camera-derived visual features and approximate location, sent by ARCore to Google (Google is controller for its part) | Contract | Per Google's policy |
| 10 | Data requests | Anyone | Emails and what they ask | Legal obligation (6(1)(c)) | 3 years after closing the request |

## Recipients

Processors: Supabase (database, auth, email sending), Netlify (website hosting).
Independent controllers: Google (ARCore; Google Play), Stadia Maps, Esri and
OpenFreeMap (map tiles; see IP address and viewed area). Details and transfer
safeguards in [processors.md](processors.md).

## Security measures (art. 32)

- TLS on every connection; Supabase data at rest encrypted.
- Row-level security on every table, enforced by the database; server
  functions check the caller for every write (roles, trail membership,
  parent sessions opened only by emailed links).
- Answers and correct answers never reach phones; scoring only on the server.
- No service-role key in the app, the website or the repositories.
- Release signing key kept offline at `C:\Users\zalex\keys`, backed up.
- Access to the Supabase dashboard: the operator only.

## Data subject rights - how each is met

| Right | How |
|---|---|
| Access, portability | "Download my data" on the website account page (JSON); parents from the parent account |
| Rectification | Name and email in the account settings |
| Erasure | Delete account, two taps in the app or on the website; parents withdraw consent |
| Withdraw consent | Parent account: withdraw - the child's account is deleted |
| Object / restrict | Email zalex8623@gmail.com; answered within one month |
