-- 0068 - database clean-up (9 Nov 2026)
--
-- NOT APPLIED — awaiting Alex's review.
--
-- Evidence, full definitions, grants and restore SQL for everything below are in
-- docs/db-cleanup-2026-11-09.md (sections a and c).
--
-- Drops: only objects with zero references in code (web, edge functions, tools,
-- tests, Unity scripts) AND in the database (function bodies, policies,
-- triggers, views, pg_depend, cron).
--
-- Leftover data: lab-test accounts and their trails. On 9 Nov there were 0, so
-- these deletes are a safety net and change nothing today.
--
-- NOT here on purpose: the 30 orphaned marker-media files (about 162 MiB).
-- storage.objects refuses SQL deletes (storage.protect_delete, 42501), and a
-- forced row delete would leave the file in the object store. Remove them with
-- the Storage API instead. The listing query is in the doc, section (c).
--
-- Undo: re-create public.consents_to_answer() and its grants from the doc,
-- section (a). Deleted lab-test rows are not restorable, and are not meant to be.

begin;

-- (a) superseded by my_children() on the consent page; nothing calls it.
drop function if exists public.consents_to_answer();

-- (c) lab-test leftovers that cleanUsers() missed (same pattern as tests/lab/lib.mjs).
delete from public.worlds
 where owner_id in (select id from auth.users where email like 'lab-test-%@example.com');
delete from auth.users
 where email like 'lab-test-%@example.com';

commit;
