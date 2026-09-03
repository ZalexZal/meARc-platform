-- =============================================================================
-- Take it with you, or take it away
-- =============================================================================
--
-- This platform is aimed partly at school groups in the EU, so it will hold
-- minors' typed answers, timestamps and - through the markers they solved - a
-- fair reconstruction of where they walked and when. Export and delete are
-- features of that, not paperwork about it, and they are cheapest to build now
-- while there are ten tables rather than thirty.
--
-- Both run as the caller's own account and neither takes a user id. A function
-- that accepted one would be a function that could be pointed at somebody else.
--
-- Safe to run twice.
-- =============================================================================

begin;

-- ------------------------------------------------------------ export_my_data
--
-- Everything this person can see about themselves, in one document. Not a
-- summary: the actual submissions, with what was typed and what came back.

create or replace function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'account', (
      select to_jsonb(p) - 'id'
      from public.profiles p where p.id = auth.uid()
    ),
    'trails_joined', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', w.name, 'role', m.role, 'joined_at', m.joined_at)), '[]'::jsonb)
      from public.world_members m
      join public.worlds w on w.id = m.world_id
      where m.user_id = auth.uid()
    ),
    'teams', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'team', t.name, 'trail', w.name, 'joined_at', tm.joined_at)), '[]'::jsonb)
      from public.team_members tm
      join public.teams  t on t.id = tm.team_id
      join public.worlds w on w.id = t.world_id
      where tm.user_id = auth.uid()
    ),
    'solved', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trail', w.name, 'points', mp.points, 'solved_at', mp.solved_at)), '[]'::jsonb)
      from public.marker_progress mp
      join public.markers m on m.id = mp.marker_id
      join public.worlds  w on w.id = m.world_id
      where mp.solved_by = auth.uid()
    ),
    'submissions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trail',     w.name,
               'submitted', s.submitted,
               'verdict',   s.verdict,
               'at',        s.created_at)), '[]'::jsonb)
      from public.marker_submissions s
      join public.markers m on m.id = s.marker_id
      join public.worlds  w on w.id = m.world_id
      where s.user_id = auth.uid()
    ),
    'trails_created', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', w.name, 'mode', w.mode, 'created_at', w.created_at)), '[]'::jsonb)
      from public.worlds w
      where w.owner_id = auth.uid()
    )
  );
$$;

revoke all on function public.export_my_data() from public;
grant execute on function public.export_my_data() to authenticated;

-- --------------------------------------------------------- what a delete costs
--
-- worlds.owner_id cascades from profiles, and markers cascade from worlds. So
-- deleting an account that owns trails deletes those trails and every marker in
-- them, for everybody who had joined them. That is the decision already made in
-- 0002 and it is defensible - a trail with no owner is unmaintainable - but it
-- must be said out loud before the button is pressed, not discovered after.
--
-- This is what the confirmation screen reads from.

create or replace function public.what_delete_removes()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'trails_owned', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name',    w.name,
               'markers', (select count(*) from public.markers m where m.world_id = w.id),
               'teams',   (select count(*) from public.teams  t where t.world_id = w.id)
             )), '[]'::jsonb)
      from public.worlds w where w.owner_id = auth.uid()
    ),
    'teams_left_behind', (
      -- Teams this person is on that other people are also on. Those survive;
      -- only this membership goes.
      select count(*)
      from public.team_members tm
      where tm.user_id = auth.uid()
        and (select count(*) from public.team_members o where o.team_id = tm.team_id) > 1
    ),
    'submissions', (
      select count(*) from public.marker_submissions where user_id = auth.uid()
    )
  );
$$;

revoke all on function public.what_delete_removes() from public;
grant execute on function public.what_delete_removes() to authenticated;

-- ---------------------------------------------------------- delete_my_account
--
-- Deletes the auth user. Everything else follows the cascades already declared:
-- profiles goes with the user, world_members and team_members go with the
-- profile, worlds owned go with it too, and submissions keep their row with a
-- null author so a team's history does not develop holes.

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_id uuid := auth.uid();
begin
  if v_id is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  -- Teams whose only member is this person go now, so they do not survive as
  -- unreachable rows once the membership cascade has run.
  delete from public.teams t
  where t.id in (
    select tm.team_id from public.team_members tm where tm.user_id = v_id
  )
  and (select count(*) from public.team_members o where o.team_id = t.id) = 1;

  delete from auth.users where id = v_id;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- ------------------------------------------------------------ 4. my_history
--
-- What "everything about me" renders on the site, and the same thing the app
-- will read once it stops keeping progress in PlayerPrefs.

create or replace function public.my_history()
returns table (
  world_id     uuid,
  world_name   text,
  mode         text,
  role         text,
  team_id      uuid,
  team_name    text,
  stops_solved bigint,
  points       bigint,
  pending      bigint,
  last_activity timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.id, w.name, w.mode, m.role,
    t.id, t.name,
    (select count(*) from public.marker_progress mp where mp.team_id = t.id),
    (select coalesce(sum(mp.points), 0) from public.marker_progress mp where mp.team_id = t.id),
    (select count(*)
       from public.marker_submissions s
       join public.markers k on k.id = s.marker_id
      where s.team_id = t.id and k.world_id = w.id and s.verdict = 'pending_review'),
    greatest(
      (select max(mp.solved_at)  from public.marker_progress mp    where mp.team_id = t.id),
      (select max(s.created_at)  from public.marker_submissions s  where s.team_id = t.id)
    )
  from public.world_members m
  join public.worlds w on w.id = m.world_id
  left join public.teams t
    on t.world_id = w.id
   and t.id = public.my_team(w.id)
  where m.user_id = auth.uid()
  -- 10 is last_activity, the tenth and final output column. This said 11,
  -- which Postgres rejects outright rather than guessing.
  order by 10 desc nulls last, w.name;
$$;

revoke all on function public.my_history() from public;
grant execute on function public.my_history() to authenticated;

commit;

-- =============================================================================
-- Verify from outside the dashboard:
--
--   * export_my_data as user A never mentions user B's submissions.
--   * what_delete_removes lists the trails that will go, before anything goes.
--   * delete_my_account as a signed-in user leaves no rows behind referencing
--     them, and their access token stops working on the next call.
--   * neither function takes a user id, so neither can be aimed at anybody.
-- =============================================================================
