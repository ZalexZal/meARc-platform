-- 0025 - a trail's share of the storage, and the delete that never worked
--
-- Two things, both about the marker-media bucket.
--
-- FIRST, the bug. 0014 wrote insert, update and delete policies and no select
-- policy. Downloads never noticed, because a public bucket serves those on a
-- route that does not consult RLS at all - but the Storage API reads the
-- object's row before it removes it, and with no select policy that read finds
-- nothing and the delete comes back "Access denied". So a creator has never
-- been able to take a photo off a stop, and every replaced picture is still in
-- the bucket. The bucket is public: a policy that lets anyone see the row of a
-- file anyone can already download gives away nothing.
--
-- SECOND, the cap. 200 MB a trail, checked in the insert policy so it cannot be
-- talked out of. The check reads the total BEFORE the new file, which means a
-- trail sitting just under the line can still land one more file on top of it -
-- so the true ceiling is 200 MB plus one file, and one file is capped at 50 MB
-- by the bucket. That is the honest bound, and it is a bound; the builder does
-- the exact arithmetic before it uploads, because it is the only place that
-- knows the size of the thing being sent.
--
-- Worth saying out loud: the project's whole free allowance is 1 GB, so five
-- full trails fill it. The number is a decision, not a limit of the system.
--
-- Safe to run twice.

begin;

-- ------------------------------------------------------------------ the words
create or replace function public.media_cap_bytes()
returns bigint
language sql
immutable
as $$ select 209715200::bigint $$;      -- 200 MB

comment on function public.media_cap_bytes() is
  'How much media one trail may hold. Read by the insert policy and by the '
  'builder''s usage bar, so the number lives in exactly one place.';

-- ------------------------------------------------------------ what is in use
create or replace function public.world_media_bytes(p_world uuid)
returns bigint
language sql
stable
security definer
-- storage too: foldername() and the objects table both live there.
set search_path = public, storage
as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint
  from storage.objects o
  where o.bucket_id = 'marker-media'
    and (storage.foldername(o.name))[1] = p_world::text;
$$;

revoke all on function public.world_media_bytes(uuid) from public, anon;
grant execute on function public.world_media_bytes(uuid) to authenticated;

-- What the bar in the builder draws. One call, so the editor does not have to
-- know the cap or how the paths are shaped.
create or replace function public.world_media_usage(p_world uuid)
returns table (used_bytes bigint, cap_bytes bigint, files integer)
language plpgsql
stable
security definer
set search_path = public, storage
as $$
begin
  if not public.may_edit(p_world) then
    raise exception 'not yours' using errcode = '42501';
  end if;

  return query
  select public.world_media_bytes(p_world),
         public.media_cap_bytes(),
         (select count(*)::integer from storage.objects o
           where o.bucket_id = 'marker-media'
             and (storage.foldername(o.name))[1] = p_world::text);
end;
$$;

revoke all on function public.world_media_usage(uuid) from public, anon;
grant execute on function public.world_media_usage(uuid) to authenticated;

-- --------------------------------------------------------------- the policies
--
-- The missing one. Everything in this bucket is already downloadable by anyone
-- with the URL, so seeing the row is not a disclosure - and without it the API
-- cannot delete or list anything.
drop policy if exists marker_media_select on storage.objects;
create policy marker_media_select on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'marker-media');

-- Same as before, plus the cap.
drop policy if exists marker_media_insert on storage.objects;
create policy marker_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'marker-media'
    and public.may_edit(((storage.foldername(name))[1])::uuid)
    and public.world_media_bytes(((storage.foldername(name))[1])::uuid)
        < public.media_cap_bytes()
  );

commit;

notify pgrst, 'reload schema';
