-- =============================================================================
-- Who you are playing with
-- =============================================================================
--
-- team_members is readable by anybody on the team, so a phone can count its
-- teammates. profiles is not: profiles_select_own restricts it to your own row,
-- deliberately, because a walker's name is not public and a trail full of
-- strangers should not be a directory of them.
--
-- The consequence is that the app can say "3 people" and cannot say who. That is
-- a team screen that tells you nothing about your team.
--
-- So: one function, which returns names only to somebody already on that team,
-- and returns them without exposing the table they came from. Everything the
-- team screen needs in one call, because a phone in a street should ask once.
--
-- Safe to run twice.
-- =============================================================================

begin;

create or replace function public.my_team_detail(p_world uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_team uuid;
  v_row  public.teams;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  v_team := public.my_team(p_world);

  -- Not on a team is a normal answer, not an error. The screen that asks this
  -- is the screen that offers to make one.
  if v_team is null then
    return jsonb_build_object('on_team', false);
  end if;

  select * into v_row from public.teams where id = v_team;

  return jsonb_build_object(
    'on_team', true,
    'id',      v_row.id,
    'name',    v_row.name,
    -- The code that lets somebody else join THIS team, which is a different
    -- thing from the trail's join code and is the one people mix up.
    'invite_code', v_row.invite_code,
    'started_at',  v_row.started_at,
    'members', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'name', coalesce(nullif(trim(p.display_name), ''), 'Player'),
                 'is_me', tm.user_id = auth.uid()
               ) order by tm.joined_at)
        from public.team_members tm
        left join public.profiles p on p.id = tm.user_id
       where tm.team_id = v_team), '[]'::jsonb),
    -- What the strip and the board disagree about otherwise: a stop that was
    -- skipped is done and is not a solve.
    'solved', (select count(*) from public.marker_progress mp
                where mp.team_id = v_team and not mp.skipped),
    'points', (select coalesce(sum(mp.points), 0) from public.marker_progress mp
                where mp.team_id = v_team)
  );
end;
$$;

revoke all on function public.my_team_detail(uuid) from public, anon;
grant execute on function public.my_team_detail(uuid) to authenticated;

comment on function public.my_team_detail(uuid) is
  'Everything a team screen shows, for the caller''s own team in one trail. '
  'Names are returned only to somebody already on that team; profiles stays '
  'own-row-only for everybody else.';

commit;
