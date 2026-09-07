-- 0029 - a game needs a team, and moving to one brings your walk with you
--
-- Two problems, one cause.
--
-- ensure_team quietly makes a team of one out of whoever answers something on
-- a trail with no team yet. On a guide that is exactly right: nothing is
-- scored, nobody sees the word team, and marker_progress needs somewhere to
-- hang. On a game it is wrong twice over. It puts a walker on a board under
-- whatever their profile happens to be called, before they have chosen
-- anything - and then the one-team-per-trail rule locks them there, so when
-- their friends turn up they cannot join them. Somebody who answers one
-- question before their team exists walks the rest of the trail alone.
--
-- So: on a game, ensure_team refuses instead of inventing. The app puts a
-- join-or-create screen in front of the walk, and a walker on their own makes a
-- team of themselves and names it. On a guide it behaves exactly as before.
--
-- And joining a team from a team of one carries the walk over. Not only for
-- the case above - a person who set off alone and met the others at the second
-- marker is the normal way an afternoon goes, and losing two solved markers for
-- it would be a punishment for turning up.
--
-- Safe to run twice.

begin;

-- ------------------------------------------------------------- ensure_team

create or replace function public.ensure_team(p_world uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team uuid;
  v_name text;
  v_base text;
begin
  v_team := public.my_team(p_world);
  if v_team is not null then
    return v_team;
  end if;

  perform public.assert_may_play(p_world);

  -- A game will not invent one. The name goes on a board other people read, so
  -- it is the walker's to choose - and choosing it is what stops them being
  -- locked into a team of one before they knew there was a choice to make.
  if public.mode_is_scored((select w.mode from public.worlds w where w.id = p_world)) then
    -- P0001, the plain raise, which PostgREST answers with a 400. P0002 came
    -- back as a 500, and "you have not made a team yet" is not a server fault.
    raise exception 'make or join a team first' using errcode = 'P0001';
  end if;

  select coalesce(nullif(trim(p.display_name), ''), 'Player')
    into v_base
  from public.profiles p
  where p.id = auth.uid();

  v_base := left(v_base, 28);
  v_name := v_base;

  -- The plain name first. Only if this trail already has one does the id get
  -- involved, and then only enough of it to break the tie.
  if exists (select 1 from public.teams t
             where t.world_id = p_world and t.name = v_name) then
    v_name := v_base || ' · ' || left(replace(auth.uid()::text, '-', ''), 4);
  end if;

  -- And if even that collides - two accounts whose ids share four characters in
  -- the same trail - fall through to the whole thing. Vanishingly unlikely and
  -- cheaper to handle than to reason about.
  if exists (select 1 from public.teams t
             where t.world_id = p_world and t.name = v_name) then
    v_name := v_base || ' · ' || replace(auth.uid()::text, '-', '');
  end if;

  insert into public.teams (world_id, name, invite_code, created_by)
  values (p_world, v_name, public.new_team_code(), auth.uid())
  returning id into v_team;

  insert into public.team_members (team_id, user_id)
  values (v_team, auth.uid());

  return v_team;
end;
$$;

-- ---------------------------------------------------------------- join_team
--
-- Leaving a team of one to join a real one, bringing the walk.
--
-- Only from a team of one. Dissolving a team that other people are also on
-- would take their progress with it, and "I joined another team" is not a
-- reason for somebody else's afternoon to disappear.

create or replace function public.join_team(p_code text)
returns public.teams
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team  public.teams;
  v_mine  uuid;
  v_alone boolean;
begin
  select * into v_team
  from public.teams
  where upper(trim(invite_code)) = upper(trim(p_code));

  if v_team.id is null then
    raise exception 'no team with that code' using errcode = 'no_data_found';
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
$$;

revoke all on function public.join_team(text) from public, anon;
grant execute on function public.join_team(text) to authenticated;

commit;

notify pgrst, 'reload schema';
