-- 0026 - taking the files with it
--
-- Every path that destroys something destroys the row and leaves the file. A
-- trail removed for offensive content leaves the offensive photo sitting in a
-- public bucket, downloadable by anyone who noted the URL; a deleted account
-- leaves its owner's pictures behind forever. Neither is what removal means.
--
-- SQL cannot fix this on its own. storage.objects refuses a direct delete -
-- Supabase puts a trigger there specifically to stop rows being orphaned from
-- the files they describe - so the deletion has to go through the Storage API,
-- which means it has to happen in a browser holding a session. This migration
-- gives that browser the two things it lacks: a way to ask which files belong
-- to a thing, and permission to delete them when it is a moderator rather than
-- the owner.
--
-- The order matters and lives in the page: list, delete the files, then call
-- the RPC that deletes the rows. Doing it the other way round asks may_edit
-- about a world that no longer exists, which is exactly how the orphans in
-- there got made.
--
-- Safe to run twice.

begin;

-- Which files belong to this trail, or to one stop of it.
create or replace function public.media_paths(p_world uuid, p_marker uuid default null)
returns setof text
language plpgsql
stable
security definer
set search_path = public, storage
as $$
begin
  if not public.may_edit(p_world) and not public.is_admin() then
    raise exception 'not yours' using errcode = '42501';
  end if;

  return query
  select o.name
  from storage.objects o
  where o.bucket_id = 'marker-media'
    and (storage.foldername(o.name))[1] = p_world::text
    and (p_marker is null or (storage.foldername(o.name))[2] = p_marker::text)
  order by o.name;
end;
$$;

revoke all on function public.media_paths(uuid, uuid) from public, anon;
grant execute on function public.media_paths(uuid, uuid) to authenticated;

comment on function public.media_paths(uuid, uuid) is
  'The storage object names under one trail, or one stop. For the owner or a '
  'platform reviewer, so a browser can delete the files before the rows that '
  'point at them go.';

-- A moderator is not an editor of the trail they are removing, so may_edit
-- alone would refuse them - which would leave the reviewer able to delete the
-- record and not the picture that was reported.
drop policy if exists marker_media_delete on storage.objects;
create policy marker_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'marker-media'
    and (public.may_edit(((storage.foldername(name))[1])::uuid) or public.is_admin())
  );

commit;

notify pgrst, 'reload schema';
