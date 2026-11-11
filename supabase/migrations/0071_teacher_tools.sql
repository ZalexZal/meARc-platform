-- 0071 - teacher tools (11 Nov 2026)
--
-- A teacher who owns a trail can see who is on it, send a player away so they
-- can come back, and send a player away for good. This migration is the
-- database side of the "Uchitelski pult" in the app.
--
--   world_bans           who may not join which trail. RLS on, no policies, no
--                        grants: only the functions below touch it.
--   moderator_kick       owner/admin removes a player (team and trail). Past
--                        answers stay: marker_progress and submissions hang on
--                        the team, not the person, as with remove_member.
--   moderator_ban        kick, then ban.
--   moderator_unban      lift a ban.
--   world_players        every player of a trail with their team (owner/admin).
--   world_teams          members now carry user_id and gps_ok. Nothing else moves.
--   ban_guard            BEFORE INSERT on world_members and team_members, so
--                        every present and future way in refuses a banned user
--                        with 'banned' (P0001). Fires first (name sorts before
--                        consent_guard_trg and team_membership_guard_trg).
--                        Covers join_world, join_listed, join_as_editor,
--                        join_team, create_team, ensure_team and direct inserts.
--   assert_may_play      the same check, first thing, so join_team, create_team,
--                        ensure_team and every play call say 'banned' instead of
--                        'not a member' to someone who was banned.
--
-- Error strings: 'banned' P0001 | 'not yours to moderate' 42501 |
-- 'the owner cannot be removed' P0001 | 'no such player' P0001 |
-- 'not yours' 42501 (world_players).
--
-- Safe to run twice. Nothing is deleted from existing tables except what a kick
-- is for (the player's own team_members and world_members rows).
--
-- Undo (run in one transaction):
--   drop trigger if exists ban_guard_trg on public.world_members;
--   drop trigger if exists ban_guard_trg on public.team_members;
--   drop function if exists public.ban_guard();
--   drop function if exists public.moderator_ban(uuid, uuid);
--   drop function if exists public.moderator_unban(uuid, uuid);
--   drop function if exists public.moderator_kick(uuid, uuid);
--   drop function if exists public.world_players(uuid);
--   drop table if exists public.world_bans;
--   then restore the two replaced functions to the bodies below
--   (live definitions read on 11 Nov 2026 before this migration). The ACLs
--   survive create or replace: authenticated + service_role, nobody else.
--
--   ---- assert_may_play (was) ----
--   CREATE OR REPLACE FUNCTION public.assert_may_play(p_world uuid)
--    RETURNS void
--    LANGUAGE plpgsql
--    STABLE SECURITY DEFINER
--    SET search_path TO 'public'
--   AS $function$
--   declare
--     v_mode  text;
--     v_ended timestamptz;
--   begin
--     if auth.uid() is null then
--       raise exception 'not signed in' using errcode = '28000';
--     end if;
--   
--     if public.world_role(p_world) is null then
--       raise exception 'not a member of this trail' using errcode = '42501';
--     end if;
--   
--     select w.mode, w.ended_at into v_mode, v_ended
--     from public.worlds w where w.id = p_world;
--   
--     if public.mode_is_scored(v_mode)
--        and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
--       raise exception 'a competitive trail needs a real account'
--         using errcode = '28000';
--     end if;
--   
--     if v_ended is not null then
--       raise exception 'this game has ended' using errcode = 'P0001';
--     end if;
--   end;
--   $function$
--
--   ---- world_teams (was) ----
--   CREATE OR REPLACE FUNCTION public.world_teams(p_world uuid)
--    RETURNS TABLE(id uuid, name text, invite_code text, started_at timestamp with time zone, members jsonb, solved bigint, points bigint, adjusted bigint, disqualified_at timestamp with time zone, disqualified_reason text, warnings jsonb)
--    LANGUAGE plpgsql
--    STABLE SECURITY DEFINER
--    SET search_path TO 'public'
--   AS $function$
--   begin
--     if public.world_role(p_world) is distinct from 'owner' and not public.is_admin() then
--       raise exception 'not yours' using errcode = '42501';
--     end if;
--   
--     return query
--     select
--       t.id,
--       t.name,
--       t.invite_code,
--       t.started_at,
--       coalesce((
--         select jsonb_agg(
--                  jsonb_build_object(
--                    'name', coalesce(nullif(trim(p.display_name), ''), 'Player'),
--                    'joined_at', tm.joined_at
--                  ) order by tm.joined_at)
--           from public.team_members tm
--           left join public.profiles p on p.id = tm.user_id
--          where tm.team_id = t.id), '[]'::jsonb),
--       (select count(*) from public.marker_progress mp
--         where mp.team_id = t.id and not mp.skipped),
--       (select coalesce(sum(mp.points), 0) from public.marker_progress mp
--         where mp.team_id = t.id),
--       (select coalesce(sum(a.points), 0) from public.team_adjustments a
--         where a.team_id = t.id),
--       t.disqualified_at,
--       t.disqualified_reason,
--       (select coalesce(jsonb_object_agg(f.problem, f.n), '{}'::jsonb)
--          from (select problem, count(*) as n from public.position_flags
--                 where team_id = t.id group by problem) f)
--     from public.teams t
--     where t.world_id = p_world
--     order by t.created_at;
--   end;
--   $function$

begin;

-- --------------------------------------------------------------- world_bans
--
-- Written only by moderator_ban, read only by ban_guard and assert_may_play
-- (both security definer). No policy and no grant: a player cannot see whether
-- they are on it except by trying to join.

create table if not exists public.world_bans (
  world_id  uuid not null references public.worlds(id) on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  banned_by uuid references public.profiles(id) on delete set null,
  banned_at timestamptz not null default now(),
  primary key (world_id, user_id)
);

create index if not exists world_bans_user_idx on public.world_bans (user_id);

alter table public.world_bans enable row level security;
revoke all on public.world_bans from public, anon, authenticated;

-- ---------------------------------------------------------------- ban_guard
--
-- One trigger on both membership tables instead of a check copied into six
-- functions: the next function that inserts a member inherits it. The owner's
-- own row (world_owner_membership) is never refused because moderator_ban
-- never writes the owner into world_bans.

create or replace function public.ban_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world uuid;
begin
  if tg_table_name = 'world_members' then
    v_world := new.world_id;
  else
    select t.world_id into v_world from public.teams t where t.id = new.team_id;
  end if;

  if exists (select 1 from public.world_bans b
              where b.world_id = v_world and b.user_id = new.user_id) then
    raise exception 'banned' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.ban_guard() from public, anon, authenticated;

drop trigger if exists ban_guard_trg on public.world_members;
create trigger ban_guard_trg before insert on public.world_members
  for each row execute function public.ban_guard();

drop trigger if exists ban_guard_trg on public.team_members;
create trigger ban_guard_trg before insert on public.team_members
  for each row execute function public.ban_guard();

-- ---------------------------------------------------------- assert_may_play
--
-- The live body, plus one check right after the sign-in test. Before it, a
-- banned user (who has no world_members row) was told "not a member".

create or replace function public.assert_may_play(p_world uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mode  text;
  v_ended timestamptz;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  if exists (select 1 from public.world_bans b
              where b.world_id = p_world and b.user_id = auth.uid()) then
    raise exception 'banned' using errcode = 'P0001';
  end if;

  if public.world_role(p_world) is null then
    raise exception 'not a member of this trail' using errcode = '42501';
  end if;

  select w.mode, w.ended_at into v_mode, v_ended
  from public.worlds w where w.id = p_world;

  if public.mode_is_scored(v_mode)
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'a competitive trail needs a real account'
      using errcode = '28000';
  end if;

  if v_ended is not null then
    raise exception 'this game has ended' using errcode = 'P0001';
  end if;
end;
$$;

-- ----------------------------------------------------------- moderator_kick
--
-- Away from the team and from the trail, so the next join_world and join_team
-- start clean. The team keeps its points and answers (they hang on team_id).
-- keep_achievements and team_captain_left fire as they do for remove_member.
-- The owner is refused, by membership role and by worlds.owner_id.

create or replace function public.moderator_kick(p_world uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_moderate(p_world) then
    raise exception 'not yours to moderate' using errcode = '42501';
  end if;

  if p_user is null then
    raise exception 'no such player' using errcode = 'P0001';
  end if;

  if exists (select 1 from public.world_members m
              where m.world_id = p_world and m.user_id = p_user and m.role = 'owner')
     or exists (select 1 from public.worlds w
                 where w.id = p_world and w.owner_id = p_user) then
    raise exception 'the owner cannot be removed' using errcode = 'P0001';
  end if;

  delete from public.team_members tm
   using public.teams t
   where tm.team_id = t.id
     and t.world_id = p_world
     and tm.user_id = p_user;

  delete from public.world_members m
   where m.world_id = p_world and m.user_id = p_user;
end;
$$;

-- ------------------------------------------------------------ moderator_ban

create or replace function public.moderator_ban(p_world uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The kick does the permission and owner checks, so a refusal there stops
  -- the ban too (one transaction).
  perform public.moderator_kick(p_world, p_user);

  insert into public.world_bans (world_id, user_id, banned_by)
  values (p_world, p_user, auth.uid())
  on conflict (world_id, user_id) do update
    set banned_by = excluded.banned_by, banned_at = now();
end;
$$;

-- ---------------------------------------------------------- moderator_unban

create or replace function public.moderator_unban(p_world uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_moderate(p_world) then
    raise exception 'not yours to moderate' using errcode = '42501';
  end if;

  delete from public.world_bans b
   where b.world_id = p_world and b.user_id = p_user;
end;
$$;

-- ------------------------------------------------------------- world_players
--
-- Everybody on the trail except its owner (the teacher is not a player), with
-- the team they are on or null. Same gate as world_teams. Editors are listed:
-- they are people on the trail and the owner may want to remove one.

create or replace function public.world_players(p_world uuid)
returns table(user_id uuid, name text, team_id uuid, gps_ok boolean, joined_at timestamptz)
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
    m.user_id,
    coalesce(nullif(trim(p.display_name), ''), 'Player'),
    x.team_id,
    coalesce(x.gps_ok, false),
    m.joined_at
  from public.world_members m
  left join public.profiles p on p.id = m.user_id
  left join lateral (
    select tm.team_id, tm.gps_ok
      from public.team_members tm
      join public.teams t on t.id = tm.team_id
     where t.world_id = p_world and tm.user_id = m.user_id
     limit 1) x on true
  where m.world_id = p_world
    and m.role <> 'owner'
  order by m.joined_at, m.user_id;
end;
$$;

-- --------------------------------------------------------------- world_teams
--
-- The live body, and the same signature, so create or replace keeps the
-- grants. The only change: each member also carries user_id and gps_ok.

create or replace function public.world_teams(p_world uuid)
returns table(id uuid, name text, invite_code text, started_at timestamptz, members jsonb,
              solved bigint, points bigint, adjusted bigint,
              disqualified_at timestamptz, disqualified_reason text, warnings jsonb)
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
                 'joined_at', tm.joined_at,
                 'user_id', tm.user_id,
                 'gps_ok', coalesce(tm.gps_ok, false)
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

-- -------------------------------------------------------------------- grants
--
-- Default privileges hand every new function to anon, so anon is revoked by
-- name. service_role keeps its default.

revoke all on function public.moderator_kick(uuid, uuid)   from public, anon;
revoke all on function public.moderator_ban(uuid, uuid)    from public, anon;
revoke all on function public.moderator_unban(uuid, uuid)  from public, anon;
revoke all on function public.world_players(uuid)          from public, anon;
revoke all on function public.world_teams(uuid)            from public, anon;
revoke all on function public.assert_may_play(uuid)        from public, anon;
grant execute on function public.moderator_kick(uuid, uuid)  to authenticated;
grant execute on function public.moderator_ban(uuid, uuid)   to authenticated;
grant execute on function public.moderator_unban(uuid, uuid) to authenticated;
grant execute on function public.world_players(uuid)         to authenticated;
grant execute on function public.world_teams(uuid)           to authenticated;
grant execute on function public.assert_may_play(uuid)       to authenticated;

comment on function public.moderator_kick(uuid, uuid) is
  'Owner/admin: removes a player from their team and the trail. They may join again. Refuses the owner.';
comment on function public.moderator_ban(uuid, uuid) is
  'Owner/admin: kick, then refuse every way back in (error banned).';
comment on function public.moderator_unban(uuid, uuid) is
  'Owner/admin: lifts a ban. The player must join again.';
comment on function public.world_players(uuid) is
  'Owner/admin: every non-owner member of the trail with their team (or null) and GPS readiness.';

commit;
