-- =============================================================================
-- What happens when somebody gets it wrong
-- =============================================================================
--
-- MARKER-CONTENT.md has promised four rules since it was written - retry, lock,
-- deduct, skip - and the app has a screen for each of them. The schema has never
-- held any of them. marker_answers has cooldown_seconds and nothing else, so
-- MarkerTask.on_wrong, .lock_seconds and .deduct have had no source for their
-- entire existence, and three of those four screens could never appear.
--
-- --- two of the four are the same rule
--
-- retry means "try again". lock means "try again in a while". That is one
-- mechanism with the dial at zero or not, and cooldown_seconds already is that
-- dial - the 'wait' verdict has been shipping it all along.
--
-- They are both kept because they are different to a creator: choosing "lock"
-- is choosing to make a wrong answer cost time, and choosing "retry" is choosing
-- that it should not. Naming that is worth a column. Pretending they are
-- separate machinery would not be.
--
-- deduct and skip are genuinely new behaviour.
--
-- --- where a deduction comes off
--
-- Not off the team's total: there is no total to take from until a stop is
-- solved, and a penalty that vanishes if you never solve it is not a penalty.
--
-- It comes off what the stop is still worth, exactly as a revealed hint does.
-- points_after_hints already computes that, so wrong answers simply join hints
-- as a thing that has been spent. A stop cannot go below zero and cannot go
-- negative for the team.
--
-- --- and a skipped stop is not a solved one
--
-- Skipping writes a marker_progress row, because the walker is finished there
-- and the strip must stop sending them back. But world_leaderboard counts those
-- rows as stops_solved, so without the flag a trail could be "completed" by
-- getting every question wrong.
--
-- Safe to run twice.
-- =============================================================================

begin;

-- ------------------------------------------------------------- 1. the rule

alter table public.marker_answers
  add column if not exists on_wrong text not null default 'retry',
  add column if not exists deduct_points integer not null default 0;

alter table public.marker_answers drop constraint if exists marker_answers_on_wrong;
alter table public.marker_answers
  add constraint marker_answers_on_wrong
  check (on_wrong in ('retry','lock','deduct','skip'));

alter table public.marker_answers drop constraint if exists marker_answers_deduct;
alter table public.marker_answers
  add constraint marker_answers_deduct
  check (deduct_points between 0 and 1000);

comment on column public.marker_answers.on_wrong is
  'retry | lock | deduct | skip. retry and lock are the same machinery - '
  'cooldown_seconds at zero or not - and are separate words because the choice '
  'means something different to a creator. deduct takes deduct_points off what '
  'the stop is still worth. skip ends the stop on the first wrong answer.';

comment on column public.marker_answers.deduct_points is
  'Taken off the stop''s value per wrong answer, under the deduct rule. Spent '
  'the same way a revealed hint is spent; the stop cannot fall below zero.';

-- --------------------------------------------------------- 2. a skipped stop

alter table public.marker_progress
  add column if not exists skipped boolean not null default false;

comment on column public.marker_progress.skipped is
  'The walker is finished here without having answered it. Counts as done for '
  'the next-stop strip and NOT as solved for the leaderboard.';

-- --------------------------------------- 3. what a stop is still worth
--
-- Same name, because check_answer and review_answer both call it and neither
-- should have to know that the arithmetic grew a term.

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
      ), 0)
    -- Wrong answers, but only where the creator asked for them to cost
    -- something. Counted from the submissions themselves, so the arithmetic is
    -- reconstructible from the record rather than kept in a running total that
    -- could drift from it.
    - coalesce((
        select a.deduct_points * count(*)
        from public.marker_submissions s
        join public.marker_answers a on a.marker_id = s.marker_id
        where s.marker_id = p_marker
          and s.team_id  = p_team
          and s.verdict  = 'incorrect'
          and a.on_wrong = 'deduct'
        group by a.deduct_points
      ), 0),
    0)::integer;
$$;

revoke all on function public.points_after_hints(uuid, uuid) from public, anon, authenticated;

-- ----------------------------------------------- 4. the leaderboard counts solves
--
-- A faithful copy of 0009's function with one clause changed. Everything else -
-- the infinity fallback in the ranking, on_team for is_mine, dropping teams that
-- have done nothing, the order by 1, name - is reproduced exactly, because this
-- is a behaviour change to one count and not an invitation to rewrite the board.

create or replace function public.world_leaderboard(p_world uuid)
returns table (
  rank            bigint,
  team_id         uuid,
  team_name       text,
  points          bigint,
  stops_solved    bigint,
  started_at      timestamptz,
  last_solve_at   timestamptz,
  elapsed_seconds integer,
  pending         bigint,
  is_mine         boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with visible as (
    select public.world_role(p_world) is not null
        or public.world_is_open(p_world) as ok
  ),
  scored as (
    select
      t.id,
      t.name,
      t.started_at,
      coalesce(sum(mp.points), 0)                        as points,
      -- The one change. Skipped stops are done, not solved: without the filter
      -- a team could "complete" a trail by getting every question wrong.
      count(mp.marker_id) filter (where not mp.skipped)  as stops_solved,
      max(mp.solved_at)                                  as last_solve_at,
      (select count(*)
         from public.marker_submissions s
         join public.markers m on m.id = s.marker_id
        where s.team_id = t.id
          and m.world_id = p_world
          and s.verdict = 'pending_review')              as pending
    from public.teams t
    left join public.marker_progress mp on mp.team_id = t.id
    where t.world_id = p_world
    group by t.id, t.name, t.started_at
  )
  select
    rank() over (order by s.points desc,
                          coalesce(extract(epoch from (s.last_solve_at - s.started_at)),
                                   'infinity'::double precision) asc),
    s.id,
    s.name,
    s.points,
    s.stops_solved,
    s.started_at,
    s.last_solve_at,
    case
      when s.started_at is null or s.last_solve_at is null then null
      else extract(epoch from (s.last_solve_at - s.started_at))::integer
    end,
    s.pending,
    public.on_team(s.id)
  from scored s, visible v
  where v.ok
    -- A team that has done nothing is not on the board. It has not started, so
    -- there is nothing to rank and a wall of zeroes reads as a broken page. A
    -- team whose only rows are skips has done nothing scoring, and lands here
    -- for the same reason.
    and (s.stops_solved > 0 or s.pending > 0)
  order by 1, s.name;
$$;

revoke all on function public.world_leaderboard(uuid) from public;
grant execute on function public.world_leaderboard(uuid) to anon, authenticated;

-- ------------------------------------------------------ 5. check_answer obeys it
--
-- A faithful copy of 0015's function with three additions, marked below. The
-- cooldown arithmetic, the oracle guard on the wait branch, the choice-set
-- comparison and the hint charging are reproduced exactly.

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
  v_done     public.marker_progress;
  v_skipped  boolean := false;
  v_deducted integer := 0;
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

  select * into v_answer from public.marker_answers where marker_id = p_marker;

  if v_answer.marker_id is null then
    return jsonb_build_object('verdict', 'incorrect', 'points', 0);
  end if;

  v_team := public.ensure_team(v_world);

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
    v_points := public.points_after_hints(v_team, p_marker);
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
  if v_verdict = 'incorrect' and v_answer.on_wrong = 'deduct' then
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

revoke all on function public.check_answer(uuid, text) from public, anon;
grant execute on function public.check_answer(uuid, text) to authenticated;

-- ------------------------------------------------ 6. the phone is told the rule
--
-- marker_detail's task gains the three fields MarkerTask has always had and
-- never received. lock_seconds is cooldown_seconds under the name the app uses,
-- because to a walker the two are the same fact.

create or replace function public.marker_detail(p_marker uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
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
  where h.marker_id = p_marker;

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
$$;

revoke all on function public.marker_detail(uuid) from public;
grant execute on function public.marker_detail(uuid) to anon, authenticated;

-- --------------------------------------------- 7. the creator can choose it
--
-- Two more arguments with defaults, so the portal's existing call keeps working
-- until it is updated. The old seven-argument signature is dropped afterwards:
-- left in place it would sit beside this one as an overload, and a call naming
-- its arguments would become ambiguous.

create or replace function public.set_marker_answer(
  p_marker           uuid,
  p_kind             text,
  p_accepted         text[]    default null,
  p_correct_choices  integer[] default null,
  p_points           integer   default 10,
  p_cooldown_seconds integer   default null,
  p_after_text       jsonb     default '{}'::jsonb,
  p_on_wrong         text      default 'retry',
  p_deduct_points    integer   default 0
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

  -- "lock" is the rule that means the cooldown is the point, so a lock of zero
  -- is a contradiction the creator did not intend.
  if p_on_wrong = 'lock' and v_cool <= 0 then
    v_cool := 60;
  end if;

  insert into public.marker_answers as a
    (marker_id, kind, accepted, correct_choices, points, cooldown_seconds,
     after_text, on_wrong, deduct_points)
  values
    (p_marker, p_kind,
     coalesce(p_accepted, '{}'),
     coalesce(p_correct_choices, '{}'),
     p_points,
     v_cool,
     coalesce(p_after_text, '{}'::jsonb),
     coalesce(nullif(trim(coalesce(p_on_wrong, '')), ''), 'retry'),
     greatest(coalesce(p_deduct_points, 0), 0))
  on conflict (marker_id) do update
    set kind             = excluded.kind,
        accepted         = excluded.accepted,
        correct_choices  = excluded.correct_choices,
        points           = excluded.points,
        cooldown_seconds = excluded.cooldown_seconds,
        after_text       = excluded.after_text,
        on_wrong         = excluded.on_wrong,
        deduct_points    = excluded.deduct_points,
        updated_at       = now()
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_marker_answer(uuid, text, text[], integer[], integer, integer, jsonb, text, integer) from public, anon;
grant execute on function public.set_marker_answer(uuid, text, text[], integer[], integer, integer, jsonb, text, integer) to authenticated;

drop function if exists public.set_marker_answer(uuid, text, text[], integer[], integer, integer, jsonb);

commit;
