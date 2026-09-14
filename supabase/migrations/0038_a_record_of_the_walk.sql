-- 0038 - a record of the walk
--
-- The profile screen wants three numbers and eleven badges, and until now the
-- server could produce almost none of them. It knew what a TEAM had solved; it
-- did not know what a PERSON had walked. "Found this stop" lived only in the
-- phone's PlayerPrefs, so wiping the app or changing phones erased it, and a
-- stop with no question on it - most of a guided trail - left no trace here at
-- all. Games also never ended, so "first on the board" had no moment to be
-- first at.
--
-- This adds the missing facts and one function that reads them:
--
--   1. stop_visits      - who reached which stop, and whether through the camera.
--   2. worlds.ended_at  - an organiser can end a game; scores freeze when it does.
--   3. my_profile()     - your numbers, your trails and your badges, computed
--                         here from what the database holds. Nothing a client
--                         says can award a badge except a visit, and a visit is
--                         the one thing only the phone can know.
--   4. export_my_data   - now includes the visits, because a download of "all my
--                         data" that leaves some out is not one.
--
-- Additive only. No existing row changes, and nothing behaves differently
-- until an organiser presses End game. Safe to run twice.

begin;

-- ------------------------------------------------------------ 1. visits

create table if not exists public.stop_visits (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  marker_id  uuid not null references public.markers(id)  on delete cascade,
  -- 'camera' is the real thing: the marker was tapped standing in front of it.
  -- 'map' is the concession for when AR cannot calibrate and being inside the
  -- stop's radius by GPS has to stand in for it.
  via        text not null check (via in ('camera', 'map')),
  visited_at timestamptz not null default now(),
  primary key (user_id, marker_id)
);

create index if not exists stop_visits_marker_idx on public.stop_visits (marker_id);

alter table public.stop_visits enable row level security;

-- Your own visits and nobody else's. Written only through record_visit.
drop policy if exists stop_visits_select_own on public.stop_visits;
create policy stop_visits_select_own on public.stop_visits
  for select using (user_id = auth.uid());

create or replace function public.record_visit(p_marker uuid, p_via text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world uuid;
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

  -- A stop that is not published, or on a trail this person is not on, is not a
  -- stop they can have visited.
  if v_world is null or public.world_role(v_world) is null then
    return;
  end if;

  insert into public.stop_visits (user_id, marker_id, via)
  values (auth.uid(), p_marker, p_via)
  on conflict (user_id, marker_id) do update
    -- A camera visit outranks a map one; the first time is kept either way.
    set via = case when excluded.via = 'camera' then 'camera'
                   else public.stop_visits.via end;
end;
$$;

revoke all on function public.record_visit(uuid, text) from public, anon;
grant execute on function public.record_visit(uuid, text) to authenticated;

-- ------------------------------------------------------------ 2. ending a game

alter table public.worlds
  add column if not exists ended_at timestamptz;

comment on column public.worlds.ended_at is
  'Set when an organiser ends a game. Answers, hints and team changes are refused '
  'from then on, so the board that decides the Summit badge stops moving.';

create or replace function public.moderator_end_game(p_world uuid, p_ended boolean default true)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at timestamptz;
begin
  if not public.can_moderate(p_world) then
    raise exception 'only the organiser can end this game' using errcode = '42501';
  end if;

  update public.worlds
     set ended_at = case when p_ended then now() else null end
   where id = p_world
  returning ended_at into v_at;

  return v_at;
end;
$$;

revoke all on function public.moderator_end_game(uuid, boolean) from public, anon;
grant execute on function public.moderator_end_game(uuid, boolean) to authenticated;

-- The one place every play action already passes through. Unchanged apart from
-- the last check.
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

-- ------------------------------------------------------------ 3. my_profile

create or replace function public.my_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me       uuid := auth.uid();
  v_profile  public.profiles;
  v_trails   jsonb;
  v_finished integer;
  v_found    integer;
  v_points   bigint;
  v_camera   integer;
  v_badges   jsonb;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select * into v_profile from public.profiles where id = v_me;

  create temporary table if not exists _my_walk (
    id uuid, name text, mode text, ended_at timestamptz, joined_at timestamptz,
    team_id uuid, team_name text, team_by_me boolean, team_size integer,
    total integer, done integer, points bigint, finished boolean
  ) on commit drop;
  truncate _my_walk;

  insert into _my_walk
  select w.id, w.name, w.mode, w.ended_at, wm.joined_at,
         t.id, t.name, t.created_by = v_me,
         (select count(*) from public.team_members x where x.team_id = t.id),
         0, 0, 0, false
  from public.world_members wm
  join public.worlds w on w.id = wm.world_id
  left join lateral (
    select tt.* from public.teams tt
    join public.team_members tm on tm.team_id = tt.id
    where tm.user_id = v_me and tt.world_id = w.id
    limit 1
  ) t on true
  where wm.user_id = v_me;

  -- A stop counts as done for you if you reached it, or your team settled it -
  -- solved, skipped, or accepted on review. Either one means you were part of
  -- getting it done.
  -- "where mw.id is not null" rather than no WHERE at all.
  --
  -- Supabase runs API calls with the safeupdate guard on, which refuses any
  -- UPDATE without a WHERE clause - it protects against the classic slip of
  -- wiping a whole table. It applies to this temporary table too, so my_profile
  -- worked in the SQL editor as postgres and answered 400 to every phone. The
  -- clause is true for every row; it is there to be explicit, which is what the
  -- guard is asking for.
  update _my_walk mw set
    total = (select count(*) from public.markers k
             where k.world_id = mw.id and k.status = 'published'),
    done  = (select count(*) from public.markers k
             where k.world_id = mw.id and k.status = 'published'
               and (exists (select 1 from public.stop_visits v
                            where v.user_id = v_me and v.marker_id = k.id)
                    or (mw.team_id is not null and exists (
                          select 1 from public.marker_progress p
                          where p.team_id = mw.team_id and p.marker_id = k.id)))),
    points = case when mw.team_id is null then 0 else
               greatest(coalesce((select sum(p.points) from public.marker_progress p
                                  where p.team_id = mw.team_id), 0)
                        + coalesce((select sum(a.points) from public.team_adjustments a
                                    where a.team_id = mw.team_id), 0), 0)
             end
  where mw.id is not null;

  update _my_walk set finished = total > 0 and done >= total
  where id is not null;

  select count(*) filter (where finished), coalesce(sum(done), 0), coalesce(sum(points), 0)
    into v_finished, v_found, v_points
  from _my_walk;

  select count(*) into v_camera
  from public.stop_visits where user_id = v_me and via = 'camera';

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'name', name, 'mode', mode, 'team', team_name,
           'done', done, 'total', total, 'points', points,
           'finished', finished, 'ended', ended_at is not null)
         order by joined_at desc), '[]'::jsonb)
    into v_trails
  from _my_walk;

  v_badges := jsonb_build_array(
    jsonb_build_object('key', 'first_trail', 'earned', v_finished >= 1,
                       'progress', least(v_finished, 1), 'target', 1),

    jsonb_build_object('key', 'guided', 'earned',
      exists (select 1 from _my_walk where finished and mode = 'guide')),

    jsonb_build_object('key', 'flag_runner', 'earned',
      exists (select 1 from _my_walk where finished and mode = 'ctf')),

    jsonb_build_object('key', 'free_roamer', 'earned',
      exists (select 1 from _my_walk where finished and mode = 'freefall')),

    jsonb_build_object('key', 'scholar', 'earned',
      exists (select 1 from _my_walk where finished and mode = 'educational')),

    -- Every question on a scored trail right the first time: finished, no wrong
    -- submission, no hint bought, nothing skipped - and there were questions.
    jsonb_build_object('key', 'flawless', 'earned', exists (
      select 1 from _my_walk f
      where f.finished and public.mode_is_scored(f.mode) and f.team_id is not null
        and exists (select 1 from public.marker_answers a
                    join public.markers k on k.id = a.marker_id
                    where k.world_id = f.id and k.status = 'published')
        and not exists (select 1 from public.marker_progress p
                        join public.markers k on k.id = p.marker_id
                        where p.team_id = f.team_id and k.world_id = f.id and p.skipped)
        and not exists (select 1 from public.marker_submissions s
                        join public.markers k on k.id = s.marker_id
                        where s.team_id = f.team_id and k.world_id = f.id
                          and s.verdict = 'incorrect')
        and not exists (select 1 from public.hint_reveals h
                        join public.marker_hints mh on mh.id = h.hint_id
                        join public.markers k on k.id = mh.marker_id
                        where h.team_id = f.team_id and k.world_id = f.id))),

    -- Three steps. The tier is what the screens colour: green, amber, purple.
    jsonb_build_object('key', 'trailblazer',
      'earned',   v_finished >= 3,
      'tier',     case when v_finished >= 10 then 3
                       when v_finished >= 5  then 2
                       when v_finished >= 3  then 1 else 0 end,
      'progress', v_finished,
      'target',   case when v_finished >= 5 then 10
                       when v_finished >= 3 then 5 else 3 end),

    jsonb_build_object('key', 'team_player', 'earned',
      exists (select 1 from _my_walk
              where finished and team_id is not null and not coalesce(team_by_me, false))),

    jsonb_build_object('key', 'captain', 'earned', exists (
      select 1 from public.teams t
      where t.created_by = v_me
        and (select count(*) from public.team_members x where x.team_id = t.id) >= 3)),

    -- First on the board when the organiser ended the game.
    jsonb_build_object('key', 'summit', 'earned', exists (
      select 1 from _my_walk f
      where f.ended_at is not null and f.team_id is not null
        and f.team_id = (select lb.team_id from public.world_leaderboard(f.id) lb
                         order by lb.rank limit 1))),

    jsonb_build_object('key', 'sharp_eye', 'earned', v_camera >= 10,
                       'progress', least(v_camera, 10), 'target', 10)
  );

  return jsonb_build_object(
    'name',          v_profile.display_name,
    'since',         v_profile.created_at,
    'trails_walked', v_finished,
    'stops_found',   v_found,
    'points',        v_points,
    'trails',        v_trails,
    'badges',        v_badges
  );
end;
$$;

-- stable is a promise the temporary table would break. It is volatile.
alter function public.my_profile() volatile;

revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;

-- ------------------------------------------------------------ 4. export

create or replace function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'account', (
      select to_jsonb(p) - 'id'
      from public.profiles p where p.id = auth.uid()
    ),
    'trails_joined', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', w.name, 'role', m.role, 'joined_at', m.joined_at)), '[]'::jsonb)
      from public.world_members m
      join public.worlds w on w.id = m.world_id
      where m.user_id = auth.uid()
    ),
    'teams', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'team', t.name, 'trail', w.name, 'joined_at', tm.joined_at)), '[]'::jsonb)
      from public.team_members tm
      join public.teams  t on t.id = tm.team_id
      join public.worlds w on w.id = t.world_id
      where tm.user_id = auth.uid()
    ),
    'solved', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trail', w.name, 'points', mp.points, 'solved_at', mp.solved_at)), '[]'::jsonb)
      from public.marker_progress mp
      join public.markers m on m.id = mp.marker_id
      join public.worlds  w on w.id = m.world_id
      where mp.solved_by = auth.uid()
    ),
    'submissions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trail',     w.name,
               'submitted', s.submitted,
               'verdict',   s.verdict,
               'at',        s.created_at)), '[]'::jsonb)
      from public.marker_submissions s
      join public.markers m on m.id = s.marker_id
      join public.worlds  w on w.id = m.world_id
      where s.user_id = auth.uid()
    ),
    'stops_visited', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trail', w.name, 'via', v.via, 'at', v.visited_at)), '[]'::jsonb)
      from public.stop_visits v
      join public.markers m on m.id = v.marker_id
      join public.worlds  w on w.id = m.world_id
      where v.user_id = auth.uid()
    ),
    'trails_created', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', w.name, 'mode', w.mode, 'created_at', w.created_at)), '[]'::jsonb)
      from public.worlds w
      where w.owner_id = auth.uid()
    )
  );
$$;

revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

commit;

notify pgrst, 'reload schema';
