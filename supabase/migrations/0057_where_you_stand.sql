-- 0057 - a stop is reached where it stands, and a finish counts at once
--
-- Design: docs/superpowers/specs/2026-10-30-web-lite-design.md, parts 1 and 2.
--
-- 1. record_visit trusted the phone. Since 0056 a visit is worth XP, so a
--    script could claim every public stop from a sofa. It now takes the
--    phone's position and asks position_problem (0045), the check answers
--    already pass: not a mock location, not farther than the stop's radius +
--    accuracy + 200 m, no jump faster than 60 m/s. On top, a reading worse than
--    50 m is refused here (not flagged: it is weak signal, not cheating). The
--    two-argument version is dropped, so nothing can go round it. It returns
--    'ok' or what was wrong, for the clients to say.
--
-- 2. A finished trail was recorded when the walker next opened their profile,
--    and its creator's bonus paid then. record_finish decides "finished"
--    exactly as profile_for does, for one trail, and runs after every new visit
--    and after every change to a team's progress, for each of its members: a
--    team that finishes together is paid together, at the last stop.
--
-- Safe to run twice.

begin;

-- ------------------------------------------------------------ 1. the visit
drop function if exists public.record_visit(uuid, text);

create or replace function public.record_visit(
  p_marker   uuid,
  p_via      text,
  p_lat      double precision,
  p_lng      double precision,
  p_accuracy double precision,
  p_mock     boolean default false
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world uuid;
  v_where text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  if p_via not in ('camera', 'map') then
    raise exception 'unknown way of visiting' using errcode = 'P0001';
  end if;

  select m.world_id into v_world
  from public.markers m
  where m.id = p_marker and m.status = 'published';

  -- A stop that is not published, or on a trail this person is not on, is not
  -- a stop they can have visited.
  if v_world is null or public.world_role(v_world) is null then
    return 'not_here';
  end if;

  if p_lat is null or p_lng is null then
    return 'no_position';
  end if;

  if p_accuracy is null or p_accuracy > 50 then
    return 'inaccurate';
  end if;

  v_where := public.position_problem(p_marker, p_lat, p_lng, p_accuracy, p_mock);
  if v_where <> 'ok' then
    return v_where;
  end if;

  insert into public.stop_visits (user_id, marker_id, via)
  values (auth.uid(), p_marker, p_via)
  on conflict (user_id, marker_id) do update
    -- A camera visit outranks a map one; the first time is kept either way.
    set via = case when excluded.via = 'camera' then 'camera'
                   else public.stop_visits.via end;

  return 'ok';
end;
$$;

revoke all on function public.record_visit(uuid, text, double precision, double precision, double precision, boolean) from public, anon;
grant execute on function public.record_visit(uuid, text, double precision, double precision, double precision, boolean) to authenticated;

-- ------------------------------------------------------- 2. the finish, at once
-- profile_for's rule, for one person and one trail: every published stop done
-- (on a scored trail a stop with a question is done when the team settled it;
-- elsewhere reaching it is enough), and a game needs a team.
create or replace function public.record_finish(p_user uuid, p_world uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode  text;
  v_name  text;
  v_team  uuid;
  v_total integer;
  v_done  integer;
begin
  if p_user is null or p_world is null
     or not exists (select 1 from public.world_members wm
                    where wm.world_id = p_world and wm.user_id = p_user)
     or exists (select 1 from public.walked_trails t
                where t.user_id = p_user and t.world_id = p_world) then
    return;
  end if;

  select w.mode, w.name into v_mode, v_name from public.worlds w where w.id = p_world;

  select tt.id into v_team
  from public.teams tt
  join public.team_members tm on tm.team_id = tt.id
  where tm.user_id = p_user and tt.world_id = p_world
  limit 1;

  select count(*) into v_total
  from public.markers k where k.world_id = p_world and k.status = 'published';

  select count(*) into v_done
  from public.markers k
  where k.world_id = p_world and k.status = 'published'
    and case
          when public.mode_is_scored(v_mode)
               and exists (select 1 from public.marker_answers a where a.marker_id = k.id)
          then v_team is not null and exists (
                 select 1 from public.marker_progress p
                 where p.team_id = v_team and p.marker_id = k.id)
          else exists (select 1 from public.stop_visits v
                       where v.user_id = p_user and v.marker_id = k.id)
               or (v_team is not null and exists (
                     select 1 from public.marker_progress p
                     where p.team_id = v_team and p.marker_id = k.id))
        end;

  if v_total > 0 and v_done >= v_total
     and (not public.mode_is_scored(v_mode) or v_team is not null) then
    insert into public.walked_trails (user_id, world_id, name, mode)
    values (p_user, p_world, v_name, v_mode)
    on conflict (user_id, world_id) do nothing;
  end if;
end;
$$;

create or replace function public.finish_after_visit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.record_finish(new.user_id,
    (select m.world_id from public.markers m where m.id = new.marker_id));
  return new;
end;
$$;

drop trigger if exists finish_after_visit on public.stop_visits;
create trigger finish_after_visit after insert on public.stop_visits
  for each row execute function public.finish_after_visit();

create or replace function public.finish_after_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world  uuid;
  v_member uuid;
begin
  select t.world_id into v_world from public.teams t where t.id = new.team_id;
  for v_member in select tm.user_id from public.team_members tm where tm.team_id = new.team_id loop
    perform public.record_finish(v_member, v_world);
  end loop;
  return new;
end;
$$;

drop trigger if exists finish_after_progress on public.marker_progress;
create trigger finish_after_progress after insert or update on public.marker_progress
  for each row execute function public.finish_after_progress();

revoke all on function public.record_finish(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_after_visit() from public, anon, authenticated;
revoke all on function public.finish_after_progress() from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
