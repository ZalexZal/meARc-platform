-- LAB (overnight experiment, 4-5 Nov 2026). Additive only: one new function,
-- nothing existing is changed, so the main app behaves exactly as before.
-- Undo with lab_revert.sql.
--
-- One code box in the app. A walker types whatever code they were given; if
-- it is not a trail's code, the app asks this function whether it is a team's,
-- gets that team's trail code back, joins the trail with join_world (every
-- check that has) and then the team with join_team (every check that has).
-- Someone holding a team code is already invited into that team on that
-- trail, so handing them the trail's code gives away nothing new.

begin;

create or replace function public.lab_trail_code_for_team(p_code text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select w.join_code
  from public.teams t
  join public.worlds w on w.id = t.world_id
  where upper(trim(t.invite_code)) = upper(trim(p_code))
    and t.gave_up_at is null
    and t.disqualified_at is null
    and auth.uid() is not null
  limit 1;
$$;

revoke all on function public.lab_trail_code_for_team(text) from public, anon;
grant execute on function public.lab_trail_code_for_team(text) to authenticated;

commit;

notify pgrst, 'reload schema';
