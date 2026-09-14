-- 0040 - a question is not a view
--
-- A phone walked up to the one stop of a Capture-the-flag trail, opened it from
-- the map, answered nothing, joined no team - and came away with "Flag runner:
-- finish a Capture-the-flag trail with your team", one trail walked, and nought
-- points. Because 0038 counted a stop as done if it was reached OR the team had
-- settled it, and on a scored trail that let a walk past the door count as
-- having played the game.
--
-- Two lines change. On a trail that keeps a score, a stop that asks a question
-- is done only when the team has settled it; and no scored trail counts as
-- finished for somebody who was never on a team. Guided walks are unchanged:
-- there, reaching a stop is the whole of it.
--
-- Safe to run twice.

begin;

CREATE OR REPLACE FUNCTION public.my_profile()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
               and case
                     -- On a trail that keeps a score, a stop with a question is
                     -- done when the team has settled it - solved or skipped.
                     -- Standing next to it is not an answer.
                     when public.mode_is_scored(mw.mode)
                          and exists (select 1 from public.marker_answers a
                                      where a.marker_id = k.id)
                     then mw.team_id is not null and exists (
                            select 1 from public.marker_progress p
                            where p.team_id = mw.team_id and p.marker_id = k.id)
                     -- Everywhere else - a guided walk, or a stop that asks
                     -- nothing - reaching it is the whole of it.
                     else exists (select 1 from public.stop_visits v
                                  where v.user_id = v_me and v.marker_id = k.id)
                          or (mw.team_id is not null and exists (
                                select 1 from public.marker_progress p
                                where p.team_id = mw.team_id and p.marker_id = k.id))
                   end),
    points = case when mw.team_id is null then 0 else
               greatest(coalesce((select sum(p.points) from public.marker_progress p
                                  where p.team_id = mw.team_id), 0)
                        + coalesce((select sum(a.points) from public.team_adjustments a
                                    where a.team_id = mw.team_id), 0), 0)
             end
  where mw.id is not null;

  -- And a game is not finished by somebody who was never on a team, whatever
  -- their feet did: every badge about a game says "with your team".
  update _my_walk set finished = total > 0 and done >= total
                                 and (not public.mode_is_scored(mode) or team_id is not null)
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
$function$;

commit;

notify pgrst, 'reload schema';
