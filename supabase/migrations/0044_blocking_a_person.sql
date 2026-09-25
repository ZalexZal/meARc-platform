-- =============================================================================
-- 0044  Blocking a person
--
-- Reporting sends a problem to a reviewer. Blocking is what somebody does for
-- themselves, straight away, without waiting for anyone: Google Play asks both
-- of an app where people publish things for each other.
--
-- A block is between two people, not between a person and one trail, because
-- the thing that bothered them was a person. What it does:
--
--   * Their public trails leave your library, and yours leave theirs.
--   * You leave their trails, they leave yours, and neither can join the
--     other's again. The join refusal is worded exactly like a wrong code, so
--     a block is not something the blocked person can discover by trying.
--   * A team they named reads as a hidden team on every board you look at.
--
-- The client never learns anyone's user id to do this. It names the thing it
-- was looking at - a trail, a stop, a team, an answer - and the server works
-- out whose it is, which also means nobody can block a person they have never
-- seen anything from.
--
-- Also: a team's name can now be reported, the same as a stop or a trail.
-- =============================================================================

begin;

create table public.user_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  -- What the blocker was looking at, so the list of blocks can say who each
  -- one is without handing out names: 'trail', 'team' or 'player', and the
  -- trail or team name as it read at the time.
  via        text not null check (via in ('trail', 'team', 'player')),
  label      text not null default '',
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create index user_blocks_blocked on public.user_blocks (blocked_id);

alter table public.user_blocks enable row level security;

-- Your own list, to read and to take things off. Adding goes through
-- block_user, which is the only thing that knows how to find the person.
create policy user_blocks_select_own on public.user_blocks
  for select using (blocker_id = auth.uid());
create policy user_blocks_delete_own on public.user_blocks
  for delete using (blocker_id = auth.uid());

grant select, delete on public.user_blocks to authenticated;

-- Either direction. Used inside other definer functions only; nobody gets to
-- ask it about two arbitrary people.
create or replace function public.blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select a is not null and b is not null and exists (
    select 1 from public.user_blocks x
    where (x.blocker_id = a and x.blocked_id = b)
       or (x.blocker_id = b and x.blocked_id = a));
$$;

revoke all on function public.blocked_between(uuid, uuid) from public, anon, authenticated;

create or replace function public.block_user(p_kind text, p_target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_them  uuid;
  v_world uuid;
  v_via   text;
  v_label text;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  if p_kind = 'trail' then
    select w.owner_id, w.id, w.name into v_them, v_world, v_label
    from public.worlds w where w.id = p_target;
    v_via := 'trail';

  elsif p_kind = 'marker' then
    select w.owner_id, w.id, w.name into v_them, v_world, v_label
    from public.markers m join public.worlds w on w.id = m.world_id
    where m.id = p_target;
    v_via := 'trail';

  elsif p_kind = 'team' then
    select t.created_by, t.world_id, t.name into v_them, v_world, v_label
    from public.teams t where t.id = p_target;
    v_via := 'team';

  elsif p_kind = 'submission' then
    -- Only the people who review a trail's answers see who sent them.
    select s.user_id, m.world_id, t.name into v_them, v_world, v_label
    from public.marker_submissions s
    join public.markers m on m.id = s.marker_id
    join public.teams t on t.id = s.team_id
    where s.id = p_target;
    if v_world is not null and not public.may_edit(v_world) then
      v_world := null;
    end if;
    v_via := 'player';

  else
    raise exception 'unknown kind of thing to block' using errcode = 'P0001';
  end if;

  -- Something the caller could actually see, or this is a way to find out
  -- which ids exist and who owns them.
  if v_world is null
     or not (public.world_role(v_world) is not null or public.world_is_open(v_world)) then
    raise exception 'nothing to block there' using errcode = 'P0001';
  end if;

  if v_them is null then
    -- A trail whose owner deleted their account and left it behind, or a team
    -- whose founder has gone. There is nobody left to block.
    raise exception 'nobody to block there' using errcode = 'P0001';
  end if;

  if v_them = v_me then
    raise exception 'that is you' using errcode = 'P0001';
  end if;

  insert into public.user_blocks (blocker_id, blocked_id, via, label)
  values (v_me, v_them, v_via, coalesce(v_label, ''))
  on conflict (blocker_id, blocked_id) do nothing;

  -- Out of each other's trails. The owner stays owner of their own, obviously;
  -- everyone else's membership - player or editor - goes.
  delete from public.world_members wm
  using public.worlds w
  where wm.world_id = w.id
    and wm.role <> 'owner'
    and ((wm.user_id = v_me and w.owner_id = v_them)
      or (wm.user_id = v_them and w.owner_id = v_me));

  return jsonb_build_object('blocked', true, 'via', v_via, 'label', coalesce(v_label, ''));
end;
$$;

revoke all on function public.block_user(text, uuid) from public, anon;
grant execute on function public.block_user(text, uuid) to authenticated;

-- ------------------------------------------------------------------ library

create or replace function public.trails_near(
  p_lat      double precision,
  p_lng      double precision,
  p_radius_m double precision default 50000
)
returns table (
  id          uuid,
  name        text,
  mode        text,
  stop_count  bigint,
  distance_m  double precision,
  lat         double precision,
  lng         double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
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
$$;

create or replace function public.public_trails()
returns table (
  id uuid, name text, mode text, stop_count bigint, team_count bigint,
  created_at timestamptz, start_lat double precision, start_lng double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
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
$$;

-- ------------------------------------------------------------------ joining

create or replace function public.join_world(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world uuid;
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select w.id, w.owner_id into v_world, v_owner
  from public.worlds w
  where upper(trim(w.join_code)) = upper(trim(p_code));

  -- A block reads as a wrong code, on purpose.
  if v_world is null or public.blocked_between(auth.uid(), v_owner) then
    raise exception 'no world with that code' using errcode = 'P0001';
  end if;

  -- Rotating a join code changes the door, not who is already inside.
  insert into public.world_members (world_id, user_id, role)
  values (v_world, auth.uid(), 'viewer')
  on conflict (world_id, user_id) do nothing;

  return v_world;
end;
$$;

create or replace function public.join_listed(p_world uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  if not exists (select 1 from public.worlds w
                 where w.id = p_world and w.visibility = 'public'
                   and w.status = 'published' and w.ended_at is null
                   and not public.blocked_between(auth.uid(), w.owner_id)) then
    raise exception 'not a listed trail' using errcode = 'P0001';
  end if;

  insert into public.world_members (world_id, user_id, role)
  values (p_world, auth.uid(), 'viewer')
  on conflict (world_id, user_id) do nothing;

  return p_world;
end;
$$;

-- ------------------------------------------------------------------ the board
--
-- Same ranking as before. The only change: a team founded by somebody you
-- blocked comes back with no name, and the app and site write "Hidden team".
-- Its row stays - the ranks below it are still true.

create or replace function public.world_leaderboard(p_world uuid)
returns table (
  rank bigint, team_id uuid, team_name text, points bigint, stops_solved bigint,
  started_at timestamptz, last_solve_at timestamptz, elapsed_seconds integer,
  pending bigint, is_mine boolean
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
      t.created_by,
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
    group by t.id, t.name, t.created_by, t.started_at
  )
  select
    rank() over (order by s.points desc,
                          coalesce(extract(epoch from (s.last_solve_at - s.started_at)),
                                   'infinity'::double precision) asc),
    s.id,
    case when exists (select 1 from public.user_blocks b
                      where b.blocker_id = auth.uid() and b.blocked_id = s.created_by)
         then null else s.name end,
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

-- ------------------------------------------------------------------ reporting a team

alter table public.reports
  add column team_id uuid references public.teams(id) on delete set null;

alter table public.reports drop constraint reports_one_target;
alter table public.reports add constraint reports_one_target
  check (num_nonnulls(marker_id, world_id, team_id) <= 1);

alter table public.reports drop constraint reports_target_kind;
alter table public.reports add constraint reports_target_kind
  check (target_kind in ('marker', 'trail', 'team'));

create or replace function public.report_team(p_team uuid, p_reason text, p_detail text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world uuid;
  v_id    uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select t.world_id into v_world from public.teams t where t.id = p_team;

  if v_world is null
     or not (public.world_role(v_world) is not null or public.world_is_open(v_world)) then
    raise exception 'no such team' using errcode = 'P0001';
  end if;

  select id into v_id
  from public.reports
  where team_id = p_team and reporter_id = auth.uid() and state = 'open';

  if v_id is not null then
    return v_id;
  end if;

  insert into public.reports
    (team_id, reporter_id, reason, detail, target_kind, target_title, target_trail)
  select p_team, auth.uid(), p_reason, nullif(trim(coalesce(p_detail, '')), ''),
         'team', t.name, w.name
  from public.teams t join public.worlds w on w.id = t.world_id
  where t.id = p_team
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.report_team(uuid, text, text) from public, anon;
grant execute on function public.report_team(uuid, text, text) to authenticated;

-- The inbox learns the new kind. team_id is appended rather than slotted in,
-- so every existing reader of the columns by position keeps working.
drop function public.reports_queue(text);

create function public.reports_queue(p_state text default 'open')
returns table (
  id uuid, created_at timestamptz, reason text, detail text, state text,
  target text, marker_id uuid, world_id uuid, title text, trail_name text,
  lat double precision, lng double precision, placed_by text, reporter text,
  gone boolean, team_id uuid
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    r.id,
    r.created_at,
    r.reason,
    r.detail,
    r.state,
    r.target_kind,
    r.marker_id,
    coalesce(r.world_id, m.world_id, t.world_id),
    coalesce(r.target_title, m.content -> 'bg' ->> 'title', m.content -> 'en' ->> 'title'),
    coalesce(r.target_trail, w.name),
    coalesce(r.target_lat, case when m.id is not null then st_y(m.location::geometry) end),
    coalesce(r.target_lng, case when m.id is not null then st_x(m.location::geometry) end),
    (select u.email::text from auth.users u
      where u.id = coalesce(m.created_by, t.created_by)),
    (select u.email::text from auth.users u where u.id = r.reporter_id),
    (r.marker_id is null and r.world_id is null and r.team_id is null),
    r.team_id
  from public.reports r
  left join public.markers m on m.id = r.marker_id
  left join public.teams   t on t.id = r.team_id
  left join public.worlds  w on w.id = coalesce(r.world_id, m.world_id, t.world_id)
  where public.is_admin()
    and r.state = coalesce(nullif(trim(coalesce(p_state, '')), ''), 'open')
  order by r.created_at;
$$;

revoke all on function public.reports_queue(text) from public, anon;
grant execute on function public.reports_queue(text) to authenticated;

commit;
