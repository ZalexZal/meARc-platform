-- 0061 - world_readiness names each team by its id
--
-- The organiser's board matches the readiness panel and the "gave up" mark to
-- its team cards by id; names are not unique. Adds 'id' to each team in
-- world_readiness (0058). Safe to run twice.

begin;

do $$
declare d text; n text;
begin
  select pg_get_functiondef('public.world_readiness(uuid)'::regprocedure) into d;
  if position('''id'', t.id' in d) = 0 then
    n := replace(d, 'jsonb_build_object(
               ''name'', t.name,', 'jsonb_build_object(
               ''id'', t.id,
               ''name'', t.name,');
    if n = d then raise exception 'world_readiness: anchor not found'; end if;
    execute n;
  end if;
end $$;

commit;

notify pgrst, 'reload schema';
