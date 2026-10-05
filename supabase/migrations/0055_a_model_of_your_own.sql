-- 0055 - a model of your own
--
-- A creator can stand their own 3D model at a stop: a statue, an artefact, a
-- character, uploaded as a .glb from Blender or Sketchfab the way a photo is
-- uploaded today. Design: docs/superpowers/specs/2026-10-01-own-3d-models-design.md.
--
-- What this adds:
--   - 'model' as a sixth shape, after pin, sphere, cone, cube and sign;
--   - marker_models, one row per model stop: where the file is, how tall it
--     stands, which way it faces, whether it moves, and whose it is;
--   - a check on every row that the file is really there, in the stop's own
--     folder, and no larger than 25 MB, whatever the browser said;
--   - the bucket accepting model/gltf-binary;
--   - trail_models(), which the app asks on joining a trail, with exactly the
--     visibility markers_near has.
--
-- The files live in the same bucket and folders as photos, so they count
-- against the trail's 200 MB, and the existing removal path (media_paths, 0026)
-- already takes them with the stop, the trail and the account.
--
-- Safe to run twice.

begin;

-- ------------------------------------------------------------- a sixth shape
alter table public.markers drop constraint if exists markers_style_key_known;
alter table public.markers add constraint markers_style_key_known
  check (style_key is null or style_key in ('default', 'pin', 'sphere', 'cone', 'cube', 'sign', 'model'));

-- ------------------------------------------------------------------ the model
create table if not exists public.marker_models (
  marker_id      uuid primary key references public.markers(id) on delete cascade,
  -- <trail>/<stop>/model-<uuid>.glb in the marker-media bucket.
  path           text not null,
  -- Set by the check below from the stored object, not taken from the browser.
  bytes          bigint not null default 0,
  triangles      integer not null check (triangles between 1 and 300000),
  height_m       real not null check (height_m between 0.2 and 10),
  -- Degrees from true north, the way the model's front faces.
  heading_deg    smallint not null default 0 check (heading_deg between 0 and 359),
  animated       boolean not null default false,
  -- 'own': the creator made it. 'other': somebody else did, and the credit
  -- their licence asks for is shown on the stop.
  credit_source  text not null check (credit_source in ('own', 'other')),
  credit_author  text check (credit_author is null or char_length(btrim(credit_author)) between 1 and 120),
  credit_licence text check (credit_licence is null or char_length(btrim(credit_licence)) between 1 and 60),
  credit_link    text check (credit_link is null or (credit_link ~ '^https://' and char_length(credit_link) <= 300)),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint marker_models_credit_given check (
    credit_source = 'own'
    or (credit_author is not null and credit_licence is not null and credit_link is not null))
);

comment on table public.marker_models is
  'A creator''s own 3D model standing at a stop (style_key = ''model'').';

alter table public.marker_models enable row level security;

-- Read like a stop's photos: by a member of the trail, or by anyone when the
-- trail is open. Written by whoever may edit the trail.
drop policy if exists models_select_member on public.marker_models;
create policy models_select_member on public.marker_models
  for select using (
    exists (select 1 from public.markers m
            where m.id = marker_models.marker_id
              and (public.world_role(m.world_id) is not null
                   or public.world_is_open(m.world_id)))
  );

drop policy if exists models_write_creator on public.marker_models;
create policy models_write_creator on public.marker_models
  for all using (
    exists (select 1 from public.markers m
            where m.id = marker_models.marker_id and public.may_edit(m.world_id))
  ) with check (
    exists (select 1 from public.markers m
            where m.id = marker_models.marker_id and public.may_edit(m.world_id))
  );

grant select on public.marker_models to anon, authenticated;
grant insert, update, delete on public.marker_models to authenticated;

-- The file is really there, in this stop's own folder, and no larger than
-- 25 MB. The browser checks all of this first; this is the check a browser
-- cannot skip.
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
  if v_size > 26214400 then
    raise exception 'the model is larger than 25 MB' using errcode = '22023';
  end if;

  new.bytes := v_size;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists marker_models_check_trg on public.marker_models;
create trigger marker_models_check_trg
  before insert or update on public.marker_models
  for each row execute function public.marker_models_check();

-- -------------------------------------------------------------- the bucket
update storage.buckets
   set allowed_mime_types = array[
         -- pictures
         'image/jpeg', 'image/png', 'image/webp', 'image/avif',
         'image/gif', 'image/heic', 'image/heif',
         -- recordings
         'audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav', 'audio/x-wav',
         'audio/wave', 'audio/webm', 'audio/aac', 'audio/x-m4a', 'audio/flac',
         -- clips
         'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
         -- models
         'model/gltf-binary']
 where id = 'marker-media';

-- ------------------------------------------------------------- for the app
-- Every model stop of a trail the caller may see, with exactly the visibility
-- markers_near has: published, or draft for the people who make the trail, and
-- on a trail that reveals one stop at a time, nothing beyond the next one. A
-- platform reviewer sees every model of a trail, to check content and licence
-- before it is listed. updated_at is the phone's cache key: a replaced model is
-- a new file to fetch.
create or replace function public.trail_models(p_world uuid)
returns table (marker_id uuid, path text, bytes bigint, updated_at timestamptz,
               height_m real, heading_deg smallint, animated boolean,
               credit_source text, credit_author text, credit_licence text, credit_link text)
language sql
stable
security definer
set search_path = public
as $$
  select mm.marker_id, mm.path, mm.bytes, mm.updated_at,
         mm.height_m, mm.heading_deg, mm.animated,
         mm.credit_source, mm.credit_author, mm.credit_licence, mm.credit_link
  from public.marker_models mm
  join public.markers m on m.id = mm.marker_id
  where m.world_id = p_world
    and m.style_key = 'model'
    and (public.is_admin() or (
         (m.status = 'published'
         or (m.status = 'draft' and public.world_role(p_world) in ('owner', 'editor')))
    and (public.world_role(p_world) is not null
         or public.world_is_open(p_world))
    and (
      public.world_role(p_world) in ('owner', 'editor')
      or not public.world_reveals_one_at_a_time(p_world)
      or m.step is null
      or m.step <= 0
      or m.step <= public.next_step_for(p_world)
    )))
  order by m.step nulls last;
$$;

revoke all on function public.trail_models(uuid) from public;
grant execute on function public.trail_models(uuid) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
