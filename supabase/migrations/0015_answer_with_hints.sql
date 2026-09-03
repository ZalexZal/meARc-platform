-- =============================================================================
-- check_answer, rewritten around the cooldown and the price of a hint
-- =============================================================================
--
-- Three changes it could not absorb as patches:
--
-- A **cooldown**. A wrong answer starts a clock on that team for that stop.
-- While it runs, check_answer returns `wait` with the seconds remaining rather
-- than checking anything. Enforced here, not in the app, because a timer in a
-- client is a suggestion.
--
-- **Hints cost points.** A team that opened two 5-point hints on a 30-point stop
-- earns 20. Never below zero: a stop cannot take points away for being hard.
--
-- **An afterword.** Returned only on a correct answer, and stored with the
-- answer rather than in markers.content - content ships to the phone through
-- markers_near before the stop is solved, and an afterword that alludes to the
-- answer would arrive with it.
--
-- Safe to run twice.
-- =============================================================================

begin;

-- ------------------------------------------------------- what a stop is worth
--
-- Its points, less the hints this team has opened on it, floored at zero.

create or replace function public.points_after_hints(p_team uuid, p_marker uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    coalesce((select a.points from public.marker_answers a where a.marker_id = p_marker), 0)
    - coalesce((
        select sum(h.cost)
        from public.hint_reveals r
        join public.marker_hints h on h.id = r.hint_id
        where r.team_id = p_team and h.marker_id = p_marker
      ), 0),
    0)::integer;
$$;

revoke all on function public.points_after_hints(uuid, uuid) from public, anon, authenticated;

-- --------------------------------------------------------------- reveal_hint
--
-- Returns the hint and records that this team has it. Charging happens when the
-- answer is scored, not here, so opening a hint after solving costs nothing -
-- which is the honest outcome: the points were already earned.

create or replace function public.reveal_hint(p_hint uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker uuid;
  v_world  uuid;
  v_team   uuid;
  v_body   jsonb;
  v_cost   integer;
begin
  select h.marker_id, h.body, h.cost into v_marker, v_body, v_cost
  from public.marker_hints h where h.id = p_hint;

  if v_marker is null then
    raise exception 'no such hint' using errcode = 'no_data_found';
  end if;

  select m.world_id into v_world from public.markers m where m.id = v_marker;

  if public.world_role(v_world) is null then
    raise exception 'not a member of this trail' using errcode = '42501';
  end if;

  v_team := public.ensure_team(v_world);

  insert into public.hint_reveals (team_id, hint_id, user_id)
  values (v_team, p_hint, auth.uid())
  on conflict (team_id, hint_id) do nothing;

  return jsonb_build_object('body', v_body, 'cost', v_cost,
                            'points_left', public.points_after_hints(v_team, v_marker));
end;
$$;

revoke all on function public.reveal_hint(uuid) from public, anon;
grant execute on function public.reveal_hint(uuid) to authenticated;

-- ------------------------------------------------- what a player may see of a stop
--
-- Hint headings and costs without their text, so a team can decide whether to
-- pay before they do. The body is not in here.

create or replace function public.marker_hint_list(p_marker uuid)
returns table (id uuid, ord integer, cost integer, revealed boolean)
language sql
stable
security definer
set search_path = public
as $$
  select h.id, h.ord, h.cost,
         exists (
           select 1 from public.hint_reveals r
           where r.hint_id = h.id
             and r.team_id = public.my_team(
                   (select m.world_id from public.markers m where m.id = h.marker_id))
         )
  from public.marker_hints h
  join public.markers m on m.id = h.marker_id
  where h.marker_id = p_marker
    and (public.world_role(m.world_id) is not null or public.world_is_open(m.world_id))
  order by h.ord;
$$;

revoke all on function public.marker_hint_list(uuid) from public, anon;
grant execute on function public.marker_hint_list(uuid) to authenticated;

-- ------------------------------------------------------------- check_answer

create or replace function public.check_answer(p_marker uuid, p_submitted text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_world    uuid;
  v_answer   public.marker_answers;
  v_team     uuid;
  v_verdict  text;
  v_points   integer := 0;
  v_norm     text;
  v_last     timestamptz;
  v_wait     integer;
  v_chosen   integer[];
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select m.world_id into v_world
  from public.markers m
  where m.id = p_marker and m.status = 'published';

  -- No such marker, or one the caller may not touch. Both answer the same way,
  -- so a stranger cannot map which ids are real by watching the errors.
  if v_world is null or public.world_role(v_world) is null then
    return jsonb_build_object('verdict', 'incorrect', 'points', 0);
  end if;

  select * into v_answer from public.marker_answers where marker_id = p_marker;

  if v_answer.marker_id is null then
    return jsonb_build_object('verdict', 'incorrect', 'points', 0);
  end if;

  v_team := public.ensure_team(v_world);

  -- Already solved. Say so plainly rather than starting a cooldown on a team
  -- that has done nothing wrong.
  if exists (select 1 from public.marker_progress
             where team_id = v_team and marker_id = p_marker) then
    return jsonb_build_object('verdict', 'correct',
                              'points', 0,
                              'already', true,
                              'after', v_answer.after_text);
  end if;

  -- The cooldown, measured from this team's last wrong answer at this stop.
  if v_answer.cooldown_seconds > 0 then
    select max(created_at) into v_last
    from public.marker_submissions
    where team_id = v_team and marker_id = p_marker and verdict = 'incorrect';

    if v_last is not null then
      v_wait := v_answer.cooldown_seconds
                - floor(extract(epoch from (now() - v_last)))::integer;

      if v_wait > 0 then
        -- Nothing is recorded and nothing is checked. A team that keeps
        -- pressing must not be able to use the reply as an oracle.
        return jsonb_build_object('verdict', 'wait', 'points', 0,
                                  'seconds_left', v_wait);
      end if;
    end if;
  end if;

  v_norm := lower(btrim(coalesce(p_submitted, '')));

  if v_answer.kind = 'free' then
    v_verdict := 'pending_review';

  elsif v_answer.kind = 'choice' then
    -- A comma-separated list of indices, because more than one may be right.
    -- The whole set has to match: a team that ticks one of two correct options
    -- has not answered the question.
    begin
      select coalesce(array_agg(distinct x::integer order by x::integer), '{}')
        into v_chosen
      from unnest(string_to_array(v_norm, ',')) as x
      where btrim(x) ~ '^[0-9]+$';
    exception when others then
      v_chosen := '{}';
    end;

    v_verdict := case
      when v_chosen @> (select coalesce(array_agg(distinct c order by c), '{}')
                        from unnest(v_answer.correct_choices) c)
       and v_chosen <@ (select coalesce(array_agg(distinct c order by c), '{}')
                        from unnest(v_answer.correct_choices) c)
       and array_length(v_chosen, 1) is not null
      then 'correct' else 'incorrect'
    end;

  else
    v_verdict := case
      when exists (select 1 from unnest(v_answer.accepted) a
                   where lower(btrim(a)) = v_norm)
      then 'correct' else 'incorrect'
    end;
  end if;

  if v_verdict = 'correct' then
    v_points := public.points_after_hints(v_team, p_marker);
  end if;

  insert into public.marker_submissions
    (marker_id, team_id, user_id, submitted, verdict)
  values
    (p_marker, v_team, auth.uid(), coalesce(p_submitted, ''), v_verdict);

  if v_verdict = 'correct' then
    perform public.award_progress(v_team, p_marker, v_points, auth.uid());
  end if;

  return jsonb_build_object(
    'verdict', v_verdict,
    'points',  v_points,
    -- Only on the way out, and only when it has been earned.
    'after',   case when v_verdict = 'correct' then v_answer.after_text else null end,
    'cooldown_seconds',
      case when v_verdict = 'incorrect' then v_answer.cooldown_seconds else null end
  );
end;
$$;

revoke all on function public.check_answer(uuid, text) from public, anon;
grant execute on function public.check_answer(uuid, text) to authenticated;

-- ------------------------------------------------------- review_answer follows
--
-- A free-text verdict has to charge hints the same way, or a team that bought
-- help on a written question keeps the full mark.

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

  v_points := public.points_after_hints(v_sub.team_id, v_sub.marker_id);

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

revoke all on function public.review_answer(uuid, boolean, text) from public, anon;
grant execute on function public.review_answer(uuid, boolean, text) to authenticated;

-- --------------------------------------------- the editor reads its own stops
--
-- Dropped rather than replaced: Postgres will not let CREATE OR REPLACE change
-- the output columns of a `returns table` function, and this gains four. Same
-- trap 0004 hit. Inside this transaction the gap does not exist for anybody.

drop function if exists public.trail_markers(uuid);

create function public.trail_markers(p_world uuid)
returns table (
  id          uuid,
  lat         double precision,
  lng         double precision,
  style_key   text,
  colour_hex  text,
  content     jsonb,
  step        integer,
  radius_m    integer,
  status      text,
  version     integer,
  answer_kind text,
  points      integer,
  cooldown_seconds integer,
  hint_count  bigint,
  media_count bigint,
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
    m.radius_m,
    m.status,
    m.version,
    a.kind,
    a.points,
    a.cooldown_seconds,
    (select count(*) from public.marker_hints h where h.marker_id = m.id),
    (select count(*) from public.marker_media d where d.marker_id = m.id),
    m.updated_at
  from public.markers m
  left join public.marker_answers a on a.marker_id = m.id
  where m.world_id = p_world
    and public.may_edit(p_world)
  order by coalesce(m.step, 2147483647), m.created_at;
$$;

revoke all on function public.trail_markers(uuid) from public, anon;
grant execute on function public.trail_markers(uuid) to authenticated;

-- ------------------------------------------------------- writing the answer

create or replace function public.set_marker_answer(
  p_marker           uuid,
  p_kind             text,
  p_accepted         text[]    default null,
  p_correct_choices  integer[] default null,
  p_points           integer   default 10,
  p_cooldown_seconds integer   default null,
  p_after_text       jsonb     default '{}'::jsonb
)
returns public.marker_answers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world uuid;
  v_row   public.marker_answers;
  v_cool  integer;
begin
  select m.world_id into v_world from public.markers m where m.id = p_marker;

  if v_world is null or not public.may_edit(v_world) then
    raise exception 'not yours to edit' using errcode = '42501';
  end if;

  -- A minute on a checked question, nothing on a written one: a human is
  -- deciding there anyway, so a cooldown would only punish spelling.
  v_cool := coalesce(p_cooldown_seconds, case when p_kind = 'free' then 0 else 60 end);

  insert into public.marker_answers
    (marker_id, kind, accepted, correct_choices, points, cooldown_seconds, after_text)
  values
    (p_marker, p_kind, coalesce(p_accepted, '{}'), coalesce(p_correct_choices, '{}'),
     p_points, v_cool, coalesce(p_after_text, '{}'::jsonb))
  on conflict (marker_id) do update
    set kind             = excluded.kind,
        accepted         = excluded.accepted,
        correct_choices  = excluded.correct_choices,
        points           = excluded.points,
        cooldown_seconds = excluded.cooldown_seconds,
        after_text       = excluded.after_text,
        updated_at       = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_marker_answer(uuid, text, text[], integer[], integer, integer, jsonb) from public, anon;
grant execute on function public.set_marker_answer(uuid, text, text[], integer[], integer, integer, jsonb) to authenticated;

-- The five-argument version from 0006 would still resolve and would silently
-- write the old single-index column that nothing reads any more.
drop function if exists public.set_marker_answer(uuid, text, text[], integer, integer);

-- --------------------------------------------------- placing, with a radius

create or replace function public.place_marker(
  p_world      uuid,
  p_lat        double precision,
  p_lng        double precision,
  p_content    jsonb   default '{}'::jsonb,
  p_style_key  text    default 'default',
  p_colour_hex text    default null,
  p_step       integer default null,
  p_status     text    default 'draft',
  p_radius_m   integer default 100
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
    (world_id, location, content, style_key, colour_hex, step, status, radius_m)
  values
    (p_world, st_makepoint(p_lng, p_lat)::geography, coalesce(p_content, '{}'::jsonb),
     nullif(trim(coalesce(p_style_key, '')), ''), p_colour_hex, p_step, p_status,
     coalesce(p_radius_m, 100))
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.place_marker(uuid, double precision, double precision, jsonb, text, text, integer, text, integer) from public, anon;
grant execute on function public.place_marker(uuid, double precision, double precision, jsonb, text, text, integer, text, integer) to authenticated;

drop function if exists public.place_marker(uuid, double precision, double precision, jsonb, text, text, integer, text);

-- ------------------------------------------- overlapping circles, as a warning
--
-- Not a constraint. A creator mid-edit will legitimately have two stops on top
-- of each other for a minute, and refusing the save would be worse than saying
-- so. The editor shows this; nothing blocks on it.

create or replace function public.overlapping_stops(p_world uuid)
returns table (a uuid, b uuid, metres double precision)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select m1.id, m2.id, st_distance(m1.location, m2.location)
  from public.markers m1
  join public.markers m2
    on m2.world_id = m1.world_id and m2.id > m1.id
  where m1.world_id = p_world
    and public.may_edit(p_world)
    and st_distance(m1.location, m2.location) < (m1.radius_m + m2.radius_m)
  order by 3;
$$;

revoke all on function public.overlapping_stops(uuid) from public, anon;
grant execute on function public.overlapping_stops(uuid) to authenticated;

commit;

-- =============================================================================
-- Verify from outside the dashboard:
--
--   * a wrong answer, then an immediate second attempt: verdict 'wait' with
--     seconds_left, and no new submission row.
--   * a choice question with two correct options: one of them is incorrect,
--     both is correct, both plus a third is incorrect.
--   * a 30-point stop with a 5-point hint revealed scores 25.
--   * check_answer returns after_text only on a correct verdict, never before.
--   * a player selecting marker_hints directly: zero rows.
-- =============================================================================
