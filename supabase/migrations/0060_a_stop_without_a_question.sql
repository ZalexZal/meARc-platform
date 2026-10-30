-- 0060 - a stop without a question counts as done once it is reached
--
-- Found while testing web lite (30 October 2026), approved by Alex the same
-- day. On an ordered trail a stop counted as done only when the team had
-- solved or skipped it in marker_progress - and a stop that asks nothing can be
-- neither. Every question after such a stop answered "out_of_order" for ever,
-- and on a one-at-a-time trail the stop after it was never revealed. The app
-- and the website were both stuck the same way.
--
-- Now a stop with no question is done once somebody on the team (or the
-- walker, before there is a team) has reached it: a stop_visits row, which
-- since 0057 the server writes only from the stop itself. Stops with a
-- question are unchanged: they are done when solved or skipped.
--
-- Changed: the order check in check_answer, and next_step_for (which decides
-- what markers_near reveals one at a time). Safe to run twice: each change is
-- skipped if it is already there.

begin;

do $$
declare d text; n text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p
  where p.proname = 'check_answer' and p.pronamespace = 'public'::regnamespace;
  if position('0060' in d) = 0 then
    n := replace(d, 'where mp.team_id = v_team and mp.marker_id = m.id);',
      E'where mp.team_id = v_team and mp.marker_id = m.id)\n'
      || E'      -- A stop that asks nothing is done once it is reached (0060).\n'
      || E'      and not (not exists (select 1 from public.marker_answers a where a.marker_id = m.id)\n'
      || E'               and exists (select 1 from public.stop_visits v\n'
      || E'                           where v.marker_id = m.id\n'
      || E'                             and (v.user_id = auth.uid()\n'
      || E'                                  or v.user_id in (select tm.user_id from public.team_members tm\n'
      || E'                                                   where tm.team_id = v_team))));');
    if n = d then raise exception 'check_answer: order anchor not found'; end if;
    execute n;
  end if;

  select pg_get_functiondef('public.next_step_for(uuid)'::regprocedure) into d;
  if position('0060' in d) = 0 then
    n := replace(d, 'and mp.team_id = public.my_team(p_world));',
      E'and mp.team_id = public.my_team(p_world))\n'
      || E'    -- A stop that asks nothing is done once it is reached (0060).\n'
      || E'    and not (not exists (select 1 from public.marker_answers a where a.marker_id = m.id)\n'
      || E'             and exists (select 1 from public.stop_visits v\n'
      || E'                         where v.marker_id = m.id\n'
      || E'                           and (v.user_id = auth.uid()\n'
      || E'                                or v.user_id in (select tm.user_id from public.team_members tm\n'
      || E'                                                 where tm.team_id = public.my_team(p_world)))));');
    if n = d then raise exception 'next_step_for: anchor not found'; end if;
    execute n;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
