-- 0028 - four modes, two kinds
--
-- Until now "mode" was a word on a row. Only ctf did anything at all: it
-- refused anonymous walkers. Everything else - points, the leaderboard, teams,
-- hints, the order markers are taken in - happened identically on every trail,
-- whatever it called itself.
--
-- There are two kinds of trail and two shapes of each:
--
--                ordered            unordered
--   scored       ctf                freefall
--   unscored     guide              educational
--
-- A game keeps score, ranks teams and charges for hints. A guide does none of
-- those and still asks questions, because a question is worth asking whether or
-- not anybody is counting. An ordered trail is walked one marker after another;
-- an unordered one is markers scattered across a town, each worth what its
-- creator says it is worth, taken in whatever order somebody finds them.
--
-- Two of these rules were previously enforced by the app alone, which is to say
-- not enforced: the order, and which markers a walker may see. Both are here
-- now. An app that receives coordinates and politely does not draw them is one
-- hand-written request away from giving the route away.
--
-- Safe to run twice.

begin;

-- --------------------------------------------------------------- what a mode is

create or replace function public.mode_is_scored(p_mode text)
returns boolean
language sql
immutable
as $$ select coalesce(p_mode, 'guide') in ('ctf', 'freefall') $$;

create or replace function public.mode_is_ordered(p_mode text)
returns boolean
language sql
immutable
as $$ select coalesce(p_mode, 'guide') in ('ctf', 'guide') $$;

comment on function public.mode_is_scored(text) is
  'Games keep score: ctf and freefall. Guides do not: guide and educational.';

comment on function public.mode_is_ordered(text) is
  'Ordered trails are walked one marker after another: ctf and guide. The '
  'unordered pair is markers scattered with no sequence between them.';

-- ------------------------------------------------------ revealing the route

alter table public.worlds
  add column if not exists reveal_one_at_a_time boolean not null default false;

comment on column public.worlds.reveal_one_at_a_time is
  'On an ordered trail, whether markers past the next one are hidden entirely - '
  'not sent, not only undrawn. Meaningless on an unordered trail, where there '
  'is no next.';

create or replace function public.world_reveals_one_at_a_time(p_world uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(w.reveal_one_at_a_time, false)
         and public.mode_is_ordered(w.mode)
  from public.worlds w
  where w.id = p_world;
$$;

-- How far along this caller's team is, as a step number. Markers at or below it
-- are theirs to see; anything past it has not been reached.
create or replace function public.next_step_for(p_world uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(min(m.step), 1)
  from public.markers m
  where m.world_id = p_world
    and m.status = 'published'
    and m.step > 0
    and not exists (
      select 1 from public.marker_progress mp
      where mp.marker_id = m.id
        and mp.team_id = public.my_team(p_world));
$$;

revoke all on function public.world_reveals_one_at_a_time(uuid) from public;
revoke all on function public.next_step_for(uuid) from public;
grant execute on function public.world_reveals_one_at_a_time(uuid) to anon, authenticated;
grant execute on function public.next_step_for(uuid) to anon, authenticated;

-- ----------------------------------------------------------- markers_near

CREATE OR REPLACE FUNCTION public.markers_near(p_world_id uuid, p_lat double precision, p_lng double precision, p_radius_m integer DEFAULT 500)
 RETURNS TABLE(id uuid, lat double precision, lng double precision, style_key text, colour_hex text, content jsonb, version integer, step integer, radius_m integer, distance_m double precision)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
  select
    m.id,
    st_y(m.location::geometry) as lat,
    st_x(m.location::geometry) as lng,
    m.style_key,
    m.colour_hex,
    m.content,
    m.version,
    m.step,
    m.radius_m,
    st_distance(m.location, st_makepoint(p_lng, p_lat)::geography) as distance_m
  from public.markers m
  where m.world_id = p_world_id
    and m.status   = 'published'
    and (public.world_role(p_world_id) is not null
         or public.world_is_open(p_world_id))
    and st_dwithin(m.location, st_makepoint(p_lng, p_lat)::geography,
                   least(greatest(p_radius_m, 1), 5000))
    -- One at a time, when the trail says so.
    --
    -- Not drawn by the app: not sent. A walker who has not reached marker four
    -- has not earned its coordinates, and an app that receives them and chooses
    -- not to draw them is one request away from giving the route away.
    --
    -- The creator of the trail is exempt, or they could not build it.
    and (
      public.world_role(p_world_id) in ('owner', 'editor')
      or not public.world_reveals_one_at_a_time(p_world_id)
      or m.step is null
      or m.step <= 0
      or m.step <= public.next_step_for(p_world_id)
    )
  order by distance_m
  limit 100;
$function$;

-- ----------------------------------------------------------- check_answer

CREATE OR REPLACE FUNCTION public.check_answer(p_marker uuid, p_submitted text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
  v_done     public.marker_progress;
  v_skipped  boolean := false;
  v_deducted integer := 0;
  v_mode     text;
  v_scored   boolean;
  v_ordered  boolean;
  v_before   integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select m.world_id into v_world
  from public.markers m
  where m.id = p_marker and m.status = 'published';

  if v_world is null or public.world_role(v_world) is null then
    return jsonb_build_object('verdict', 'incorrect', 'points', 0);
  end if;

  select w.mode into v_mode from public.worlds w where w.id = v_world;

  v_scored  := public.mode_is_scored(v_mode);
  v_ordered := public.mode_is_ordered(v_mode);

  select * into v_answer from public.marker_answers where marker_id = p_marker;

  if v_answer.marker_id is null then
    return jsonb_build_object('verdict', 'incorrect', 'points', 0);
  end if;

  v_team := public.ensure_team(v_world);

  -- An ordered trail is ordered on the server, not only in the app.
  --
  -- Drawing the markers ahead as shut is a courtesy to whoever is looking at
  -- the screen; it stops nobody with a second phone and a copy of the request.
  -- So the rule lives here: every published marker with a lower step has to be
  -- done - solved or skipped, either counts as having been dealt with - before
  -- this one will be looked at.
  if v_ordered then
    select count(*) into v_before
    from public.markers m
    where m.world_id = v_world
      and m.status = 'published'
      and m.step > 0
      and m.step < (select coalesce(m2.step, 0) from public.markers m2 where m2.id = p_marker)
      and not exists (
        select 1 from public.marker_progress mp
        where mp.team_id = v_team and mp.marker_id = m.id);

    if v_before > 0 then
      return jsonb_build_object(
        'verdict', 'out_of_order',
        'points',  0,
        'waiting', v_before);
    end if;
  end if;

  -- ADDITION 1: a finished stop may be finished either way.
  --
  -- This branch used to answer 'correct' for any progress row, and a skipped
  -- stop is a progress row - so under the skip rule, getting it wrong once and
  -- pressing again would have congratulated the team.
  select * into v_done
  from public.marker_progress
  where team_id = v_team and marker_id = p_marker;

  if v_done.marker_id is not null then
    if v_done.skipped then
      return jsonb_build_object('verdict', 'incorrect',
                                'points', 0,
                                'already', true,
                                'skipped', true);
    end if;

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
    -- A guide asks questions and keeps no score. Right and wrong still mean
    -- something to the person answering; they are worth nothing to anybody
    -- else, which is the whole difference between a guide and a game.
    v_points := case when v_scored
                     then public.points_after_hints(v_team, p_marker)
                     else 0 end;
  end if;

  insert into public.marker_submissions
    (marker_id, team_id, user_id, submitted, verdict)
  values
    (p_marker, v_team, auth.uid(), coalesce(p_submitted, ''), v_verdict);

  if v_verdict = 'correct' then
    perform public.award_progress(v_team, p_marker, v_points, auth.uid());
  end if;

  -- ADDITION 2: the skip rule ends the stop.
  --
  -- Written straight into marker_progress rather than through award_progress,
  -- which is granted to nobody and whose signature every other caller depends
  -- on. The row exists so the next-stop strip stops sending the walker back;
  -- the flag exists so the leaderboard does not call it a solve.
  if v_verdict = 'incorrect' and v_answer.on_wrong = 'skip' then
    insert into public.marker_progress (team_id, marker_id, solved_by, points, skipped)
    values (v_team, p_marker, auth.uid(), 0, true)
    on conflict (team_id, marker_id) do nothing;

    v_skipped := true;
  end if;

  -- ADDITION 3: what this wrong answer cost.
  --
  -- Reported, not applied. The deduction lives in points_after_hints and is
  -- recomputed from the submissions every time, so there is no running total
  -- here that could drift from the record.
  if v_scored and v_verdict = 'incorrect' and v_answer.on_wrong = 'deduct' then
    v_deducted := v_answer.deduct_points;
  end if;

  return jsonb_build_object(
    'verdict',  v_verdict,
    'points',   v_points,
    'on_wrong', v_answer.on_wrong,
    'skipped',  v_skipped,
    'deducted', v_deducted,
    'after',    case when v_verdict = 'correct' then v_answer.after_text else null end,
    'cooldown_seconds',
      case when v_verdict = 'incorrect' then v_answer.cooldown_seconds else null end
  );
end;
$function$;

-- ----------------------------------------------------------------- teams

CREATE OR REPLACE FUNCTION public.create_team(p_world uuid, p_name text)
 RETURNS teams
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team public.teams;
begin
  perform public.assert_may_play(p_world);

  -- A guide has no teams. There is nothing to be on a team for: no points, no
  -- ranking, nobody to be ahead of. The solo row ensure_team makes to hang
  -- progress on is not a team anybody is shown.
  if not public.mode_is_scored((select w.mode from public.worlds w where w.id = p_world)) then
    raise exception 'this trail is a guide, not a game' using errcode = '42501';
  end if;

  if public.my_team(p_world) is not null then
    raise exception 'already on a team for this trail'
      using errcode = 'unique_violation';
  end if;

  insert into public.teams (world_id, name, invite_code, created_by)
  values (p_world, trim(p_name), public.new_team_code(), auth.uid())
  returning * into v_team;

  insert into public.team_members (team_id, user_id)
  values (v_team.id, auth.uid());

  return v_team;
end;
$function$;

CREATE OR REPLACE FUNCTION public.join_team(p_code text)
 RETURNS teams
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team public.teams;
begin
  select * into v_team
  from public.teams
  where upper(trim(invite_code)) = upper(trim(p_code));

  if v_team.id is null then
    raise exception 'no team with that code' using errcode = 'no_data_found';
  end if;

  perform public.assert_may_play(v_team.world_id);

  if not public.mode_is_scored(
       (select w.mode from public.worlds w where w.id = v_team.world_id)) then
    raise exception 'this trail is a guide, not a game' using errcode = '42501';
  end if;

  -- The size cap and the one-team rule live in the trigger, so this insert
  -- raises rather than needing to repeat them.
  insert into public.team_members (team_id, user_id)
  values (v_team.id, auth.uid())
  on conflict (team_id, user_id) do nothing;

  return v_team;
end;
$function$;

-- --------------------------------------------------------------- the details

CREATE OR REPLACE FUNCTION public.marker_detail(p_marker uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_world   uuid;
  v_content jsonb;
  v_answer  public.marker_answers;
  v_media   jsonb;
  v_hints   jsonb;
  v_task    jsonb;
begin
  select m.world_id, m.content
    into v_world, v_content
  from public.markers m
  where m.id = p_marker
    and m.status = 'published';

  if v_world is null
     or not (public.world_role(v_world) is not null
             or public.world_is_open(v_world)) then
    return jsonb_build_object('media', '[]'::jsonb, 'hints', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(
           jsonb_build_object('kind', d.kind, 'path', d.path, 'ord', d.ord)
           order by d.ord, d.created_at
         ), '[]'::jsonb)
    into v_media
  from public.marker_media d
  where d.marker_id = p_marker;

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id', h.id, 'ord', h.ord, 'cost', h.cost,
             'revealed', exists (
               select 1 from public.hint_reveals r
               where r.hint_id = h.id and r.team_id = public.my_team(v_world)),
             'body', case
               when exists (select 1 from public.hint_reveals r
                            where r.hint_id = h.id and r.team_id = public.my_team(v_world))
               then h.body else null end
           ) order by h.ord
         ), '[]'::jsonb)
    into v_hints
  from public.marker_hints h
  where h.marker_id = p_marker
    -- None on a guide. A hint costs points, and where nothing is scored it is
    -- the answer with an extra tap in front of it.
    and public.mode_is_scored((select w.mode from public.worlds w where w.id = v_world));

  select * into v_answer from public.marker_answers where marker_id = p_marker;

  if v_answer.marker_id is not null then
    v_task := jsonb_build_object(
      'kind',             v_answer.kind,
      'points',           v_answer.points,
      'cooldown_seconds', v_answer.cooldown_seconds,
      'on_wrong',         v_answer.on_wrong,
      'lock_seconds',     v_answer.cooldown_seconds,
      'deduct',           v_answer.deduct_points,
      'prompt', jsonb_build_object(
        'bg', v_content -> 'bg' ->> 'question',
        'en', v_content -> 'en' ->> 'question'
      ),
      'after', v_answer.after_text
    );

    if v_answer.kind = 'choice' then
      v_task := v_task || jsonb_build_object(
        'options', coalesce((
          select jsonb_agg(
                   jsonb_build_object(
                     'bg', bg.value,
                     'en', coalesce(
                             v_content -> 'en' -> 'choices' ->> (bg.ordinality::int - 1),
                             bg.value)
                   ) order by bg.ordinality)
            from jsonb_array_elements_text(
                   coalesce(v_content -> 'bg' -> 'choices', '[]'::jsonb)
                 ) with ordinality as bg(value, ordinality)
        ), '[]'::jsonb)
      );
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'media', v_media,
    'hints', v_hints,
    'task',  v_task
  ));
end;
$function$;

commit;

notify pgrst, 'reload schema';
