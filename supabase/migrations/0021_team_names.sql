-- =============================================================================
-- A team is called what the person is called
-- =============================================================================
--
-- ensure_team appended four characters of the user's id to every team name,
-- because teams has a unique (world_id, name) and two silent players both
-- called "Player" would collide. That was the right guard when nobody had a
-- name - every row was "Player" and the suffix was the only thing telling them
-- apart.
--
-- The app now asks for a name at sign-up, so the common case is a real one, and
-- "Ирина от 9б · 1a40" on a leaderboard is a name with a serial number stapled
-- to it. The suffix becomes what it should always have been: what happens when
-- two people in one trail really are called the same thing.
--
-- Existing teams are left alone. Renaming somebody's team underneath them mid
-- trail is worse than an ugly name.
--
-- Safe to run twice.
-- =============================================================================

begin;

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

-- authenticated only. 0011 deliberately took this away from anon, and an
-- anonymous walker still reaches it - anonymous sign-in issues a real JWT with
-- the authenticated role, which is the whole reason that migration could
-- tighten the grant without locking anybody out.
revoke all on function public.ensure_team(uuid) from public, anon;
grant execute on function public.ensure_team(uuid) to authenticated;

commit;
