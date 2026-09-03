-- =============================================================================
-- Teams — who the progress belongs to
-- =============================================================================
--
-- Progress cannot belong to a device. A device is lost, reinstalled and shared,
-- and a leaderboard built on one is a leaderboard of handsets. It belongs to a
-- team, and a solo player is a team of one - created for them without being
-- asked - so that every progress and leaderboard query has exactly one shape
-- instead of two that drift apart.
--
-- A team belongs to one trail. The same four people walking a second trail are
-- a second team, because their start time, their score and their standing are
-- all per-trail and sharing a row across trails would mean none of those three
-- has a single value.
--
-- Competitive trails reject anonymous members. That is checked here rather than
-- in a client, because a rule enforced in a client is advice.
--
-- Safe to run twice.
-- =============================================================================

begin;

-- ------------------------------------------------------- 0. a mode that was missing
--
-- The app has always offered four modes and the table has only ever allowed
-- three. Nothing failed loudly: freefall simply could not be saved, so every
-- trail that should have had no order silently was not one. Added here because
-- the creator portal is the first thing that will actually try to write it.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'worlds_mode_check'
      and conrelid = 'public.worlds'::regclass
  ) then
    alter table public.worlds drop constraint worlds_mode_check;
  end if;
end $$;

alter table public.worlds
  add constraint worlds_mode_check
  check (mode in ('guide','educational','ctf','freefall'));

-- ------------------------------------------------------------------ 1. teams

create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  world_id    uuid not null references public.worlds(id)   on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 40),
  -- Its own code, unrelated to the trail's. The trail code says which game you
  -- are playing; this says who you are playing it with.
  invite_code text unique not null,
  created_by  uuid references public.profiles(id) on delete set null,
  -- Set by the first solve rather than at creation, so a team that registers a
  -- week early is not ranked as having taken a week.
  started_at  timestamptz,
  created_at  timestamptz not null default now(),

  -- Two teams in one trail may not share a name, or a leaderboard cannot be
  -- read out loud.
  unique (world_id, name)
);

create index if not exists teams_world_idx on public.teams (world_id);

create table if not exists public.team_members (
  team_id   uuid not null references public.teams(id)    on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists team_members_user_idx on public.team_members (user_id);

-- ------------------------------------------------- 2. the two rules about size
--
-- Neither can be a CHECK constraint: both count other rows, and a CHECK sees
-- only the row in front of it.

create or replace function public.team_membership_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world   uuid;
  v_size    integer;
  v_clashes integer;
begin
  select t.world_id into v_world
  from public.teams t
  where t.id = new.team_id;

  -- Four is the cap both reference events use, and it is the number that still
  -- fits round one phone screen at a marker.
  select count(*) into v_size
  from public.team_members
  where team_id = new.team_id;

  if v_size >= 4 then
    raise exception 'this team is full' using errcode = 'check_violation';
  end if;

  -- One team per person per trail. Without this, somebody can join two teams on
  -- the same trail and solve a stop for both of them.
  select count(*) into v_clashes
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  where tm.user_id = new.user_id
    and t.world_id = v_world
    and tm.team_id <> new.team_id;

  if v_clashes > 0 then
    raise exception 'already on a team for this trail'
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists team_membership_guard_trg on public.team_members;

create trigger team_membership_guard_trg
  before insert on public.team_members
  for each row execute function public.team_membership_guard();

-- ------------------------------------------------------- 3. permission lookup
--
-- SECURITY DEFINER for the same reason world_role is: a policy on teams that
-- reads team_members, whose policy reads teams, asks a question that asks
-- itself until Postgres gives up.

create or replace function public.my_team(p_world uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.id
  from public.teams t
  join public.team_members tm on tm.team_id = t.id
  where t.world_id = p_world
    and tm.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.on_team(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team and user_id = auth.uid()
  );
$$;

revoke all on function public.my_team(uuid)  from public;
revoke all on function public.on_team(uuid)  from public;
grant execute on function public.my_team(uuid)  to anon, authenticated;
grant execute on function public.on_team(uuid)  to anon, authenticated;

-- --------------------------------------------------------- 4. making a team
--
-- A short code, from an alphabet with no O/0 or I/1/l, because it gets read
-- aloud across a street.

create or replace function public.new_team_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code     text;
  v_tries    integer := 0;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;

    exit when not exists (select 1 from public.teams where invite_code = v_code);

    v_tries := v_tries + 1;
    if v_tries > 50 then
      raise exception 'could not find an unused team code';
    end if;
  end loop;

  return v_code;
end;
$$;

-- Is this caller allowed to play this trail at all, and as themselves?
create or replace function public.assert_may_play(p_world uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mode text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  if public.world_role(p_world) is null then
    raise exception 'not a member of this trail' using errcode = '42501';
  end if;

  select w.mode into v_mode from public.worlds w where w.id = p_world;

  -- A competitive trail keeps a public ranking with a name against it. An
  -- anonymous user is a row that vanishes with the app, which is both unfair to
  -- everybody ranked below them and impossible to contest afterwards.
  if v_mode = 'ctf'
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'a competitive trail needs a real account'
      using errcode = '28000';
  end if;
end;
$$;

create or replace function public.create_team(p_world uuid, p_name text)
returns public.teams
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team public.teams;
begin
  perform public.assert_may_play(p_world);

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
$$;

create or replace function public.join_team(p_code text)
returns public.teams
language plpgsql
security definer
set search_path = public
as $$
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

  -- The size cap and the one-team rule live in the trigger, so this insert
  -- raises rather than needing to repeat them.
  insert into public.team_members (team_id, user_id)
  values (v_team.id, auth.uid())
  on conflict (team_id, user_id) do nothing;

  return v_team;
end;
$$;

-- The team of one, made without being asked.
--
-- Called by check_answer before it records anything, so a solo player never
-- meets the word "team" unless they go looking for it.
create or replace function public.ensure_team(p_world uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team uuid;
  v_name text;
begin
  v_team := public.my_team(p_world);
  if v_team is not null then
    return v_team;
  end if;

  perform public.assert_may_play(p_world);

  select coalesce(nullif(trim(p.display_name), ''), 'Player')
    into v_name
  from public.profiles p
  where p.id = auth.uid();

  -- The unique (world_id, name) constraint means two silent players called
  -- "Player" would collide, so the id's first characters are appended.
  v_name := left(v_name, 28) || ' · ' || left(replace(auth.uid()::text, '-', ''), 4);

  insert into public.teams (world_id, name, invite_code, created_by)
  values (p_world, v_name, public.new_team_code(), auth.uid())
  returning id into v_team;

  insert into public.team_members (team_id, user_id)
  values (v_team, auth.uid());

  return v_team;
end;
$$;

create or replace function public.leave_team(p_team uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.team_members
  where team_id = p_team and user_id = auth.uid();

  -- A team with nobody in it is not a team. Its progress goes with it, which is
  -- correct: nobody is left who could claim it.
  delete from public.teams t
  where t.id = p_team
    and not exists (select 1 from public.team_members where team_id = t.id);
end;
$$;

revoke all on function public.new_team_code()               from public;
revoke all on function public.assert_may_play(uuid)         from public;
revoke all on function public.create_team(uuid, text)       from public;
revoke all on function public.join_team(text)               from public;
revoke all on function public.ensure_team(uuid)             from public;
revoke all on function public.leave_team(uuid)              from public;

grant execute on function public.create_team(uuid, text) to authenticated;
grant execute on function public.join_team(text)         to authenticated;
grant execute on function public.ensure_team(uuid)       to authenticated;
grant execute on function public.leave_team(uuid)        to authenticated;

-- ------------------------------------------------------------------- 5. RLS
--
-- A team's name is public on a leaderboard; its roster is not. Those are two
-- different questions and they get two different answers: the board is served
-- by a SECURITY DEFINER function that returns names, and these policies never
-- hand a table row to anyone outside the team.

alter table public.teams        enable row level security;
alter table public.team_members enable row level security;

drop policy if exists teams_select_own on public.teams;
create policy teams_select_own on public.teams
  for select using (
    public.on_team(id)
    or public.world_role(world_id) in ('owner','editor')
  );

-- No insert, update or delete policies. create_team, join_team and leave_team
-- are the only doors, and each one checks something a policy cannot express.

drop policy if exists team_members_select_own on public.team_members;
create policy team_members_select_own on public.team_members
  for select using (
    user_id = auth.uid()
    or public.on_team(team_id)
  );

commit;

-- =============================================================================
-- Verify from outside the dashboard, as two different signed-in users:
--
--   * create_team on a ctf trail as an anonymous user must fail with 28000.
--   * join_team with a fifth member must fail with check_violation.
--   * selecting team_members for a team you are not on must return zero rows.
--
-- The third one is the one worth writing carefully. It passed once against a
-- table that happened to hold only the tester's own rows, which proved nothing.
-- =============================================================================
