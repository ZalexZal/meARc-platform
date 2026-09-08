-- 0034 - a race at the stop
--
-- Ten teams of two walked a trail against this database at the same time, which
-- nothing had ever done. The straightforward load was fine: twenty phones
-- answering one marker in the same instant, scored once each, in three hundred
-- milliseconds. Then the two phones on a team were made to disagree, and one
-- race in three came out like this:
--
--   phone A answers correctly, phone B answers wrongly, same instant
--   B lands first, records an incorrect submission, starts the team's cooldown
--   A arrives four milliseconds later and is refused with 'wait'
--   the team scores nothing for that stop and waits a minute
--
-- Which of the two lands first is chance, so two identical teams could differ
-- by a whole stop on a coin toss.
--
-- The cooldown is right to exist - it is what stops somebody tapping every
-- option in turn - and it is right to be per team, because progress is per
-- team. What it cannot tell, as written, is the difference between somebody
-- trying again after being told they were wrong and somebody whose answer was
-- already in flight when that happened. Now it can: the answer is judged before
-- the cooldown decides, and a correct one is forgiven the wait when it came
-- from a different member within three seconds of the wrong one.
--
-- Nothing leaks. The reply during a wait is unchanged and says nothing about
-- what was submitted.
--
-- Safe to run twice.

begin;

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
$function$
;

revoke all on function public.check_answer(uuid, text) from public;
grant execute on function public.check_answer(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';
