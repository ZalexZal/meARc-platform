-- =============================================================================
-- 0041  A join code is a key, not a label
--
-- 0002 created temp_anon_read_published_worlds and said so in its name: "PHASE 1
-- ONLY, delete in Phase 3, once the app asks for a join code". 0008 repeated the
-- note at the bottom of the file and deferred it again, on the reasonable ground
-- that removing it is a behaviour change and belongs in its own migration with a
-- device test either side. This is that migration.
--
-- What it currently allows, measured rather than guessed. With nothing but the
-- anon key that ships inside the Android app and in the website's JavaScript:
--
--     GET /rest/v1/worlds?select=name,join_code
--     200 [{"name":"Test","join_code":"wp8k23"},
--          {"name":"Сканиране","join_code":"fk7ev4"},
--          {"name":"Test 08 09","join_code":"66qztz"}, ...]
--
-- Every unlisted published trail, with its join code, to anyone who asks. The
-- same holds for a signed-in anonymous walker, which is what the app actually
-- is. A join code is the only thing standing between a stranger and a trail:
-- 0023 went to the trouble of making codes unguessable, and this policy hands
-- them out. It also makes "unlisted" untrue as a word.
--
-- Nothing needs it. The three functions the app uses to look at a trail before
-- joining one are all security definer, so they read the row themselves and
-- never consult this policy:
--
--     trail_summary   security_definer = true
--     join_world      security_definer = true
--     my_worlds       security_definer = true
--
-- and the website only reads public.worlds directly from the trail editor, the
-- board and publishing.ts, all of which run as a signed-in owner or editor and
-- are covered by worlds_select_member.
--
-- After this, a caller who is not a member of a trail cannot read its row at
-- all. That is the intended end state: you learn a trail exists by being given
-- its code, and join_world is the door.
--
-- If a public directory of trails is ever wanted, it should not come back as a
-- policy on this table. It should be a security definer function returning the
-- columns a stranger may see - name, mode, a description - and never join_code.
--
-- Verify either side of this, on a device:
--
--   * with the anon key alone: worlds?select=join_code returns [] rather than
--     every code on the database.
--   * open the app on a trail already chosen: the header still names it and the
--     mode chip is still right (trail_summary).
--   * join a trail by typing its code: still works (join_world).
--   * the trail list for somebody who owns nothing: zero rows, not an error.
-- =============================================================================

begin;

drop policy if exists temp_anon_read_published_worlds on public.worlds;

commit;
