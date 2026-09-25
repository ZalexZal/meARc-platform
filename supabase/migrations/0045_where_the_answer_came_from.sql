-- =============================================================================
-- 0045  Where the answer came from
--
-- Until now the only thing standing between a scored stop and somebody on a
-- sofa was the app choosing not to show the question. Anybody with a copy of
-- the request - or a fake-location app, which is two taps from the Play Store -
-- could answer every stop of a competition without leaving the house.
--
-- So on a trail with a score the phone now sends where it is with every
-- answer, and the server asks three things before it looks at the answer:
--
--   mock  the phone itself says the position is simulated. Android marks every
--         fix that comes from a mock provider; the app reads that flag.
--   far   further from the stop than its radius, plus the fix's own accuracy
--         (capped at 200 m), plus 200 m of slack. Generous on purpose: this is
--         to stop answers from across town, not to argue about a doorway.
--   fast  further from this person's last accepted answer than anyone could
--         have travelled since: more than 300 m net of both fixes' accuracy, at
--         more than 60 m/s (216 km/h). A spoofer that hides the mock flag still
--         has to move the fake position somewhere, and it teleports.
--
-- An answer that fails is not judged, not recorded and not counted against
-- the cooldown; the team is told why in words. Failures are written down for
-- the trail's organiser (position_flags), who is the person who can decide it
-- was cheating - a warning is evidence, not a verdict.
--
-- What is kept, deliberately little: the last accepted position per person,
-- overwritten each time and gone after a day (player_fixes), and for each
-- refusal only its kind, distance and speed - never coordinates.
--
-- Guides and educational trails keep no score and are asked nothing.
-- =============================================================================

begin;

create table public.player_fixes (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  lat        double precision not null,
  lng        double precision not null,
  accuracy_m real not null,
  at         timestamptz not null default now()
);

create index player_fixes_at on public.player_fixes (at);

-- Nobody reads this but position_problem.
alter table public.player_fixes enable row level security;

create table public.position_flags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references public.profiles(id) on delete cascade,
  world_id   uuid not null references public.worlds(id) on delete cascade,
  marker_id  uuid references public.markers(id) on delete set null,
  team_id    uuid references public.teams(id) on delete set null,
  problem    text not null check (problem in ('mock', 'far', 'fast')),
  distance_m real,
  speed_mps  real,
  created_at timestamptz not null default now()
);

create index position_flags_team on public.position_flags (team_id);
create index position_flags_world on public.position_flags (world_id);

-- Read through world_teams, by the organiser only.
alter table public.position_flags enable row level security;

create or replace function public.position_problem(
  p_marker   uuid,
  p_lat      double precision,
  p_lng      double precision,
  p_accuracy double precision,
  p_mock     boolean
)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_marker  public.markers;
  v_here    geography;
  v_acc     double precision;
  v_far     double precision;
  v_fix     public.player_fixes;
  v_moved   double precision;
  v_speed   double precision;
  v_problem text;
begin
  select * into v_marker from public.markers where id = p_marker;

  if v_marker.id is null then
    return 'no_position';
  end if;

  -- Old positions are not evidence of anything and are not ours to keep.
  delete from public.player_fixes where at < now() - interval '1 day';

  if coalesce(p_mock, false) then
    v_problem := 'mock';

  elsif p_lat is null or p_lng is null
        or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    -- Not a warning: a phone with location off is not cheating, it is asked
    -- to turn it on.
    return 'no_position';

  else
    v_here := st_makepoint(p_lng, p_lat)::geography;
    v_acc  := least(greatest(coalesce(p_accuracy, 50), 0), 200);
    v_far  := st_distance(v_marker.location, v_here);

    if v_far > coalesce(v_marker.radius_m, 100) + v_acc + 200 then
      v_problem := 'far';
    else
      select * into v_fix from public.player_fixes where user_id = auth.uid();

      if v_fix.user_id is not null then
        v_moved := greatest(
          st_distance(st_makepoint(v_fix.lng, v_fix.lat)::geography, v_here)
            - v_fix.accuracy_m - v_acc, 0);
        v_speed := v_moved / greatest(extract(epoch from (now() - v_fix.at)), 1);

        if v_moved > 300 and v_speed > 60 then
          v_problem := 'fast';
        end if;
      end if;
    end if;
  end if;

  if v_problem is null then
    insert into public.player_fixes (user_id, lat, lng, accuracy_m, at)
    values (auth.uid(), p_lat, p_lng, v_acc, now())
    on conflict (user_id) do update
      set lat = excluded.lat, lng = excluded.lng,
          accuracy_m = excluded.accuracy_m, at = excluded.at;
    return 'ok';
  end if;

  -- One warning per person, stop and kind a minute. Somebody pressing the
  -- button ten times from the sofa is one thing to tell the organiser, not ten.
  if not exists (select 1 from public.position_flags f
                 where f.user_id = auth.uid() and f.marker_id = p_marker
                   and f.problem = v_problem
                   and f.created_at > now() - interval '1 minute') then
    insert into public.position_flags
      (user_id, world_id, marker_id, team_id, problem, distance_m, speed_mps)
    values
      (auth.uid(), v_marker.world_id, p_marker, public.my_team(v_marker.world_id),
       v_problem, v_far, v_speed);
  end if;

  return v_problem;
end;
$$;

revoke all on function public.position_problem(uuid, double precision, double precision, double precision, boolean)
  from public, anon, authenticated;

-- The old two-argument check_answer goes, or a call without a position would
-- still find it and skip every check below.
drop function public.check_answer(uuid, text);

create function public.check_answer(
  p_marker    uuid,
  p_submitted text,
  p_lat       double precision default null,
  p_lng       double precision default null,
  p_accuracy  double precision default null,
  p_mock      boolean default null
)
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
  v_last_by  uuid;
  v_forgive  boolean := false;
  v_wait     integer;
  v_chosen   integer[];
  v_done     public.marker_progress;
  v_skipped  boolean := false;
  v_deducted integer := 0;
  v_mode     text;
  v_scored   boolean;
  v_ordered  boolean;
  v_before   integer;
  v_where    text;
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

  -- Nothing counts after the whistle.
  if exists (select 1 from public.worlds w
             where w.id = v_world and w.ended_at is not null) then
    raise exception 'this game has ended' using errcode = 'P0001';
  end if;

  select w.mode into v_mode from public.worlds w where w.id = v_world;

  v_scored  := public.mode_is_scored(v_mode);
  v_ordered := public.mode_is_ordered(v_mode);

  select * into v_answer from public.marker_answers where marker_id = p_marker;

  if v_answer.marker_id is null then
    return jsonb_build_object('verdict', 'incorrect', 'points', 0);
  end if;

  -- Where the phone was. Only where it matters: on a trail with a score, an
  -- answer from the sofa takes points from a team that walked. A guide keeps
  -- no score, so it is asked nothing and nothing about it is kept. See
  -- position_problem for what counts, and 0045 for why.
  if v_scored then
    v_where := public.position_problem(p_marker, p_lat, p_lng, p_accuracy, p_mock);

    if v_where <> 'ok' then
      return jsonb_build_object('verdict', 'position', 'points', 0, 'problem', v_where);
    end if;
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

  -- The cooldown, measured from this team's last wrong answer at this stop.
  --
  -- Judged first now, because the cooldown has to be able to tell a retry from
  -- a coincidence, and it cannot do that without knowing whether this answer is
  -- right. Nothing about the verdict leaves this function while a wait is in
  -- force: the reply below is the same whatever was submitted, so a team that
  -- keeps pressing still cannot use it as an oracle.
  if v_answer.cooldown_seconds > 0 then
    select created_at, user_id into v_last, v_last_by
    from public.marker_submissions
    where team_id = v_team and marker_id = p_marker and verdict = 'incorrect'
    order by created_at desc
    limit 1;

    if v_last is not null then
      v_wait := v_answer.cooldown_seconds
                - floor(extract(epoch from (now() - v_last)))::integer;

      -- An answer that was already on its way is not a retry.
      --
      -- Two people on one team both press, because neither knows the other is
      -- about to. The wrong one lands first by a few milliseconds, starts the
      -- team's minute, and the right one - sent before anybody had been told
      -- anything - is refused. The team loses the stop and waits, and which of
      -- them arrives first is chance. Ten teams of two produced this in about
      -- one race in three.
      --
      -- So a correct answer is forgiven the wait when it came from a different
      -- member and within a few seconds of the wrong one. Both halves matter:
      -- the same person answering twice is a retry however fast they are, and
      -- three seconds is shorter than it takes to read a refusal and choose
      -- again, but far longer than two thumbs moving at once.
      --
      -- It is not a way round the cooldown. The answer still has to be right.
      v_forgive := v_verdict = 'correct'
                   and v_last_by is distinct from auth.uid()
                   and now() - v_last < interval '3 seconds';

      if v_wait > 0 and not v_forgive then
        -- Nothing is recorded and nothing is given away.
        return jsonb_build_object('verdict', 'wait', 'points', 0,
                                  'seconds_left', v_wait);
      end if;
    end if;
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
$$;

revoke all on function public.check_answer(uuid, text, double precision, double precision, double precision, boolean)
  from public, anon;
grant execute on function public.check_answer(uuid, text, double precision, double precision, double precision, boolean)
  to authenticated;

-- ------------------------------------------------------------------ the organiser's view
--
-- world_teams gains the warnings, counted by kind, so the team card on the
-- board can say "3 answers from a faked position" beside the moderator's
-- controls. Appended as the last column so nothing reading by position moves.

drop function public.world_teams(uuid);

create function public.world_teams(p_world uuid)
returns table (
  id uuid, name text, invite_code text, started_at timestamptz, members jsonb,
  solved bigint, points bigint, adjusted bigint, disqualified_at timestamptz,
  disqualified_reason text, warnings jsonb
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.world_role(p_world) is distinct from 'owner' and not public.is_admin() then
    raise exception 'not yours' using errcode = '42501';
  end if;

  return query
  select
    t.id,
    t.name,
    t.invite_code,
    t.started_at,
    coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'name', coalesce(nullif(trim(p.display_name), ''), 'Player'),
                 'joined_at', tm.joined_at
               ) order by tm.joined_at)
        from public.team_members tm
        left join public.profiles p on p.id = tm.user_id
       where tm.team_id = t.id), '[]'::jsonb),
    (select count(*) from public.marker_progress mp
      where mp.team_id = t.id and not mp.skipped),
    (select coalesce(sum(mp.points), 0) from public.marker_progress mp
      where mp.team_id = t.id),
    (select coalesce(sum(a.points), 0) from public.team_adjustments a
      where a.team_id = t.id),
    t.disqualified_at,
    t.disqualified_reason,
    (select coalesce(jsonb_object_agg(f.problem, f.n), '{}'::jsonb)
       from (select problem, count(*) as n from public.position_flags
              where team_id = t.id group by problem) f)
  from public.teams t
  where t.world_id = p_world
  order by t.created_at;
end;
$$;

revoke all on function public.world_teams(uuid) from public, anon;
grant execute on function public.world_teams(uuid) to authenticated;

commit;
