-- 0035 - every game, not just one of them
--
-- assert_may_play refuses an anonymous walker on a competitive trail, and the
-- reason is written next to it: a ranking keeps a name against a number, and an
-- identity that vanishes when the app is uninstalled is both unfair to everybody
-- below it and impossible to contest afterwards.
--
-- It tests mode = 'ctf'. It was written in 0005, when ctf was the only game
-- there was, and 0028 added freefall without widening it. So two trails that
-- both keep a score, a leaderboard, teams and priced hints have had opposite
-- rules about who may walk them - and the one the guard was written for is the
-- one it stopped covering.
--
-- Driven, not read: an anonymous identity made a team on a freefall trail,
-- answered a question, scored forty points and appeared on the leaderboard.
--
-- The line moves to mode_is_scored, which is the function that already answers
-- "is this a game" everywhere else - in check_answer for whether points are
-- awarded, in create_team and join_team for whether teams exist at all. One
-- definition of a game, used by everything that needs one.
--
-- trail_summary.needs_account moves with it. It is the same question asked by
-- the app so it can say so before somebody types a team name, and a warning
-- drawn on a different line from the refusal is worse than no warning: it would
-- send a freefall walker in confident and stop them at the door.
--
-- Safe to run twice.

begin;

create or replace function public.assert_may_play(p_world uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mode text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  if public.world_role(p_world) is null then
    raise exception 'not a member of this trail' using errcode = '42501';
  end if;

  select w.mode into v_mode from public.worlds w where w.id = p_world;

  -- A competitive trail keeps a public ranking with a name against it. An
  -- anonymous user is a row that vanishes with the app, which is both unfair to
  -- everybody ranked below them and impossible to contest afterwards.
  --
  -- Every game, now. This asked for ctf by name and freefall walked past it.
  if public.mode_is_scored(v_mode)
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'a competitive trail needs a real account'
      using errcode = '28000';
  end if;
end;
$$;

revoke all on function public.assert_may_play(uuid) from public;
grant execute on function public.assert_may_play(uuid) to authenticated;

-- And the answer the app shows, drawn on the same line as the refusal.

create or replace function public.trail_summary(p_world uuid)
returns table (
  id uuid, name text, mode text, status text, visibility text,
  stop_count bigint, team_count bigint, total_points bigint, needs_account boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.id, w.name, w.mode, w.status, w.visibility,
    (select count(*) from public.markers m
      where m.world_id = w.id and m.status = 'published'),
    (select count(*) from public.teams t where t.world_id = w.id),
    (select coalesce(sum(a.points), 0)
       from public.marker_answers a
       join public.markers m2 on m2.id = a.marker_id
      where m2.world_id = w.id and m2.status = 'published'),
    public.mode_is_scored(w.mode)
  from public.worlds w
  where w.id = p_world
    and (public.world_role(w.id) is not null or public.world_is_open(w.id));
$$;

revoke all on function public.trail_summary(uuid) from public;
grant execute on function public.trail_summary(uuid) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
