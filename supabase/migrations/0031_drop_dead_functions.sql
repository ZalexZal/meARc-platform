-- 0031 - two doors nothing was behind
--
-- An audit of every function a client may call against what either client
-- actually calls turned up fifteen unreached. Ten are helpers the policies use
-- under the caller's own identity, which is correct. Two of the rest are
-- answered by functions written after them:
--
--   marker_hint_list  marker_detail returns the same hints inline, with the
--                     bodies of the ones already paid for, in the one call the
--                     sheet was going to make anyway
--
-- on_team was going to be the second. It is not dead: five row-level security
-- policies call it - on teams, team_members, marker_submissions, marker_progress
-- and hint_reveals - and the database refused the drop rather than let a tidy-up
-- take five policies with it. "No client calls it" and "nothing calls it" are
-- different questions, and only the second one is the one worth asking.
--
-- Every function a client may call is a door somebody has to have thought
-- about: who may open it, what it does with what it is given, whether it leaks
-- anything on the way back. Two doors that lead where another door already goes
-- are two more than the surface needs.
--
-- Safe to run twice.

begin;

drop function if exists public.marker_hint_list(uuid);

commit;

notify pgrst, 'reload schema';
