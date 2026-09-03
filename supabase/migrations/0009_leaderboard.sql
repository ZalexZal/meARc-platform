-- =============================================================================
-- The leaderboard — the one aggregate that is allowed out
-- =============================================================================
--
-- A board is a deliberate leak. It publishes something about every team to
-- every other team, so what it publishes has to be chosen rather than fall out
-- of a join: a name, a total, a count and a duration. Never which markers, never
-- which answers, never who typed what.
--
-- SECURITY DEFINER, so it can read across teams without a policy that would let
-- clients read across teams for any other purpose.
--
-- Ranking is points first, then elapsed time. Points are what the creator said
-- the trail was worth; time only separates teams the creator's own weighting
-- could not.
--
-- Safe to run twice.
-- =============================================================================

begin;

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
    -- A board is readable by anyone in the trail, and by anyone at all if the
    -- trail is open. A private trail's standings stay inside it.
    select public.world_role(p_world) is not null
        or public.world_is_open(p_world) as ok
  ),
  scored as (
    select
      t.id,
      t.name,
      t.started_at,
      coalesce(sum(mp.points), 0)                        as points,
      count(mp.marker_id)                                as stops_solved,
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
    -- there is nothing to rank and a wall of zeroes reads as a broken page.
    and (s.stops_solved > 0 or s.pending > 0)
  order by 1, s.name;
$$;

revoke all on function public.world_leaderboard(uuid) from public;
grant execute on function public.world_leaderboard(uuid) to anon, authenticated;

-- ------------------------------------------------------------ trail_summary
--
-- What a game's public page shows before anybody has joined: how many stops,
-- how many teams are playing, and whether it is still open. Deliberately says
-- nothing about where the stops are.

create or replace function public.trail_summary(p_world uuid)
returns table (
  id           uuid,
  name         text,
  mode         text,
  status       text,
  visibility   text,
  stop_count   bigint,
  team_count   bigint,
  total_points bigint,
  needs_account boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.id, w.name, w.mode, w.status, w.visibility,
    (select count(*) from public.markers m
      where m.world_id = w.id and m.status = 'published'),
    (select count(*) from public.teams t where t.world_id = w.id),
    (select coalesce(sum(a.points), 0)
       from public.marker_answers a
       join public.markers m2 on m2.id = a.marker_id
      where m2.world_id = w.id and m2.status = 'published'),
    w.mode = 'ctf'
  from public.worlds w
  where w.id = p_world
    and (public.world_role(w.id) is not null or public.world_is_open(w.id));
$$;

revoke all on function public.trail_summary(uuid) from public;
grant execute on function public.trail_summary(uuid) to anon, authenticated;

-- ------------------------------------------------------------- public_trails
--
-- The games list. Only what somebody deliberately published to everybody -
-- unlisted trails are reachable with a code and are not advertised here.

create or replace function public.public_trails()
returns table (
  id           uuid,
  name         text,
  mode         text,
  stop_count   bigint,
  team_count   bigint,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.id, w.name, w.mode,
    (select count(*) from public.markers m
      where m.world_id = w.id and m.status = 'published'),
    (select count(*) from public.teams t where t.world_id = w.id),
    w.created_at
  from public.worlds w
  where w.visibility = 'public'
    and w.status = 'published'
  order by w.created_at desc
  limit 100;
$$;

revoke all on function public.public_trails() from public;
grant execute on function public.public_trails() to anon, authenticated;

commit;

-- =============================================================================
-- Verify from outside the dashboard:
--
--   * world_leaderboard on a private trail you are not in: zero rows.
--   * the response names no marker and no submission anywhere in its body.
--   * a team with pending review appears, with pending > 0, so nobody is
--     silently missing from a board they are actually on.
--   * public_trails as anon returns only public+published, and never a private
--     trail's name.
-- =============================================================================
