-- =============================================================================
-- NULL is not false, and five guards were written as if it were
-- =============================================================================
--
-- Found by verify_flow.mjs, which signed in as somebody with no membership of a
-- trail and successfully placed a marker in it, then marked another team's
-- answer correct.
--
-- Every one of those functions guarded itself like this:
--
--     if public.world_role(p_world) not in ('owner','editor') then
--       raise exception 'not yours to edit';
--     end if;
--
-- For a member it reads correctly. For a stranger, world_role returns NULL, and
-- in SQL `NULL not in ('owner','editor')` is not true - it is NULL. A plpgsql IF
-- treats NULL as not-true, so the branch is skipped, no exception is raised, and
-- the function carries on and does the work.
--
-- The guard was inverted in exactly the case it existed for: it stopped members
-- with the wrong role and waved through people with no role at all.
--
-- The same five words appeared in five functions, so this fixes it in one place
-- instead of five: a helper that returns a real boolean and can never be NULL.
-- Anything asking "may this caller edit this trail" now asks that, and a future
-- function that forgets is a compile-time missing function rather than a silent
-- hole.
--
-- The two places that used the pattern inside a WHERE clause - trail_markers and
-- review_queue - were never affected: there, NULL filters the row out, which is
-- the safe direction. They are switched over anyway so one idea has one spelling.
--
-- Safe to run twice.
-- =============================================================================

begin;

-- ---------------------------------------------------------------- the helper

create or replace function public.may_edit(p_world uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- coalesce is the whole point. Without it this returns NULL for a stranger,
  -- and every caller has to remember that NULL is not false.
  select coalesce(public.world_role(p_world) in ('owner','editor'), false);
$$;

revoke all on function public.may_edit(uuid) from public, anon, authenticated;
grant execute on function public.may_edit(uuid) to authenticated;

comment on function public.may_edit(uuid) is
  'Whether the caller may change this trail. Always true or false, never null - '
  'the reason it exists is that world_role() returns null for a stranger and '
  '"null not in (...)" is null, which a plpgsql IF skips.';

-- --------------------------------------------------------- 1. place_marker

create or replace function public.place_marker(
  p_world      uuid,
  p_lat        double precision,
  p_lng        double precision,
  p_content    jsonb   default '{}'::jsonb,
  p_style_key  text    default 'default',
  p_colour_hex text    default null,
  p_step       integer default null,
  p_status     text    default 'draft'
)
returns public.markers
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.markers;
begin
  if not public.may_edit(p_world) then
    raise exception 'not yours to edit' using errcode = '42501';
  end if;

  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90
     or p_lng not between -180 and 180 then
    raise exception 'coordinates out of range' using errcode = 'check_violation';
  end if;

  insert into public.markers
    (world_id, location, content, style_key, colour_hex, step, status)
  values
    (p_world,
     st_makepoint(p_lng, p_lat)::geography,
     coalesce(p_content, '{}'::jsonb),
     nullif(trim(coalesce(p_style_key, '')), ''),
     p_colour_hex,
     p_step,
     p_status)
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------- 2. move_marker

create or replace function public.move_marker(
  p_marker uuid,
  p_lat    double precision,
  p_lng    double precision
)
returns public.markers
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_world uuid;
  v_row   public.markers;
begin
  select m.world_id into v_world from public.markers m where m.id = p_marker;

  if v_world is null or not public.may_edit(v_world) then
    raise exception 'not yours to edit' using errcode = '42501';
  end if;

  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90
     or p_lng not between -180 and 180 then
    raise exception 'coordinates out of range' using errcode = 'check_violation';
  end if;

  update public.markers
     set location = st_makepoint(p_lng, p_lat)::geography
   where id = p_marker
  returning * into v_row;

  return v_row;
end;
$$;

-- --------------------------------------------------- 3. set_marker_answer

create or replace function public.set_marker_answer(
  p_marker         uuid,
  p_kind           text,
  p_accepted       text[]  default null,
  p_correct_choice integer default null,
  p_points         integer default 10
)
returns public.marker_answers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world uuid;
  v_row   public.marker_answers;
begin
  select m.world_id into v_world from public.markers m where m.id = p_marker;

  if v_world is null or not public.may_edit(v_world) then
    raise exception 'not yours to edit' using errcode = '42501';
  end if;

  insert into public.marker_answers
    (marker_id, kind, accepted, correct_choice, points)
  values
    (p_marker, p_kind, coalesce(p_accepted, '{}'), p_correct_choice, p_points)
  on conflict (marker_id) do update
    set kind           = excluded.kind,
        accepted       = excluded.accepted,
        correct_choice = excluded.correct_choice,
        points         = excluded.points,
        updated_at     = now()
  returning * into v_row;

  return v_row;
end;
$$;

-- ------------------------------------------------- 4. clear_marker_answer

create or replace function public.clear_marker_answer(p_marker uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world uuid;
begin
  select m.world_id into v_world from public.markers m where m.id = p_marker;

  if v_world is null or not public.may_edit(v_world) then
    raise exception 'not yours to edit' using errcode = '42501';
  end if;

  delete from public.marker_answers where marker_id = p_marker;
end;
$$;

-- -------------------------------------------------------- 5. review_answer

create or replace function public.review_answer(
  p_submission uuid,
  p_correct    boolean,
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub    public.marker_submissions;
  v_world  uuid;
  v_points integer;
begin
  select * into v_sub from public.marker_submissions where id = p_submission;

  if v_sub.id is null then
    raise exception 'no such submission' using errcode = 'no_data_found';
  end if;

  select m.world_id into v_world from public.markers m where m.id = v_sub.marker_id;

  if v_world is null or not public.may_edit(v_world) then
    raise exception 'not yours to review' using errcode = '42501';
  end if;

  update public.marker_submissions
     set verdict     = case when p_correct then 'correct' else 'incorrect' end,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = p_note
   where id = p_submission;

  select coalesce(a.points, 0) into v_points
  from public.marker_answers a
  where a.marker_id = v_sub.marker_id;

  if p_correct then
    perform public.award_progress(v_sub.team_id, v_sub.marker_id,
                                  v_points, v_sub.user_id);
  else
    delete from public.marker_progress mp
    where mp.team_id = v_sub.team_id
      and mp.marker_id = v_sub.marker_id
      and not exists (
        select 1 from public.marker_submissions s
        where s.marker_id = v_sub.marker_id
          and s.team_id   = v_sub.team_id
          and s.id        <> p_submission
          and s.verdict   = 'correct'
      );
  end if;

  return jsonb_build_object(
    'verdict', case when p_correct then 'correct' else 'incorrect' end,
    'points',  case when p_correct then v_points else 0 end
  );
end;
$$;

-- ------------------------------------- 6. and the two that were already safe
--
-- NULL in a WHERE clause drops the row, so these were never exploitable. Changed
-- so that "may this caller edit" has one spelling everywhere and the next reader
-- does not have to work out which form is the careful one.

create or replace function public.trail_markers(p_world uuid)
returns table (
  id          uuid,
  lat         double precision,
  lng         double precision,
  style_key   text,
  colour_hex  text,
  content     jsonb,
  step        integer,
  status      text,
  version     integer,
  answer_kind text,
  points      integer,
  updated_at  timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    m.id,
    st_y(m.location::geometry),
    st_x(m.location::geometry),
    m.style_key,
    m.colour_hex,
    m.content,
    m.step,
    m.status,
    m.version,
    a.kind,
    a.points,
    m.updated_at
  from public.markers m
  left join public.marker_answers a on a.marker_id = m.id
  where m.world_id = p_world
    and public.may_edit(p_world)
  order by coalesce(m.step, 2147483647), m.created_at;
$$;

create or replace function public.review_queue(p_world uuid)
returns table (
  submission_id uuid,
  marker_id     uuid,
  marker_title  jsonb,
  team_name     text,
  submitted     text,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.marker_id, m.content, t.name, s.submitted, s.created_at
  from public.marker_submissions s
  join public.markers m on m.id = s.marker_id
  join public.teams   t on t.id = s.team_id
  where m.world_id = p_world
    and s.verdict = 'pending_review'
    and public.may_edit(p_world)
  order by s.created_at;
$$;

-- ------------------------------- 7. deleting an account that owns what it played
--
-- Also found by the verification run, on the way out rather than on the way in.
--
-- Somebody who owns a trail and has also answered questions on it is referenced
-- from two directions: worlds.owner_id cascades from their profile, and
-- marker_submissions.user_id is set to null when they go. Postgres can process
-- the SET NULL against a submission whose marker the cascade has already
-- removed, and re-checking that row's marker_id fails the foreign key. The
-- delete aborts, and the reason names marker_submissions - a table the person
-- pressing the button has never heard of.
--
-- Deleting their worlds first removes the submissions with them, so there is
-- nothing left to update by the time the user row goes.

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

  -- Teams whose only member is this person.
  delete from public.teams t
  where t.id in (
    select tm.team_id from public.team_members tm where tm.user_id = v_id
  )
  and (select count(*) from public.team_members o where o.team_id = t.id) = 1;

  -- Their trails, and everything inside them, before the user row goes. This is
  -- the same outcome the cascade would reach, in an order that cannot deadlock
  -- against its own foreign keys.
  delete from public.worlds where owner_id = v_id;

  delete from auth.users where id = v_id;
end;
$$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

commit;

-- =============================================================================
-- Verify from outside the dashboard:
--
--   * place_marker into a trail you are not a member of: 42501.
--   * review_answer on somebody else's trail: 42501.
--   * the same two calls as owner: still work.
--   * delete_my_account for a user who owns a trail they also played: no error.
-- =============================================================================
