-- =============================================================================
-- Shutting the functions nobody should be able to call
-- =============================================================================
--
-- Found by verify_phase2.sh, which called award_progress as an ordinary
-- signed-in user and got back a foreign key violation. A foreign key violation
-- means the function ran. With a real team id instead of a zeroed one, that
-- call awards a team as many points as the caller asks for.
--
-- The cause is a wrong assumption in 0005-0010, repeated six times:
--
--     revoke all on function public.award_progress(...) from public;
--
-- PUBLIC is not the only grantee. Supabase ships ALTER DEFAULT PRIVILEGES that
-- grant EXECUTE on every new function in this schema to anon, authenticated and
-- service_role. Revoking from PUBLIC leaves all three untouched, so every
-- function written since 0001 has been callable by anybody holding the anon key
-- - which is the key inside the APK.
--
-- Two fixes, because one of them only cleans up the past:
--
--   1. Revoke the functions that were never meant to be reachable.
--   2. Change the default, so the next function written is closed until somebody
--      opens it on purpose.
--
-- After this, a new RPC is invisible to clients until it gets an explicit grant.
-- That will feel like a bug the first time it happens. It is the point: a
-- forgotten grant is a broken feature, and a forgotten revoke is a hole.
--
-- Safe to run twice.
-- =============================================================================

begin;

-- ------------------------------------------- 1. the ones that ran and should not
--
-- award_progress is the only genuine hole here. It takes a team, a marker and a
-- number of points, and trusts all three, because the only callers were meant to
-- be check_answer and review_answer - both of which establish who is asking
-- before they call it. Exposed directly, it is a "give me points" endpoint.
--
-- The rest are helpers and trigger bodies. None of them is exploitable on its
-- own, and all of them are noise on a public API surface that should only carry
-- the calls a client actually makes.

do $$
declare
  fn text;
  internal text[] := array[
    'award_progress',           -- awards points. the actual hole.
    'assert_may_play',          -- a guard, meaningless to call alone
    'new_join_code',            -- generates a code without attaching it to anything
    'new_team_code',
    'generate_join_code',
    'handle_new_user',          -- trigger bodies below: a trigger does not need
    'markers_touch',            -- the calling role to hold EXECUTE, so revoking
    'world_owner_membership',   -- costs nothing and removes them from the API
    'team_membership_guard'
  ];
begin
  foreach fn in array internal loop
    -- Every overload of the name. Signatures are spelled out nowhere here on
    -- purpose: this has to keep working when one of them gains an argument.
    for fn in
      select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = fn
    loop
      execute format('revoke all on function %s from anon, authenticated, public', fn);
    end loop;
  end loop;
end $$;

-- ------------------------------------------------- 2. closed by default, from now on
--
-- Applies to functions created after this runs, by the role that runs it. Every
-- migration here runs as the project owner, so that is the right role.

alter default privileges in schema public
  revoke execute on functions from anon, authenticated;

-- ----------------------------------------- 3. and the ones that are meant to be open
--
-- Re-granted explicitly rather than left to a default, so this list is the
-- answer to "what can a client call" and reading the list is the audit.

grant execute on function public.markers_near(uuid, double precision, double precision, integer) to anon, authenticated;
grant execute on function public.world_role(uuid)         to anon, authenticated;
grant execute on function public.world_is_open(uuid)      to anon, authenticated;
grant execute on function public.my_team(uuid)            to anon, authenticated;
grant execute on function public.on_team(uuid)            to anon, authenticated;
grant execute on function public.world_leaderboard(uuid)  to anon, authenticated;
grant execute on function public.trail_summary(uuid)      to anon, authenticated;
grant execute on function public.public_trails()          to anon, authenticated;

grant execute on function public.join_world(text)                     to authenticated;
grant execute on function public.accept_terms(text)                   to authenticated;
grant execute on function public.create_team(uuid, text)              to authenticated;
grant execute on function public.join_team(text)                      to authenticated;
grant execute on function public.ensure_team(uuid)                    to authenticated;
grant execute on function public.leave_team(uuid)                     to authenticated;
grant execute on function public.check_answer(uuid, text)             to authenticated;
grant execute on function public.review_answer(uuid, boolean, text)   to authenticated;
grant execute on function public.my_progress(uuid)                    to authenticated;
grant execute on function public.my_history()                         to authenticated;
grant execute on function public.my_worlds()                          to authenticated;
grant execute on function public.review_queue(uuid)                   to authenticated;
grant execute on function public.create_world(text, text, text)       to authenticated;
grant execute on function public.rotate_join_code(uuid)               to authenticated;
grant execute on function public.trail_markers(uuid)                  to authenticated;
grant execute on function public.export_my_data()                     to authenticated;
grant execute on function public.what_delete_removes()                to authenticated;
grant execute on function public.delete_my_account()                  to authenticated;
grant execute on function public.set_marker_answer(uuid, text, text[], integer, integer) to authenticated;
grant execute on function public.clear_marker_answer(uuid)            to authenticated;
grant execute on function public.place_marker(uuid, double precision, double precision, jsonb, text, text, integer, text) to authenticated;
grant execute on function public.move_marker(uuid, double precision, double precision) to authenticated;

-- ------------------------------------- 4. and anon loses the signed-in-only ones
--
-- Changing the default does not retract grants already made, so every function
-- above still carried anon's EXECUTE from before this migration. None of them is
-- exploitable - each one raises on a null auth.uid() - but the grant list above
-- is meant to be readable as the answer to "what can a client call", and it was
-- not true while anon could call all of it.

do $$
declare
  sig text;
  signed_in_only text[] := array[
    'join_world','accept_terms','create_team','join_team','ensure_team','leave_team',
    'check_answer','review_answer','my_progress','my_history','my_worlds',
    'review_queue','create_world','rotate_join_code','trail_markers',
    'export_my_data','what_delete_removes','delete_my_account',
    'set_marker_answer','clear_marker_answer','place_marker','move_marker'
  ];
begin
  for sig in
    select format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any (signed_in_only)
  loop
    execute format('revoke execute on function %s from anon', sig);
  end loop;
end $$;

commit;

-- =============================================================================
-- Verify from outside the dashboard:
--
--   * award_progress as a signed-in user: not found. Not a foreign key error -
--     "not found" is what a revoked function looks like through PostgREST.
--   * check_answer still works, which proves the revoke did not take the
--     internal caller down with it.
--   * verify_phase2.sh check 7 goes green.
-- =============================================================================
