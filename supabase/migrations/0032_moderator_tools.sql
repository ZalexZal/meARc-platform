-- 0032 - the moderator's three levers
--
-- On the day, something will go wrong that the trail cannot see. The AR marker
-- has blown over. The QR is in direct sun and no camera will read it. The
-- answer key has a typo and four teams are standing at the same stop arguing
-- with a phone. Every one of those ends a team's walk, and the only tool for it
-- so far has been a psql prompt held by whoever wrote the schema.
--
-- Three levers, because three cover it:
--
--   skip        the stop is done for that team, no points. They move on.
--   adjust      points added or taken away, with a reason, on the record.
--   disqualify  off the board, still in the database.
--
-- Nothing here deletes. A skip is a row that says skipped, an adjustment is a
-- row that says who and why, a disqualification is a timestamp and a reason. A
-- moderator acting in a hurry in a car park should not be able to destroy
-- anything, and afterwards it should be possible to read back what was done.
--
-- Safe to run twice.

begin;

-- ------------------------------------------------------------- who may do it
--
-- One function, because there will be three call sites and later a fourth, and
-- a rule copied four times is a rule that will be four different rules by the
-- spring. Co-creation is coming; when it does, this is the line that changes,
-- and the three levers inherit it without being touched.
--
-- An editor is deliberately not enough. Editing stops is a reason to be trusted
-- with the trail's content; it is not a reason to be handed the power to strike
-- a team off the board.

create or replace function public.can_moderate(p_world uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.world_role(p_world) = 'owner', false)
      or public.is_admin();
$$;

revoke all on function public.can_moderate(uuid) from public;
grant execute on function public.can_moderate(uuid) to authenticated;

-- -------------------------------------------------------------- disqualified
--
-- A column rather than a delete: the team's answers, their times and their walk
-- stay exactly where they are. They come off the board, which is the entire
-- point of disqualifying somebody, and nothing else about them moves.

alter table public.teams
  add column if not exists disqualified_at     timestamptz,
  add column if not exists disqualified_reason text,
  add column if not exists disqualified_by     uuid
    references public.profiles(id) on delete set null;

-- --------------------------------------------------------------- adjustments
--
-- Kept as rows and summed, not held as a running total on the team. The same
-- reasoning as points_after_hints: the arithmetic should be reconstructible
-- from the record. "Why does this team have 340?" then has an answer you can
-- read rather than a number you have to believe.

create table if not exists public.team_adjustments (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  points     integer not null,
  reason     text not null check (length(trim(reason)) between 1 and 200),
  made_by    uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  -- Zero is not an adjustment, it is a mistyped one.
  constraint team_adjustments_points_check check (points <> 0)
);

create index if not exists team_adjustments_team_idx
  on public.team_adjustments (team_id, created_at);

alter table public.team_adjustments enable row level security;

-- Readable by the team it was done to and by whoever may moderate the trail. A
-- team that loses 50 points is owed the sentence explaining why.
drop policy if exists team_adjustments_select on public.team_adjustments;
create policy team_adjustments_select on public.team_adjustments
  for select to authenticated
  using (
    public.on_team(team_id)
    or public.can_moderate((select t.world_id from public.teams t where t.id = team_id))
  );

-- No insert, update or delete policy, on purpose. Every write goes through
-- moderator_adjust below, which checks the trail and records who did it.

-- ------------------------------------------------------------- 1. skip a stop
--
-- Marked skipped, worth nothing. check_answer already treats a skipped stop as
-- dealt with for ordering, and world_leaderboard already refuses to count it as
-- a solve, so a team cannot be walked to the finish for free. Both of those
-- rules were written before this function existed and neither needs changing.

create or replace function public.moderator_skip(p_team uuid, p_marker uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world      uuid;
  v_team_world uuid;
begin
  select m.world_id into v_world from public.markers m where m.id = p_marker;
  select t.world_id into v_team_world from public.teams t where t.id = p_team;

  if v_world is null or v_team_world is null or v_world is distinct from v_team_world then
    raise exception 'that stop is not on that trail' using errcode = 'P0001';
  end if;

  if not public.can_moderate(v_world) then
    raise exception 'not yours to moderate' using errcode = '42501';
  end if;

  -- Already dealt with, by a skip or by actually answering it. Saying so beats
  -- silently doing nothing, and beats overwriting a real solve with a skip.
  if exists (select 1 from public.marker_progress
              where team_id = p_team and marker_id = p_marker) then
    return jsonb_build_object('skipped', false, 'reason', 'already done');
  end if;

  insert into public.marker_progress (team_id, marker_id, solved_by, points, skipped)
  values (p_team, p_marker, null, 0, true);

  return jsonb_build_object('skipped', true);
end;
$$;

revoke all on function public.moderator_skip(uuid, uuid) from public;
grant execute on function public.moderator_skip(uuid, uuid) to authenticated;

-- ------------------------------------------------------------ 2. move points

create or replace function public.moderator_adjust(p_team uuid, p_points integer,
                                                   p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world uuid;
  v_total bigint;
begin
  select t.world_id into v_world from public.teams t where t.id = p_team;

  if v_world is null then
    raise exception 'no such team' using errcode = 'P0001';
  end if;

  if not public.can_moderate(v_world) then
    raise exception 'not yours to moderate' using errcode = '42501';
  end if;

  if p_points = 0 then
    raise exception 'nothing to adjust' using errcode = 'P0001';
  end if;

  -- The reason is not optional. A team asking why they lost 50 points deserves
  -- better than a number that appeared, and a moderator who cannot say why in
  -- one line probably should not be moving the number.
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'say why' using errcode = 'P0001';
  end if;

  insert into public.team_adjustments (team_id, points, reason, made_by)
  values (p_team, p_points, left(trim(p_reason), 200), auth.uid());

  select coalesce(sum(points), 0) into v_total
  from public.team_adjustments where team_id = p_team;

  return jsonb_build_object('adjustment', p_points, 'adjusted_total', v_total);
end;
$$;

revoke all on function public.moderator_adjust(uuid, integer, text) from public;
grant execute on function public.moderator_adjust(uuid, integer, text) to authenticated;

-- --------------------------------------------------------- 3. off the board

create or replace function public.moderator_disqualify(p_team uuid, p_reason text,
                                                       p_on boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world uuid;
begin
  select t.world_id into v_world from public.teams t where t.id = p_team;

  if v_world is null then
    raise exception 'no such team' using errcode = 'P0001';
  end if;

  if not public.can_moderate(v_world) then
    raise exception 'not yours to moderate' using errcode = '42501';
  end if;

  if p_on then
    if p_reason is null or length(trim(p_reason)) = 0 then
      raise exception 'say why' using errcode = 'P0001';
    end if;

    update public.teams
       set disqualified_at     = now(),
           disqualified_reason = left(trim(p_reason), 200),
           disqualified_by     = auth.uid()
     where id = p_team;
  else
    -- Reversible, because moderators are people and the wrong row is one tap
    -- away from the right one.
    update public.teams
       set disqualified_at     = null,
           disqualified_reason = null,
           disqualified_by     = null
     where id = p_team;
  end if;

  return jsonb_build_object('disqualified', p_on);
end;
$$;

revoke all on function public.moderator_disqualify(uuid, text, boolean) from public;
grant execute on function public.moderator_disqualify(uuid, text, boolean) to authenticated;

-- ---------------------------------------------- the board reads both of them
--
-- 0019's function with two clauses added and nothing else touched, the same way
-- 0019 was 0009 with one clause changed. Adjustments join the sum; disqualified
-- teams do not appear.
--
-- The total is floored at zero. A moderator taking 100 points from a team on 40
-- means "you have nothing", not "you owe sixty", and a negative row on a screen
-- read by fourteen-year-olds is a support question, not information.

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
      greatest(
        coalesce(sum(mp.points), 0)
        + coalesce((select sum(a.points) from public.team_adjustments a
                     where a.team_id = t.id), 0), 0)      as points,
      count(mp.marker_id) filter (where not mp.skipped)   as stops_solved,
      max(mp.solved_at)                                   as last_solve_at,
      (select count(*)
         from public.marker_submissions s
         join public.markers m on m.id = s.marker_id
        where s.team_id = t.id
          and m.world_id = p_world
          and s.verdict = 'pending_review')               as pending
    from public.teams t
    left join public.marker_progress mp on mp.team_id = t.id
    where t.world_id = p_world
      and t.disqualified_at is null
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
    and (s.stops_solved > 0 or s.pending > 0)
  order by 1, s.name;
$$;

revoke all on function public.world_leaderboard(uuid) from public;
grant execute on function public.world_leaderboard(uuid) to anon, authenticated;

-- --------------------------------- the moderator page needs to see the state
--
-- 0024's function with three columns added: the adjustment total, whether they
-- are disqualified and why. Without them the page can act but cannot show what
-- it has already done, and a moderator would have no way to tell a deduction
-- that landed from one that did not.
--
-- Dropped first, not replaced: the returned columns change, and Postgres will
-- not let a replace do that.

drop function if exists public.world_teams(uuid);

create or replace function public.world_teams(p_world uuid)
returns table (
  id                  uuid,
  name                text,
  invite_code         text,
  started_at          timestamptz,
  members             jsonb,
  solved              bigint,
  points              bigint,
  adjusted            bigint,
  disqualified_at     timestamptz,
  disqualified_reason text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Owner or platform reviewer. An editor on the trail is deliberately not
  -- enough: editing stops is not a reason to be handed everybody's name.
  if public.world_role(p_world) is distinct from 'owner' and not public.is_admin() then
    raise exception 'not yours' using errcode = '42501';
  end if;

  return query
  select
    t.id,
    t.name,
    -- The organiser reads this out to whoever lost it. It is the team's code,
    -- not the trail's.
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
    -- Skipped is done and is not solved, the same way the board counts it.
    (select count(*) from public.marker_progress mp
      where mp.team_id = t.id and not mp.skipped),
    -- Earned, before anything a moderator did. Shown next to the adjustment
    -- rather than folded into it, so the page can say "180, and you took 20".
    (select coalesce(sum(mp.points), 0) from public.marker_progress mp
      where mp.team_id = t.id),
    (select coalesce(sum(a.points), 0) from public.team_adjustments a
      where a.team_id = t.id),
    t.disqualified_at,
    t.disqualified_reason
  from public.teams t
  where t.world_id = p_world
  order by t.created_at;
end;
$$;

revoke all on function public.world_teams(uuid) from public;
grant execute on function public.world_teams(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
