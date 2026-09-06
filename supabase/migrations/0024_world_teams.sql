-- 0024 - the teams on a trail, for the person running it
--
-- The board already says which team is winning. It cannot say who is on that
-- team, and profiles stays own-row-only on purpose, so an organiser standing in
-- a schoolyard with thirty children has no way to answer the two questions they
-- actually get asked: "which team am I on?" and "what was our code again?".
--
-- my_team_detail answers both, for your own team, in the app. This is the same
-- answer for every team, to the one person entitled to it: whoever owns the
-- trail. Not the players - a trail full of strangers should not become a
-- directory of them, which is the whole reason profiles is locked down.
--
-- Safe to run twice.

begin;

create or replace function public.world_teams(p_world uuid)
returns table (
  id          uuid,
  name        text,
  invite_code text,
  started_at  timestamptz,
  members     jsonb,
  solved      bigint,
  points      bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Owner or platform reviewer. An editor on the trail is deliberately not
  -- enough: editing stops is not a reason to be handed everybody's name.
  if public.world_role(p_world) is distinct from 'owner' and not public.is_admin() then
    raise exception 'not yours' using errcode = '42501';
  end if;

  return query
  select
    t.id,
    t.name,
    -- The organiser reads this out to whoever lost it. It is the team's code,
    -- not the trail's.
    t.invite_code,
    t.started_at,
    coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'name', coalesce(nullif(trim(p.display_name), ''), 'Player'),
                 'joined_at', tm.joined_at
               ) order by tm.joined_at)
        from public.team_members tm
        left join public.profiles p on p.id = tm.user_id
       where tm.team_id = t.id), '[]'::jsonb),
    -- Skipped is done and is not solved, the same way the board counts it.
    (select count(*) from public.marker_progress mp
      where mp.team_id = t.id and not mp.skipped),
    (select coalesce(sum(mp.points), 0) from public.marker_progress mp
      where mp.team_id = t.id)
  from public.teams t
  where t.world_id = p_world
  order by t.created_at;
end;
$$;

revoke all on function public.world_teams(uuid) from public, anon;
grant execute on function public.world_teams(uuid) to authenticated;

comment on function public.world_teams(uuid) is
  'Every team on one trail, with its members and its invite code, for the '
  'trail owner or a platform reviewer only. Players get my_team_detail.';

commit;

notify pgrst, 'reload schema';
