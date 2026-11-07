-- 0063 - models at full size
--
-- Brokers place a whole building on its plot at 1:1 (6 Nov 2026), so the
-- limits set for statues and artefacts in 0055 rise:
--
--   height     10 m        -> 200 m      (any building in the country)
--   file       25 MB       -> 50 MB      (the marker-media bucket's own limit,
--                                         and the Supabase free plan's)
--   triangles  300,000     -> 1,000,000  (about what a mid-range phone still
--                                         draws smoothly in AR)
--
-- The browser checks the same numbers first (web/src/lib/glb.ts); these are
-- the checks it cannot skip.
--
-- Undo: the same three statements with 10, 26214400 and 300000.

begin;

alter table public.marker_models drop constraint if exists marker_models_height_m_check;
alter table public.marker_models
  add constraint marker_models_height_m_check check (height_m between 0.2 and 200);

alter table public.marker_models drop constraint if exists marker_models_triangles_check;
alter table public.marker_models
  add constraint marker_models_triangles_check check (triangles between 1 and 1000000);

create or replace function public.marker_models_check()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_world uuid;
  v_size  bigint;
begin
  select m.world_id into v_world from public.markers m where m.id = new.marker_id;

  if new.path not like v_world::text || '/' || new.marker_id::text || '/model-%.glb' then
    raise exception 'the model has to be in the stop''s own folder' using errcode = '22023';
  end if;

  select (o.metadata ->> 'size')::bigint into v_size
    from storage.objects o
   where o.bucket_id = 'marker-media' and o.name = new.path;

  if v_size is null then
    raise exception 'the model file is not uploaded' using errcode = '22023';
  end if;
  if v_size > 52428800 then
    raise exception 'the model is larger than 50 MB' using errcode = '22023';
  end if;

  new.bytes := v_size;
  new.updated_at := now();
  return new;
end;
$$;

commit;
