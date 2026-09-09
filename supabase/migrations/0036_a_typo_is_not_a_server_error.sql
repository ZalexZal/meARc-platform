-- 0036 - a typo is not a server error
--
-- A phone typed a wrong trail code and the app said "Couldn't reach the
-- server. Try again." The connection was fine. join_world had raised
--
--   no world with that code    errcode = no_data_found
--
-- and no_data_found is SQLSTATE P0002, which PostgREST answers as HTTP 500.
-- The app treats 400 and 404 as "that code is wrong" and everything else as a
-- fault of ours, so a six-character typo - the single most common thing that
-- will happen on the twelfth - sent people to blame the wifi, and the sentence
-- the database had already written for them was thrown away.
--
-- 0029 hit this once before, on ensure_team, and moved that one to P0001. It
-- was never swept up. Eight functions still do it, and two of them are the ones
-- a walker touches most: join_world for the trail code and join_team for the
-- team code.
--
-- P0001 is raise_exception, which PostgREST answers as 400. Nothing else about
-- these functions changes: same checks, same wording, same order. Only the
-- class of the answer, from "this server broke" to "that was not right".
--
-- Safe to run twice.

begin;

CREATE OR REPLACE FUNCTION public.decide_listing(p_world uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS worlds
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.worlds;
begin
  if not public.is_admin() then
    raise exception 'not a reviewer' using errcode = '42501';
  end if;

  if p_approve then
    update public.worlds
       set visibility  = 'public',
           status      = 'published',
           review_note = nullif(trim(coalesce(p_note, '')), '')
     where id = p_world
    returning * into v_row;
  else
    -- Refused, not deleted. It goes back to being a working unlisted trail with
    -- a sentence saying why, which is a state its creator can act on.
    update public.worlds
       set visibility  = 'unlisted',
           status      = 'published',
           review_note = nullif(trim(coalesce(p_note, '')), '')
     where id = p_world
    returning * into v_row;
  end if;

  if v_row.id is null then
    raise exception 'no such trail' using errcode = 'P0001';
  end if;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.join_team(p_code text)
 RETURNS teams
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team  public.teams;
  v_mine  uuid;
  v_alone boolean;
begin
  select * into v_team
  from public.teams
  where upper(trim(invite_code)) = upper(trim(p_code));

  if v_team.id is null then
    raise exception 'no team with that code' using errcode = 'P0001';
  end if;

  perform public.assert_may_play(v_team.world_id);

  if not public.mode_is_scored(
       (select w.mode from public.worlds w where w.id = v_team.world_id)) then
    raise exception 'this trail is a guide, not a game' using errcode = '42501';
  end if;

  v_mine := public.my_team(v_team.world_id);

  -- Already there. Saying so beats a constraint violation.
  if v_mine = v_team.id then
    return v_team;
  end if;

  if v_mine is not null then
    select count(*) = 1 into v_alone
    from public.team_members tm
    where tm.team_id = v_mine;

    if not v_alone then
      raise exception 'leave your team before joining another'
        using errcode = 'check_violation';
    end if;

    -- The walk moves across. Where both teams have done the same marker the
    -- better of the two survives: a solve beats a skip, and more points beat
    -- fewer. Nobody is worse off for having joined.
    insert into public.marker_progress (team_id, marker_id, solved_by, points, skipped)
    select v_team.id, mp.marker_id, mp.solved_by, mp.points, mp.skipped
    from public.marker_progress mp
    where mp.team_id = v_mine
    on conflict (team_id, marker_id) do update
      set points  = greatest(public.marker_progress.points, excluded.points),
          skipped = public.marker_progress.skipped and excluded.skipped;

    -- Hints they had already paid for come too, or points_after_hints would
    -- recompute a score they never earned.
    insert into public.hint_reveals (hint_id, team_id, user_id)
    select hr.hint_id, v_team.id, hr.user_id
    from public.hint_reveals hr
    where hr.team_id = v_mine
    on conflict do nothing;

    update public.marker_submissions set team_id = v_team.id where team_id = v_mine;

    delete from public.marker_progress where team_id = v_mine;
    delete from public.hint_reveals where team_id = v_mine;
    delete from public.team_members where team_id = v_mine;
    delete from public.teams where id = v_mine;
  end if;

  -- The size cap and the one-team rule live in the trigger, so this insert
  -- raises rather than needing to repeat them.
  insert into public.team_members (team_id, user_id)
  values (v_team.id, auth.uid())
  on conflict (team_id, user_id) do nothing;

  return v_team;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.join_world(p_code text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_world uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select w.id into v_world
  from public.worlds w
  where upper(trim(w.join_code)) = upper(trim(p_code));

  if v_world is null then
    raise exception 'no world with that code' using errcode = 'P0001';
  end if;

  -- Rotating a join code changes the door, not who is already inside.
  insert into public.world_members (world_id, user_id, role)
  values (v_world, auth.uid(), 'viewer')
  on conflict (world_id, user_id) do nothing;

  return v_world;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.report_marker(p_marker uuid, p_reason text, p_detail text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_world uuid;
  v_id    uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select m.world_id into v_world
  from public.markers m
  where m.id = p_marker;

  -- Reportable only if the reporter could see it in the first place. Otherwise
  -- this is a way to probe which marker ids exist.
  if v_world is null
     or not (public.world_role(v_world) is not null or public.world_is_open(v_world)) then
    raise exception 'no such marker' using errcode = 'P0001';
  end if;

  -- One open report per person per marker. A second press is not a second
  -- problem, and a queue with the same thing in it forty times is a queue
  -- nobody reads.
  select id into v_id
  from public.reports
  where marker_id = p_marker and reporter_id = auth.uid() and state = 'open';

  if v_id is not null then
    return v_id;
  end if;

  insert into public.reports
    (marker_id, reporter_id, reason, detail,
     target_kind, target_title, target_trail, target_lat, target_lng)
  select
    p_marker, auth.uid(), p_reason, nullif(trim(coalesce(p_detail, '')), ''),
    'marker',
    coalesce(m.content -> 'bg' ->> 'title', m.content -> 'en' ->> 'title'),
    w.name,
    st_y(m.location::geometry),
    st_x(m.location::geometry)
  from public.markers m
  join public.worlds w on w.id = m.world_id
  where m.id = p_marker
  returning id into v_id;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.report_world(p_world uuid, p_reason text, p_detail text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  if not (public.world_role(p_world) is not null or public.world_is_open(p_world)) then
    raise exception 'no such trail' using errcode = 'P0001';
  end if;

  select id into v_id
  from public.reports
  where world_id = p_world and reporter_id = auth.uid() and state = 'open';

  if v_id is not null then
    return v_id;
  end if;

  insert into public.reports
    (world_id, reporter_id, reason, detail, target_kind, target_trail)
  select p_world, auth.uid(), p_reason, nullif(trim(coalesce(p_detail, '')), ''),
         'trail', w.name
  from public.worlds w where w.id = p_world
  returning id into v_id;

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_report(p_report uuid, p_state text, p_note text DEFAULT NULL::text)
 RETURNS reports
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_row public.reports;
begin
  if not public.is_admin() then
    raise exception 'not a reviewer' using errcode = '42501';
  end if;

  if p_state not in ('actioned','dismissed') then
    raise exception 'a report is actioned or dismissed' using errcode = 'check_violation';
  end if;

  update public.reports
     set state      = p_state,
         handled_by = auth.uid(),
         handled_at = now(),
         note       = nullif(trim(coalesce(p_note, '')), '')
   where id = p_report
  returning * into v_row;

  if v_row.id is null then
    raise exception 'no such report' using errcode = 'P0001';
  end if;

  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reveal_hint(p_hint uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_marker uuid;
  v_world  uuid;
  v_team   uuid;
  v_body   jsonb;
  v_cost   integer;
  v_ord    integer;
  v_before integer;
begin
  select h.marker_id, h.body, h.cost, h.ord
    into v_marker, v_body, v_cost, v_ord
  from public.marker_hints h where h.id = p_hint;

  if v_marker is null then
    raise exception 'no such hint' using errcode = 'P0001';
  end if;

  select m.world_id into v_world from public.markers m where m.id = v_marker;

  if public.world_role(v_world) is null then
    raise exception 'not a member of this trail' using errcode = '42501';
  end if;

  -- A guide has no hints at all - marker_detail already returns none there, and
  -- reveal_hint would otherwise be a way round that by id.
  if not public.mode_is_scored((select w.mode from public.worlds w where w.id = v_world)) then
    raise exception 'this trail is a guide, not a game' using errcode = '42501';
  end if;

  v_team := public.ensure_team(v_world);

  -- The ones before it on this marker, still shut.
  select count(*) into v_before
  from public.marker_hints h
  where h.marker_id = v_marker
    and h.ord < v_ord
    and not exists (
      select 1 from public.hint_reveals r
      where r.hint_id = h.id and r.team_id = v_team);

  if v_before > 0 then
    raise exception 'open the earlier hints first' using errcode = 'P0001';
  end if;

  insert into public.hint_reveals (team_id, hint_id, user_id)
  values (v_team, p_hint, auth.uid())
  on conflict (team_id, hint_id) do nothing;

  return jsonb_build_object('body', v_body, 'cost', v_cost,
                            'points_left', public.points_after_hints(v_team, v_marker));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.review_answer(p_submission uuid, p_correct boolean, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_sub    public.marker_submissions;
  v_world  uuid;
  v_points integer;
begin
  select * into v_sub from public.marker_submissions where id = p_submission;

  if v_sub.id is null then
    raise exception 'no such submission' using errcode = 'P0001';
  end if;

  select m.world_id into v_world from public.markers m where m.id = v_sub.marker_id;

  if v_world is null or not public.may_edit(v_world) then
    raise exception 'not yours to review' using errcode = '42501';
  end if;

  update public.marker_submissions
     set verdict     = case when p_correct then 'correct' else 'incorrect' end,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = p_note
   where id = p_submission;

  v_points := public.points_after_hints(v_sub.team_id, v_sub.marker_id);

  if p_correct then
    perform public.award_progress(v_sub.team_id, v_sub.marker_id,
                                  v_points, v_sub.user_id);
  else
    delete from public.marker_progress mp
    where mp.team_id = v_sub.team_id
      and mp.marker_id = v_sub.marker_id
      and not exists (
        select 1 from public.marker_submissions s
        where s.marker_id = v_sub.marker_id
          and s.team_id   = v_sub.team_id
          and s.id        <> p_submission
          and s.verdict   = 'correct'
      );
  end if;

  return jsonb_build_object(
    'verdict', case when p_correct then 'correct' else 'incorrect' end,
    'points',  case when p_correct then v_points else 0 end
  );
end;
$function$
;

commit;

notify pgrst, 'reload schema';
