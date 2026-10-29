-- 0056 - levels
--
-- A walker earns XP and climbs 50 levels (decided 29-30 October 2026):
--   - 10 XP for each stop reached, once per person per stop, by the camera or
--     from the map inside the stop's radius - stop_visits as record_visit
--     writes it;
--   - a bonus for finishing a trail, set by its creator, 0 to 500
--     (worlds.finish_bonus_xp), once per person per trail, when the finish is
--     recorded in walked_trails;
--   - only on other people's trails: never on one you own or edit, so nobody
--     levels up by placing stops in their own room. The practice trail lives
--     on the phone and never reaches the server.
--
-- XP is written into xp_awards by triggers and kept there, with the trail's
-- name, so like a badge it survives the trail or the stop being deleted. It
-- goes with the account.
--
-- The curve: from level k to k+1 takes 32 + 2k XP, so level 2 is at 34 XP
-- (four stops) and level 50, the top for now, at 4,018 XP: about a hundred
-- stops and fifteen finished trails, a month of weekend walking.
--
-- Safe to run twice.

begin;

-- --------------------------------------------------------- the creator's bonus
alter table public.worlds
  add column if not exists finish_bonus_xp integer not null default 0;
alter table public.worlds drop constraint if exists worlds_finish_bonus_xp_range;
alter table public.worlds add constraint worlds_finish_bonus_xp_range
  check (finish_bonus_xp between 0 and 500);

comment on column public.worlds.finish_bonus_xp is
  'XP a walker gets for finishing this trail, once, set by its creator (0-500).';

-- ------------------------------------------------------------------- the awards
create table if not exists public.xp_awards (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('stop', 'finish')),
  -- The stop or the trail it was for. No foreign key: the award outlives them.
  ref        uuid not null,
  world_id   uuid,
  trail_name text,
  xp         integer not null check (xp > 0),
  earned_at  timestamptz not null default now(),
  primary key (user_id, kind, ref)
);

create index if not exists xp_awards_user_idx on public.xp_awards (user_id);

alter table public.xp_awards enable row level security;
drop policy if exists xp_awards_select_own on public.xp_awards;
create policy xp_awards_select_own on public.xp_awards
  for select using (user_id = auth.uid());
grant select on public.xp_awards to authenticated;

-- Yours if you own it or edit it, now.
create or replace function public.is_own_trail(p_world uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.worlds w where w.id = p_world and w.owner_id = p_user)
      or exists (select 1 from public.world_members m
                 where m.world_id = p_world and m.user_id = p_user and m.role in ('owner', 'editor'));
$$;

create or replace function public.xp_for_visit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world uuid;
  v_name  text;
begin
  select m.world_id, w.name into v_world, v_name
  from public.markers m join public.worlds w on w.id = m.world_id
  where m.id = new.marker_id;

  if v_world is null or public.is_own_trail(v_world, new.user_id) then
    return new;
  end if;

  insert into public.xp_awards (user_id, kind, ref, world_id, trail_name, xp, earned_at)
  values (new.user_id, 'stop', new.marker_id, v_world, v_name, 10, new.visited_at)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists xp_for_visit on public.stop_visits;
create trigger xp_for_visit after insert on public.stop_visits
  for each row execute function public.xp_for_visit();

create or replace function public.xp_for_finish()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bonus integer;
begin
  if new.world_id is null or public.is_own_trail(new.world_id, new.user_id) then
    return new;
  end if;

  select w.finish_bonus_xp into v_bonus from public.worlds w where w.id = new.world_id;
  if coalesce(v_bonus, 0) <= 0 then
    return new;
  end if;

  insert into public.xp_awards (user_id, kind, ref, world_id, trail_name, xp, earned_at)
  values (new.user_id, 'finish', new.world_id, new.world_id, new.name, v_bonus, new.finished_at)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists xp_for_finish on public.walked_trails;
create trigger xp_for_finish after insert on public.walked_trails
  for each row execute function public.xp_for_finish();

-- ------------------------------------------------------------------- the levels
-- Level 1 starts at 0; each next level takes 32 + 2k more. 50 is the top.
create or replace function public.level_for_xp(p_xp integer)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_level integer := 1;
  v_floor integer := 0;
  v_step  integer;
begin
  loop
    exit when v_level >= 50;
    v_step := 32 + 2 * v_level;
    exit when coalesce(p_xp, 0) < v_floor + v_step;
    v_floor := v_floor + v_step;
    v_level := v_level + 1;
  end loop;
  return jsonb_build_object(
    'xp', coalesce(p_xp, 0),
    'level', v_level,
    'floor', v_floor,
    'next', case when v_level >= 50 then null else v_floor + 32 + 2 * v_level end,
    'max', 50);
end;
$$;

create or replace function public.my_level()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.level_for_xp(coalesce(
    (select sum(x.xp)::integer from public.xp_awards x where x.user_id = auth.uid()), 0))
  where auth.uid() is not null;
$$;

-- -------------------------------------------------------- what was already walked
insert into public.xp_awards (user_id, kind, ref, world_id, trail_name, xp, earned_at)
select v.user_id, 'stop', v.marker_id, m.world_id, w.name, 10, v.visited_at
from public.stop_visits v
join public.markers m on m.id = v.marker_id
join public.worlds w on w.id = m.world_id
where not public.is_own_trail(m.world_id, v.user_id)
on conflict do nothing;

insert into public.xp_awards (user_id, kind, ref, world_id, trail_name, xp, earned_at)
select t.user_id, 'finish', t.world_id, t.world_id, t.name, w.finish_bonus_xp, t.finished_at
from public.walked_trails t
join public.worlds w on w.id = t.world_id
where w.finish_bonus_xp > 0 and not public.is_own_trail(t.world_id, t.user_id)
on conflict do nothing;

-- ------------------------------------------------- XP in "download my data"
CREATE OR REPLACE FUNCTION public.export_user_data(p_user uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object(
    'exported_at', now(),
    'account', (select to_jsonb(p) - 'id' from public.profiles p where p.id = p_user),
    'trails_joined', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', w.name, 'role', m.role, 'joined_at', m.joined_at)), '[]'::jsonb)
      from public.world_members m join public.worlds w on w.id = m.world_id
      where m.user_id = p_user),
    'trails_walked', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', w.name, 'mode', w.mode, 'finished_at', w.finished_at)), '[]'::jsonb)
      from public.walked_trails w where w.user_id = p_user),
    'badges', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'badge', e.badge, 'tier', e.tier, 'earned_at', e.earned_at)), '[]'::jsonb)
      from public.earned_badges e where e.user_id = p_user),
    'teams', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'team', t.name, 'trail', w.name, 'joined_at', tm.joined_at)), '[]'::jsonb)
      from public.team_members tm
      join public.teams t on t.id = tm.team_id
      join public.worlds w on w.id = t.world_id
      where tm.user_id = p_user),
    'solved', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trail', w.name, 'points', mp.points, 'solved_at', mp.solved_at)), '[]'::jsonb)
      from public.marker_progress mp
      join public.markers m on m.id = mp.marker_id
      join public.worlds w on w.id = m.world_id
      where mp.solved_by = p_user),
    'submissions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trail', w.name, 'submitted', s.submitted, 'verdict', s.verdict,
               'at', s.created_at)), '[]'::jsonb)
      from public.marker_submissions s
      join public.markers m on m.id = s.marker_id
      join public.worlds w on w.id = m.world_id
      where s.user_id = p_user),
    'stops_visited', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trail', w.name, 'via', v.via, 'at', v.visited_at)), '[]'::jsonb)
      from public.stop_visits v
      join public.markers m on m.id = v.marker_id
      join public.worlds w on w.id = m.world_id
      where v.user_id = p_user),
    'trails_created', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', w.name, 'mode', w.mode, 'created_at', w.created_at)), '[]'::jsonb)
      from public.worlds w where w.owner_id = p_user),
    'blocked', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'what', b.via, 'name', b.label, 'at', b.created_at)), '[]'::jsonb)
      from public.user_blocks b where b.blocker_id = p_user),
    'last_answer_position', (
      select jsonb_build_object('lat', f.lat, 'lng', f.lng, 'accuracy_m', f.accuracy_m, 'at', f.at)
      from public.player_fixes f where f.user_id = p_user),
    'position_warnings', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trail', w.name, 'problem', f.problem, 'at', f.created_at)), '[]'::jsonb)
      from public.position_flags f join public.worlds w on w.id = f.world_id
      where f.user_id = p_user),
    'parental_consent', (
      select jsonb_build_object(
               'parent_email', c.parent_email, 'via', c.via, 'requested_at', c.requested_at,
               'granted', c.granted, 'answered_at', c.answered_at,
               'terms_version', c.terms_version)
      from public.parental_consents c where c.child_id = p_user),
    'children', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', coalesce(nullif(trim(p.display_name), ''), ''),
               'granted', c.granted, 'answered_at', c.answered_at)), '[]'::jsonb)
      from public.parental_consents c join public.profiles p on p.id = c.child_id
      where c.parent_id = p_user),
    'feedback', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'sent_at', f.created_at, 'from', f.source, 'where', f.place,
               'app_version', f.app_version, 'device', f.device,
               'message', f.message, 'reply_by_email', f.reply_ok)
               order by f.created_at), '[]'::jsonb)
      from public.feedback f where f.user_id = p_user),
    'xp', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'for', x.kind, 'trail', x.trail_name, 'xp', x.xp, 'at', x.earned_at)
               order by x.earned_at), '[]'::jsonb)
      from public.xp_awards x where x.user_id = p_user),
    'removal_notices', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'what', n.kind, 'title', n.title, 'trail', n.trail_name,
               'reasons', n.reasons, 'note', n.note, 'at', n.created_at)), '[]'::jsonb)
      from public.moderation_notices n where n.owner_id = p_user)
  );
$function$;

-- ------------------------------------------------------------------- the doors
revoke all on function public.is_own_trail(uuid, uuid) from public, anon, authenticated;
revoke all on function public.xp_for_visit() from public, anon, authenticated;
revoke all on function public.xp_for_finish() from public, anon, authenticated;
revoke all on function public.level_for_xp(integer) from public, anon;
grant execute on function public.level_for_xp(integer) to authenticated;
revoke all on function public.my_level() from public, anon;
grant execute on function public.my_level() to authenticated;

commit;

notify pgrst, 'reload schema';
