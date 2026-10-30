-- 0058 - captains, a start for live events, and the GPS lobby
--
-- Design: docs/superpowers/specs/2026-10-30-web-lite-design.md, part 3, from
-- YambolTrails (0019_member_leaves, 0025_gps_ready) and Alex's answers of
-- 30 October 2026.
--
-- Captains. Whoever makes a team is its captain (teams.captain_id). The
-- captain can hand the role to a teammate (transfer_captain), remove a player
-- (remove_member; the player may join again with the code), and give up for
-- the whole team (give_up_team: answers, hints and visits refused from then
-- on, the team kept on record). A captain with teammates cannot just leave:
-- hand over first, or give up. Anyone else leaves alone. If a captain's
-- account goes, the longest-standing member takes over.
--
-- Starts. A trail can wait for a start: start_mode 'manual' (the organiser's
-- Start, moderator_start_game) or 'auto' (starts_at, or Start pressed early).
-- Until then nothing of it is sent to walkers and nothing they do counts, but
-- teams can form and get ready. "Started" is read from the clock, so no job has
-- to run at the start time. trail_start() tells the clients.
--
-- The GPS lobby. Each phone reports whether location works (set_gps_ready),
-- never where it is. Teammates see it per member; the organiser sees phones
-- ready, team by team (world_readiness).
--
-- Safe to run twice.

begin;

-- ------------------------------------------------------------------ columns
alter table public.teams add column if not exists captain_id uuid references public.profiles(id) on delete set null;
alter table public.teams add column if not exists gave_up_at timestamptz;
update public.teams set captain_id = created_by where captain_id is null and created_by is not null;

alter table public.team_members add column if not exists gps_ok boolean;   -- null: not checked yet
alter table public.team_members add column if not exists gps_checked_at timestamptz;

alter table public.worlds add column if not exists start_mode text not null default 'none';
alter table public.worlds drop constraint if exists worlds_start_mode_known;
alter table public.worlds add constraint worlds_start_mode_known check (start_mode in ('none', 'manual', 'auto'));
alter table public.worlds add column if not exists starts_at timestamptz;
alter table public.worlds add column if not exists started_at timestamptz;

-- ------------------------------------------------------------------- starts
create or replace function public.trail_started(p_world uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case w.start_mode
             when 'none'   then true
             when 'manual' then w.started_at is not null
             else w.started_at is not null or (w.starts_at is not null and now() >= w.starts_at)
           end
    from public.worlds w where w.id = p_world), true);
$$;

-- What a client needs to show a lobby: whether, and when.
create or replace function public.trail_start(p_world uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'start_mode', w.start_mode,
    'starts_at',  w.starts_at,
    'started_at', w.started_at,
    'started',    public.trail_started(w.id),
    'ended',      w.ended_at is not null)
  from public.worlds w
  where w.id = p_world
    and (public.world_role(w.id) is not null or public.world_is_open(w.id));
$$;

-- The organiser's Start: for a manual start, or an automatic one started early.
create or replace function public.moderator_start_game(p_world uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz;
begin
  if not public.can_moderate(p_world) then
    raise exception 'only the organiser can start this game' using errcode = '42501';
  end if;
  update public.worlds set started_at = coalesce(started_at, now())
  where id = p_world
  returning started_at into v_at;
  return v_at;
end;
$$;

-- Nothing of a trail that has not started reaches a walker. Its builders still
-- see everything, or they could not check it.
do $$
declare d text; n text;
begin
  select pg_get_functiondef('public.markers_near(uuid, double precision, double precision, integer)'::regprocedure) into d;
  n := replace(d, '    -- One at a time, when the trail says so.',
    E'    -- Not before the start (0058).\n    and (public.world_role(p_world_id) in (''owner'', ''editor'')\n         or public.trail_started(p_world_id))\n    -- One at a time, when the trail says so.');
  if n = d then raise exception 'markers_near: anchor not found'; end if;
  execute n;
end $$;

-- Answers and hints: refused before the start and after giving up, beside the
-- refusal after the whistle.
do $$
declare d text; n text; f text;
begin
  foreach f in array array['public.check_answer(uuid, text, double precision, double precision, double precision, boolean)',
                           'public.reveal_hint(uuid)'] loop
    select pg_get_functiondef(f::regprocedure) into d;
    n := replace(d, '  -- Nothing counts after the whistle.',
      E'  -- Nothing counts before the start, or for a team that gave up (0058).\n'
      || E'  if not public.trail_started(v_world) then\n'
      || E'    raise exception ''this game has not started'' using errcode = ''P0001'';\n'
      || E'  end if;\n'
      || E'  if exists (select 1 from public.teams t join public.team_members tm on tm.team_id = t.id\n'
      || E'             where t.world_id = v_world and tm.user_id = auth.uid() and t.gave_up_at is not null) then\n'
      || E'    raise exception ''your team has given up'' using errcode = ''P0001'';\n'
      || E'  end if;\n\n'
      || E'  -- Nothing counts after the whistle.');
    if n = d then raise exception '%: anchor not found', f; end if;
    execute n;
  end loop;
end $$;

-- Visits too.
do $$
declare d text; n text;
begin
  select pg_get_functiondef('public.record_visit(uuid, text, double precision, double precision, double precision, boolean)'::regprocedure) into d;
  n := replace(d, '  if p_lat is null or p_lng is null then',
    E'  -- Not before the start, and not for a team that gave up (0058).\n'
    || E'  if not public.trail_started(v_world) then\n    return ''not_started'';\n  end if;\n'
    || E'  if exists (select 1 from public.teams t join public.team_members tm on tm.team_id = t.id\n'
    || E'             where t.world_id = v_world and tm.user_id = auth.uid() and t.gave_up_at is not null) then\n'
    || E'    return ''gave_up'';\n  end if;\n\n'
    || E'  if p_lat is null or p_lng is null then');
  if n = d then raise exception 'record_visit: anchor not found'; end if;
  execute n;
end $$;

-- ----------------------------------------------------------------- captains
create or replace function public.team_captain_default()
returns trigger
language plpgsql
as $$
begin
  new.captain_id := coalesce(new.captain_id, new.created_by);
  return new;
end;
$$;

drop trigger if exists team_captain_default on public.teams;
create trigger team_captain_default before insert on public.teams
  for each row execute function public.team_captain_default();

-- A team whose captain is gone (account deleted, or removed by a moderator)
-- gets the member who has been on it longest.
create or replace function public.team_captain_left()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.teams t
     set captain_id = (select tm.user_id from public.team_members tm
                        where tm.team_id = t.id order by tm.joined_at limit 1)
   where t.id = old.team_id
     and (t.captain_id is null or t.captain_id = old.user_id);
  return null;
end;
$$;

drop trigger if exists team_captain_left on public.team_members;
create trigger team_captain_left after delete on public.team_members
  for each row execute function public.team_captain_left();

create or replace function public.is_captain(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.teams t where t.id = p_team and t.captain_id = auth.uid());
$$;

create or replace function public.transfer_captain(p_team uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_captain(p_team) then
    raise exception 'only the captain can hand over' using errcode = '42501';
  end if;
  if not exists (select 1 from public.team_members where team_id = p_team and user_id = p_user) then
    raise exception 'not on this team' using errcode = 'P0001';
  end if;
  update public.teams set captain_id = p_user where id = p_team;
end;
$$;

create or replace function public.remove_member(p_team uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_captain(p_team) then
    raise exception 'only the captain can remove a player' using errcode = '42501';
  end if;
  if p_user = auth.uid() then
    raise exception 'the captain leaves, not removes' using errcode = 'P0001';
  end if;
  -- They may join again with the code (Alex, 30 October 2026).
  delete from public.team_members where team_id = p_team and user_id = p_user;
end;
$$;

create or replace function public.give_up_team(p_team uuid)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz;
begin
  if not public.is_captain(p_team) then
    raise exception 'only the captain can give up for the team' using errcode = '42501';
  end if;
  update public.teams set gave_up_at = coalesce(gave_up_at, now())
  where id = p_team returning gave_up_at into v_at;
  return v_at;
end;
$$;

-- Leaving: anyone but a captain with teammates, who hands over or gives up.
create or replace function public.leave_team(p_team uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_captain(p_team)
     and exists (select 1 from public.team_members
                 where team_id = p_team and user_id <> auth.uid()) then
    raise exception 'the captain hands over or gives up first' using errcode = 'P0001';
  end if;

  delete from public.team_members
  where team_id = p_team and user_id = auth.uid();

  -- A team with nobody in it is not a team. Its progress goes with it, which is
  -- correct: nobody is left who could claim it.
  delete from public.teams t
  where t.id = p_team
    and not exists (select 1 from public.team_members where team_id = t.id);
end;
$$;

-- ---------------------------------------------------------------- GPS lobby
create or replace function public.set_gps_ready(p_team uuid, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.team_members set gps_ok = p_ok, gps_checked_at = now()
  where team_id = p_team and user_id = auth.uid();
  if not found then
    raise exception 'not on this team' using errcode = '42501';
  end if;
end;
$$;

-- The organiser's panel before the start: phones ready, team by team.
create or replace function public.world_readiness(p_world uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_moderate(p_world) then
    raise exception 'not yours' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'phones', (select count(*) from public.team_members tm join public.teams t on t.id = tm.team_id
                where t.world_id = p_world and t.gave_up_at is null),
    'ready',  (select count(*) from public.team_members tm join public.teams t on t.id = tm.team_id
                where t.world_id = p_world and t.gave_up_at is null and tm.gps_ok),
    'teams',  coalesce((
      select jsonb_agg(jsonb_build_object(
               'name', t.name,
               'gave_up', t.gave_up_at is not null,
               'members', (select jsonb_agg(jsonb_build_object(
                             'name', coalesce(nullif(trim(p.display_name), ''), 'Player'),
                             'captain', tm.user_id = t.captain_id,
                             'gps', tm.gps_ok) order by tm.joined_at)
                           from public.team_members tm left join public.profiles p on p.id = tm.user_id
                           where tm.team_id = t.id))
             order by t.created_at)
      from public.teams t where t.world_id = p_world), '[]'::jsonb));
end;
$$;

-- The team card: who is captain, each member's id (for the captain's
-- controls) and GPS state, and whether the team gave up.
do $$
declare d text; n text;
begin
  select pg_get_functiondef('public.my_team_detail(uuid)'::regprocedure) into d;
  n := replace(d, '''is_me'', tm.user_id = auth.uid()',
    '''is_me'', tm.user_id = auth.uid(), ''id'', tm.user_id, ''is_captain'', tm.user_id = v_row.captain_id, ''gps'', tm.gps_ok');
  if n = d then raise exception 'my_team_detail: members anchor not found'; end if;
  d := n;
  n := replace(d, '''disqualified_reason'', v_row.disqualified_reason',
    '''disqualified_reason'', v_row.disqualified_reason, ''i_am_captain'', v_row.captain_id = auth.uid(), ''gave_up'', v_row.gave_up_at is not null');
  if n = d then raise exception 'my_team_detail: tail anchor not found'; end if;
  execute n;
end $$;

-- ---------------------------------------------------------------- the doors
revoke all on function public.trail_started(uuid) from public, anon, authenticated;
revoke all on function public.is_captain(uuid) from public, anon, authenticated;
revoke all on function public.team_captain_left() from public, anon, authenticated;
revoke all on function public.trail_start(uuid) from public;
grant execute on function public.trail_start(uuid) to anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array['public.moderator_start_game(uuid)', 'public.transfer_captain(uuid, uuid)',
                           'public.remove_member(uuid, uuid)', 'public.give_up_team(uuid)',
                           'public.set_gps_ready(uuid, boolean)', 'public.world_readiness(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

commit;

notify pgrst, 'reload schema';
