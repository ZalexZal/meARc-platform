-- =============================================================================
-- A delete that trips over its own foreign keys
-- =============================================================================
--
-- Deleting a user who both owns a trail and answered questions on it fails:
--
--   insert or update on table "marker_submissions" violates foreign key
--   constraint "marker_submissions_marker_id_fkey"
--   Key (marker_id)=(...) is not present in table "markers".
--
-- Nothing was inserted or updated by anybody. The message is the foreign key
-- system describing its own cascade.
--
-- marker_submissions points at two things that both go when that user goes:
--
--   user_id   -> profiles, ON DELETE SET NULL   (keep the answer, lose the name)
--   marker_id -> markers,  ON DELETE CASCADE    (the trail goes, its answers go)
--
-- Deleting the owner fires both. The SET NULL is an UPDATE of a row whose marker
-- the CASCADE has already removed, and updating a row re-checks its foreign
-- keys - including the one that no longer resolves. Whichever order Postgres
-- picks, one of the two is looking at the other's leftovers.
--
-- 0012 worked around it inside delete_my_account by removing the person's trails
-- first. That fixes the button. It does not fix a delete from the dashboard, a
-- delete from a support script, or the next code path that removes a user - all
-- of which hit the same wall, with the same message about a table they have no
-- reason to know exists.
--
-- Making the marker_id check DEFERRABLE moves it from "immediately after each
-- statement" to "before the transaction commits". By then both the submission
-- and the marker are gone and there is nothing left to disagree about. Normal
-- inserts behave exactly as before: a bad marker_id is still rejected, just at
-- commit instead of on the spot.
--
-- Safe to run twice.
-- =============================================================================

begin;

-- Every cascading foreign key on these two tables, not just the one that
-- happened to fail first.
--
-- The first version of this migration deferred marker_id and stopped. The very
-- next run failed on team_id, which has the identical shape - a cascade racing a
-- SET NULL on the same row. Fixing them one error message at a time would have
-- taken three more rounds and left whichever one nobody exercised.
--
-- Rebuilt from the catalogue rather than from a list, so a foreign key added
-- later is covered by re-running this file.

do $$
declare
  c record;
  cols text;
  ref  text;
begin
  for c in
    select con.conname,
           con.conrelid::regclass::text as tbl,
           con.confrelid::regclass::text as reftbl,
           con.oid
    from pg_constraint con
    where con.contype = 'f'
      and con.confdeltype = 'c'          -- ON DELETE CASCADE
      and not con.condeferrable
      and con.conrelid in (
        'public.marker_submissions'::regclass,
        'public.marker_progress'::regclass
      )
  loop
    select string_agg(quote_ident(a.attname), ', ' order by k.ord)
      into cols
    from pg_constraint con2
    cross join unnest(con2.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = con2.conrelid and a.attnum = k.attnum
    where con2.oid = c.oid;

    select string_agg(quote_ident(a.attname), ', ' order by k.ord)
      into ref
    from pg_constraint con2
    cross join unnest(con2.confkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = con2.confrelid and a.attnum = k.attnum
    where con2.oid = c.oid;

    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%s) references %s (%s) '
      'on delete cascade deferrable initially deferred',
      c.tbl, c.conname, cols, c.reftbl, ref);

    raise notice 'deferred %.%', c.tbl, c.conname;
  end loop;
end $$;

commit;

-- =============================================================================
-- Verify:
--
--   * create a user, give them a trail, have them answer a question on it, then
--     delete the user directly. It should succeed with no ordering help.
--   * insert a submission with a marker_id that does not exist: still refused,
--     at commit rather than at the statement.
-- =============================================================================
