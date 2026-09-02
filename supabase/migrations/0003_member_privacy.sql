-- =============================================================================
-- Phase 1 fix — a member could enumerate every other member
-- =============================================================================
--
-- 0002 shipped this:
--
--   create policy members_select_own_worlds on public.world_members
--     for select using (public.world_role(world_id) is not null);
--
-- Read it as the database reads it: "you may select any membership row belonging
-- to any world you are a member of." Not your row - every row. So one reader who
-- joins a trail receives the user id of everybody else who has joined it, and the
-- app draws them as duplicate trails, which is how this was noticed.
--
-- On a school trail that is one pupil holding a list of every other participant.
-- The ids are opaque, which makes it a smaller leak than names would be, and it
-- is still a roster nobody asked to publish.
--
-- The owner keeps the roster, because managing roles is impossible without it.
-- Everybody else sees the row that is theirs.
--
-- Safe to run twice.
-- =============================================================================

begin;

drop policy if exists members_select_own_worlds on public.world_members;
drop policy if exists members_select_own        on public.world_members;

create policy members_select_own on public.world_members
  for select using (
    user_id = auth.uid()
    or public.world_role(world_id) = 'owner'
  );

commit;

-- =============================================================================
-- Verify from outside the dashboard, with two different anonymous users:
--
--   1. Sign in as A, join a code, count the rows from
--      /rest/v1/world_members?select=role,user_id,worlds(id,name)
--   2. Sign in as B, join the same code, count again.
--
-- Each must see exactly one row - their own. Before this migration B saw A as
-- well, and every other member besides.
-- =============================================================================
