# Database clean-up proposal — 9 Nov 2026

**Status: PROPOSAL. Nothing here has been applied.** The matching migration is
`supabase/migrations/0068_cleanup.sql` (marked "NOT APPLIED — awaiting Alex's review").
Every number below comes from read-only `SELECT`s on the catalogs of the live database,
taken on 9 Nov 2026 with 0067 already applied.

## How "unused" was decided

An object is a drop candidate only if **both** hold:

1. **No code reference.** Its name has zero whole-word hits in `web/src`,
   `supabase/functions`, `tools`, `tests` and `AR-Trails/Assets/Scripts`. That covers
   `rpc('name'`, `/rest/v1/rpc/name`, `.from('x')` and `/rest/v1/x`. `web/netlify`
   was searched too, because the keep-alive job lives there.
2. **No database reference.** No other function body (`pg_proc.prosrc`, every schema
   except `pg_catalog`/`information_schema`) mentions it. No policy (`pg_policies`
   qual/with_check), trigger (`pg_trigger`), view, column default, check constraint,
   `pg_depend` entry or `cron.job` command uses it either.

Supabase-owned schemas (auth, storage, realtime, graphql, cron, extensions…) and
extension-owned objects (`pg_depend.deptype = 'e'`, e.g. PostGIS) were excluded.

## Inventory (public schema plus storage)

| Kind | Count | Notes |
|---|---|---|
| Tables | 30 | ai_usage, child_invites, earned_badges, editor_invites, feedback, heartbeat, hint_reveals, marker_answers, marker_hints, marker_media, marker_models, marker_progress, marker_submissions, markers, moderation_notices, parental_consents, platform_admins, player_fixes, position_flags, profiles, reports, stop_visits, team_adjustments, team_members, teams, user_blocks, walked_trails, world_members, worlds, xp_awards |
| Views / materialized views | 0 | |
| Functions (non-extension) | 138 | One overload per name; no procedures |
| Triggers | 21 | 19 on public tables; 2 on `auth.users` that call public functions (`on_auth_user_created` → handle_new_user, `follow_metadata_name`) |
| Policies | 43 | 39 on public tables, 4 on `storage.objects` (marker_media_select/insert/update/delete) |
| Storage buckets | 1 | `marker-media` (public), 44 objects |
| Cron jobs | 1 | `artrail-housekeeping` 02:30 daily → `select public.housekeeping()` |

Functions: accept_terms, ai_count_model, ai_count_translation, ai_secret,
answer_parent_consent, assert_may_play, award_progress, block_user, blocked_between,
can_moderate, cancel_child_invite, check_answer, clear_marker_answer, consent_guard,
consent_state, consents_to_answer, create_child_invite, create_team, create_world,
decide_listing, delete_my_account, editor_invite, ensure_team, erase_user,
export_child_data, export_my_data, export_user_data, feedback_handled, feedback_queue,
finish_after_progress, finish_after_visit, follow_metadata_name, generate_join_code,
give_up_team, handle_new_user, housekeeping, is_admin, is_captain, is_own_trail,
is_parent_of, join_as_editor, join_listed, join_team, join_world, keep_achievements,
keep_alive, lab_trail_code_for_team, leave_team, level_for_xp, listing_queue,
marker_detail, marker_models_check, markers_near, markers_touch, may_edit,
media_cap_bytes, media_paths, mode_is_ordered, mode_is_scored, moderator_adjust,
moderator_disqualify, moderator_end_game, moderator_skip, moderator_start_game,
move_marker, my_child_invites, my_children, my_history, my_level, my_profile,
my_progress, my_team, my_team_detail, my_worlds, needs_parent, new_join_code,
new_team_code, next_step_for, notice_seen, on_team, overlapping_stops, place_marker,
points_after_hints, position_problem, profile_for, public_trails, random_code,
record_finish, record_visit, redeem_child_invite, remove_editor, remove_marker,
remove_member, remove_world, reorder_markers, report_marker, report_team, report_world,
reports_queue, request_listing, request_parent_consent, resolve_report, reveal_hint,
review_answer, review_queue, rotate_join_code, send_feedback, set_gps_ready,
set_marker_answer, set_marker_shape, signed_in_by_email_link, stop_editor_invite,
team_captain_default, team_captain_left, team_membership_guard, trail_editors,
trail_markers, trail_models, trail_start, trail_started, trail_summary, trails_near,
transfer_captain, what_delete_removes, withdraw_listing, withdraw_parent_consent,
world_is_open, world_leaderboard, world_media_bytes, world_media_usage,
world_owner_membership, world_readiness, world_reveals_one_at_a_time, world_role,
world_teams, world_web_answers, xp_for_finish, xp_for_visit.

### Result of the two checks

- **87 functions** have no reference inside the database. They are the API entry
  points. Of those, 84 have call-shaped references in code. The other three:
  - `housekeeping` is run by the pg_cron job. It is **used**.
  - `generate_join_code` has only a comment in Unity. See (b).
  - `consents_to_answer` has nothing at all. See (a).
- **`keep_alive`** has no hit in the five searched folders, but
  `web/netlify/functions/keep-alive.mjs` calls `/rest/v1/rpc/keep_alive` every day.
  It is **used**.
- **All 30 tables** are read or written by at least one live function or policy. Twelve
  of them have no direct code reference (child_invites, earned_badges, hint_reveals,
  marker_submissions, parental_consents, player_fixes, position_flags, stop_visits,
  team_adjustments, team_members, walked_trails, xp_awards). Code only reaches them
  through RPCs, so none of them is a candidate.
- **Triggers, policies, the bucket:** every trigger function exists and is used by its
  trigger. Every policy sits on a used table. The single bucket holds live media.

## (a) Candidates to drop

### 1. `public.consents_to_answer()`

**Evidence that it is unused**
- Code: zero hits in web/src, web/netlify, supabase/functions, tools, tests and Unity
  Assets/Scripts. That includes zero `rpc('consents_to_answer'` and zero
  `/rest/v1/rpc/consents_to_answer`.
- Database: no function body, policy, trigger, view, default, check or cron job
  mentions it. `pg_depend` shows no dependents.
- History: it was created in 0047 and re-created in 0048 (the version that added the
  `signed_in_by_email_link()` guard). The parent's consent page
  (`web/src/components/Consent.astro`) now lists children with `rpc('my_children')`
  and answers with `answer_parent_consent` / `withdraw_parent_consent`. This function
  has been superseded.
- Dropping it leaves nothing orphaned. `signed_in_by_email_link()` is still used by
  six other functions and by the `parental_consents_select` policy.

**Grants (proacl):** `{postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}`.
That is EXECUTE for authenticated and service_role, with nothing for PUBLIC or anon.

**Definition (pg_get_functiondef), for restoring:**
```sql
CREATE OR REPLACE FUNCTION public.consents_to_answer()
 RETURNS TABLE(child_id uuid, child_name text, requested_at timestamp with time zone, granted boolean, answered_at timestamp with time zone, language text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.child_id,
         coalesce(nullif(trim(p.display_name), ''), ''),
         c.requested_at, c.granted, c.answered_at, c.language
  from public.parental_consents c
  join public.profiles p on p.id = c.child_id
  where lower(c.parent_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and coalesce(auth.jwt() ->> 'email', '') <> ''
    and public.signed_in_by_email_link()
  order by c.requested_at desc;
$function$;
revoke all on function public.consents_to_answer() from public, anon;
grant execute on function public.consents_to_answer() to authenticated, service_role;
```

## (b) Maybe unused — Alex decides

### `public.generate_join_code(p_len integer default 6)`, holding no data
- **Why it is not in (a):** there is one hit, a doc comment in
  `AR-Trails/Assets/Scripts/UI/CodeBoxes.cs:14`: "Codes come from generate_join_code,
  whose alphabet leaves out 0, O, 1, I and L".
- **Why it is probably dead:** no call anywhere in code or the database, and no
  `pg_depend` dependents. Trail and team codes are made by `new_join_code()` /
  `new_team_code()`, which call `random_code(6)`. They do not call this function. 0011
  lists it as internal and revokes it from the API. The Unity comment is therefore
  stale: it should name `random_code`, after checking that its alphabet matches.
- **Suggestion:** fix the Unity comment, then drop the function in a later migration.
  It is not in 0068.
- **Grants:** `{postgres=X/postgres,service_role=X/postgres}`.
- **Definition:**
```sql
CREATE OR REPLACE FUNCTION public.generate_join_code(p_len integer DEFAULT 6)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  result text := '';
  i integer;
begin
  for i in 1..p_len loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$function$;
revoke all on function public.generate_join_code(integer) from public, anon, authenticated;
```

### `public.lab_trail_code_for_team(text)`, holding no data
It is used: the Unity `TrailService.cs` calls it through `/rest/v1/rpc/` and the lab
suite `tests/lab/onecode.mjs` tests it. It is listed here only because its `lab_` prefix
says "experiment". If the one-code-box flow is final, consider renaming it. **Keep.**

### Tables with data
No table qualifies as unused. All 30 are used by live functions or policies. The
`player_fixes` table is empty right now, but `position_problem`, `export_user_data` and
`housekeeping` still use it. **Keep.**

## (c) Leftover data counts (counts only)

| What | Count |
|---|---|
| Lab-test accounts (`auth.users.email like 'lab-test-%@example.com'`) | **0** |
| Worlds owned by those accounts | **0** |
| Other lab-looking accounts (`%@lab.%`, or `lab-%` not matching the pattern above) | **0** |
| `marker-media` objects whose first path segment has no `public.worlds` row | **30** |
| Total size of those orphan objects | **169,556,920 bytes (≈ 161.7 MiB)** |
| Distinct missing world ids among them | 30 (all are well-formed uuids) |
| Their `created_at` range | 7–9 Nov 2026 |
| Bucket total, for comparison | 44 objects, 175,136,606 bytes |

So `cleanUsers()` has been doing its job for accounts. The orphans are files that
stayed behind after their trail was deleted. That happens, for example, when lab
suites delete worlds with SQL, which does not touch storage. **97% of the bucket's bytes
are orphans.**

**Important: storage objects cannot be removed with SQL.** `storage.objects` has a
Supabase trigger, `protect_objects_delete` → `storage.protect_delete()`. It raises
`42501 "Direct deletion from storage tables is not allowed. Use the Storage API
instead."` unless `storage.allow_delete_query` is set. Even with that override, a SQL
delete would remove only the row and leave the file in the object store. For that
reason 0068 does **not** delete them. Remove them through the Storage API (service role,
`storage.from('marker-media').remove([...paths])`), listing the paths with:

```sql
select o.name
from storage.objects o
where o.bucket_id = 'marker-media'
  and not exists (select 1 from public.worlds w where w.id::text = split_part(o.name, '/', 1));
```

A longer-term fix would be to have the lab `cleanUsers()` (and any SQL world delete)
also remove the world's folder through the Storage API.

## (d) Appendix: definitions before 0067

These are the six functions that migration `0067_classification.sql` changed, exactly
as they were before it (pg_get_functiondef + proacl). Use them with the undo steps in
the 0067 header.

```sql
-- SIG public_trails() ACL {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}
CREATE OR REPLACE FUNCTION public.public_trails()
 RETURNS TABLE(id uuid, name text, mode text, stop_count bigint, team_count bigint, created_at timestamp with time zone, start_lat double precision, start_lng double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select
    w.id, w.name, w.mode,
    (select count(*) from public.markers m
      where m.world_id = w.id and m.status = 'published'),
    (select count(*) from public.teams t where t.world_id = w.id),
    w.created_at,
    s.lat, s.lng
  from public.worlds w
  left join lateral (
    select st_y(m.location::geometry) as lat, st_x(m.location::geometry) as lng
    from public.markers m
    where m.world_id = w.id and m.status = 'published'
    order by m.step nulls last, m.created_at
    limit 1
  ) s on true
  where w.visibility = 'public'
    and w.status = 'published'
    and not public.blocked_between(auth.uid(), w.owner_id)
  order by w.created_at desc
  limit 100;
$function$

-- SIG trails_near(double precision,double precision,double precision) ACL {postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}
CREATE OR REPLACE FUNCTION public.trails_near(p_lat double precision, p_lng double precision, p_radius_m double precision DEFAULT 50000)
 RETURNS TABLE(id uuid, name text, mode text, stop_count bigint, distance_m double precision, lat double precision, lng double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select w.id, w.name, w.mode, s.n, s.d, s.lat, s.lng
  from public.worlds w
  cross join lateral (
    select count(*) over () as n,
           st_distance(m.location, st_makepoint(p_lng, p_lat)::geography) as d,
           st_y(m.location::geometry) as lat,
           st_x(m.location::geometry) as lng
    from public.markers m
    where m.world_id = w.id and m.status = 'published'
    order by m.step nulls last, m.created_at
    limit 1
  ) s
  where w.visibility = 'public'
    and w.status = 'published'
    and w.ended_at is null
    and s.d <= least(p_radius_m, 500000)
    and not public.blocked_between(auth.uid(), w.owner_id)
  order by s.d
  limit 50;
$function$

-- SIG my_worlds() ACL {postgres=X/postgres,service_role=X/postgres,authenticated=X/postgres}
CREATE OR REPLACE FUNCTION public.my_worlds()
 RETURNS TABLE(id uuid, name text, mode text, status text, visibility text, join_code text, role text, marker_count bigint, team_count bigint, pending bigint, review_note text, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    w.id, w.name, w.mode, w.status, w.visibility, w.join_code, m.role,
    (select count(*) from public.markers k where k.world_id = w.id),
    (select count(*) from public.teams   t where t.world_id = w.id),
    (select count(*)
       from public.marker_submissions s
       join public.markers k2 on k2.id = s.marker_id
      where k2.world_id = w.id and s.verdict = 'pending_review'),
    w.review_note,
    w.created_at
  from public.worlds w
  join public.world_members m on m.world_id = w.id
  where m.user_id = auth.uid()
    and m.role in ('owner','editor')
  order by w.created_at desc;
$function$

-- SIG trail_summary(uuid) ACL {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
CREATE OR REPLACE FUNCTION public.trail_summary(p_world uuid)
 RETURNS TABLE(id uuid, name text, mode text, status text, visibility text, stop_count bigint, team_count bigint, total_points bigint, needs_account boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    w.id, w.name, w.mode, w.status, w.visibility,
    (select count(*) from public.markers m
      where m.world_id = w.id and m.status = 'published'),
    (select count(*) from public.teams t where t.world_id = w.id),
    (select coalesce(sum(a.points), 0)
       from public.marker_answers a
       join public.markers m2 on m2.id = a.marker_id
      where m2.world_id = w.id and m2.status = 'published'),
    public.mode_is_scored(w.mode)
  from public.worlds w
  where w.id = p_world
    and (public.world_role(w.id) is not null or public.world_is_open(w.id));
$function$

-- SIG create_world(text,text,text) ACL {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
CREATE OR REPLACE FUNCTION public.create_world(p_name text, p_mode text DEFAULT 'guide'::text, p_language text DEFAULT 'bg'::text)
 RETURNS worlds
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row   public.worlds;
  v_today integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  -- Anyone with an account may create a trail. It starts private and draft, so
  -- an open door here costs nothing until somebody deliberately publishes.
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'making a trail needs a real account' using errcode = '28000';
  end if;

  select count(*) into v_today
  from public.worlds w
  where w.owner_id = auth.uid()
    and w.created_at > now() - interval '1 day';

  if v_today >= 20 then
    raise exception 'that is 20 trails in a day - stopping here in case something is looping'
      using errcode = 'check_violation';
  end if;

  insert into public.worlds
    (owner_id, name, join_code, mode, default_language, visibility, status)
  values
    (auth.uid(), trim(p_name), public.new_join_code(), p_mode, p_language,
     'private', 'draft')
  returning * into v_row;

  -- The on_world_created trigger from 0002 makes the owner a member.
  return v_row;
end;
$function$

-- SIG handle_new_user() ACL {postgres=X/postgres,service_role=X/postgres}
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- to_jsonb rather than new.is_anonymous directly: the column arrived in a
  -- Supabase update, and reading it through jsonb returns null instead of
  -- failing the whole trigger on a project that predates it.
  insert into public.profiles (id, is_anonymous, display_name)
  values (new.id,
          coalesce((to_jsonb(new) ->> 'is_anonymous')::boolean, false),
          left(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 40))
  on conflict (id) do nothing;

  return new;
end;
$function$

```
