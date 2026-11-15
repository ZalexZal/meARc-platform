# Until Deployment

**Goal:** Clear the remaining security, legal and distribution blockers so the app and site can be handed to students.

**Status at 2026-09-14.** Items marked DONE were completed and verified this session; evidence is quoted under each.

## Global constraints

- Both GitHub repos stay Private. The ARCore API key is in the fork's history.
- The Supabase `service_role` key never goes in the app, the repo, a deploy panel, or a chat message. Only the `anon` key ships in clients.
- `web/config.local.js` and `web/.env` are gitignored and hold live credentials.
- The keystore password is never committed. Unity writes it into `ProjectSettings.asset` if you let it - check before every commit.
- Test accounts are deleted in a `finally` block. Never test destructive flows on a real account.
- Verify against the live database or a real device. Editor-only and SQL-editor-only passes have both produced false green in this project.

---

## DONE - Commit the work that existed

65 files were uncommitted in the Unity repo and 10 in the site repo.

- Unity `field-test-fixes` @ `ed65a44` "The walk belongs to the walker, not the phone"
- Site `field-test-fixes` @ `cc3c5c0` "An account page, lawful legal pages, and five migrations"
- Both trees verified clean afterwards.

## DONE - Close the join code leak (0041)

Applied to the live database. Before, with only the anon key that ships in the APK and the site:

    GET /rest/v1/worlds?select=name,join_code
    200 [{"name":"Каргон","join_code":"27aq7u"}, ...]

After:

    200 []

Regression tested on the live database, 5/5: a signed-in non-member sees no trails; joining by code still works (`join_world` is security definer); a member reads their own trail; `trail_summary` still answers. The device half of 0008's "test either side" is still owed - no phone was connected.

## DONE - Account-scope the four leaking local stores

New `Assets/Scripts/Services/AccountScope.cs`. Every per-person setting now hangs off the account id, guests included, since an anonymous session is a real account.

| Store | Was | Leak it caused |
|---|---|---|
| `discovered_<marker>` | per phone | next team got a finished trail and its route |
| `marker_progress` | per phone | one team's cached answers in another's sheet |
| `selected_world` | per phone | a guest stayed pointed at a trail they never joined |
| `terms_accepted_version` / `terms_recorded_version` | per phone | second person never saw the terms, and no consent was recorded for them |

Two consequences handled rather than discovered later:

- `TrailService.Awake` reads the key before a session exists, so it would read the empty "nobody" drawer and lose the chosen trail every launch. `HandleSession` now re-reads once the account is known.
- `MarkerTaskService` deleted the stored progress on session change, which under scoping would delete the *arriving* person's progress. It now clears memory and loads that account's own cache.
- `DoorFlow` gates the terms door on `SupabaseAuth.HasSettledYet`, so it does not flash the terms screen before it knows who is asking. A failed sign-in also sets that flag, so an offline first run still gets the terms.

Guarded by `Assets/Scripts/Editor/AccountScopeCheck.cs` - fails the build if a fifth bare key appears. Run standalone:

    Unity -batchmode -quit -projectPath C:/Users/zalex/ARTrail -executeMethod AccountScopeCheck.Verify

## DONE - versionCode

`AndroidBundleVersionCode` 1 to 2, so this build is recognisably newer than anything already installed.

---

## NOT DONE - needs a decision or a thing only you have

### 1. Who is the data controller

`web/src/components/LegalPage.astro` still contains `[name of the operator]`, `[име на отговорника]`, `[имейл за контакт]` in both language blocks. A privacy policy that names a placeholder is not a privacy policy, and GDPR Article 13 requires the controller's identity and contact details.

Decide: the school as an institution, or you personally. And which monitored address receives erasure requests. Then:

    grep -c "\[име\|\[name of the operator\|\[имейл" web/src/components/LegalPage.astro

must print `0` before the site is published.

### 2. Will under-14s create accounts

The Bulgarian text already states that under-14s need parental consent (чл. 25в ЗЗЛД). Unanswered since 2026-09-11.

- **No** - no code change. Guided trails already work as a guest with no account and no email; that is the compliant path and what to tell the school.
- **Yes** - a consent step before sign-up. That is a feature, and gets its own plan.

### 3. Release keystore

The APK is signed with the shared Android debug key (`CN=Android Debug`) from `C:\Users\zalex\.android\debug.keystore`, valid to 2056 but present on one laptop. An update only installs over an existing copy if signed with the same key. Switch keys after students install and every one of them must uninstall first.

Fine for a single field test. Required before any second release.

    keytool -genkeypair -v -keystore C:/Users/zalex/keys/artrail-release.keystore \
      -alias artrail -keyalg RSA -keysize 2048 -validity 10000

You choose the password - it must not pass through a chat transcript. Back the file up off this laptop before using it; a lost keystore is the one unrecoverable failure here.

### 4. Package identity

`com.alex.artrail.dev`, labelled "meARc (dev)" - what students see under the icon. Renaming later creates a different app that cannot update in place, so decide before distributing, not after.

### 5. Deploy the site

No Netlify CLI or token on this machine. Rebuild after fixing the placeholders, then drag the `web\dist` folder to app.netlify.com.

### 6. Rotate the database password

It was pasted into a chat session. Supabase, Settings, Database, Reset password.

### 7. Two phones

Nothing here has ever been run by two people at once, and the product is a team race. No amount of further code review substitutes for two accounts answering the same stop at the same moment.

---

## Left alone deliberately

Six anonymous guest rows have accumulated from test sessions; four of them joined a trail. They are harmless, and deleting a guest account destroys whatever that guest walked, so they are reported rather than swept.
