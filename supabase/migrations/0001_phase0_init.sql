-- Phase 0: backend skeleton. One marker, end to end.
-- Handbook §4 (the RPC seam), §6 (data model), §14 (Phase 0).
--
-- Scope: only what Phase 0 needs. profiles / world_members / marker_styles /
-- reports arrive in Phase 1 with auth. The shapes here are the §6 shapes so
-- Phase 1 extends rather than rewrites.
--
-- Run in the Supabase SQL editor, top to bottom, once.

-- ---------------------------------------------------------------- extensions
create extension if not exists postgis;

-- -------------------------------------------------------------------- worlds
create table if not exists public.worlds (
  id               uuid primary key default gen_random_uuid(),
  -- owner_id gets its FK to profiles in Phase 1; nullable now because
  -- Phase 0 has no auth and the throwaway page inserts anonymously.
  owner_id         uuid,
  name             text        not null check (length(trim(name)) > 0),
  join_code        text        unique not null,
  visibility       text        not null default 'private'
                     check (visibility in ('private','unlisted','public')),
  mode             text        not null default 'guide'
                     check (mode in ('guide','educational','ctf')),
  rules            jsonb       not null default '{}'::jsonb,
  status           text        not null default 'draft'
                     check (status in ('draft','published','submitted','archived')),
  default_language text        not null default 'en',
  created_at       timestamptz not null default now()
);

-- ------------------------------------------------------------------- markers
create table if not exists public.markers (
  id          uuid primary key default gen_random_uuid(),
  world_id    uuid not null references public.worlds(id) on delete cascade,
  -- geography, not geometry: metres out of ST_DWithin without picking a UTM zone.
  -- No altitude, ever. ARCore resolves height against real ground (§8, §9).
  location    geography(Point, 4326) not null,
  style_key   text,
  colour_hex  text check (colour_hex is null or colour_hex ~ '^#[0-9A-Fa-f]{6}$'),
  content     jsonb       not null default '{}'::jsonb,
  status      text        not null default 'draft'
                check (status in ('draft','published')),
  version     integer     not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- The index that makes "everything within 500 m" one indexed lookup (§6).
create index if not exists markers_location_gix on public.markers using gist (location);
create index if not exists markers_world_id_idx on public.markers (world_id);

-- version is an optimistic lock (§6): bump it on every write so a stale
-- editor's `where version = $n` matches zero rows.
create or replace function public.markers_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if new.version = old.version then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists markers_touch_trg on public.markers;
create trigger markers_touch_trg before update on public.markers
  for each row execute function public.markers_touch();

-- ---------------------------------------------------------------- the RPC seam
-- §4: the app NEVER selects from markers. It calls this. In v1 the body returns
-- everything published inside the radius; CTF unlock filtering later is a change
-- to this function body and nothing else.
--
-- SECURITY DEFINER on purpose: this function is the only authorised reader, so
-- table RLS can stay shut to clients while this stays open.
create or replace function public.markers_near(
  p_world_id uuid,
  p_lat      double precision,
  p_lng      double precision,
  p_radius_m integer default 500
)
returns table (
  id         uuid,
  lat        double precision,
  lng        double precision,
  style_key  text,
  colour_hex text,
  content    jsonb,
  version    integer,
  distance_m double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    m.id,
    st_y(m.location::geometry) as lat,
    st_x(m.location::geometry) as lng,
    m.style_key,
    m.colour_hex,
    m.content,
    m.version,
    st_distance(m.location, st_makepoint(p_lng, p_lat)::geography) as distance_m
  from public.markers m
  where m.world_id = p_world_id
    and m.status   = 'published'
    and st_dwithin(m.location, st_makepoint(p_lng, p_lat)::geography,
                   least(greatest(p_radius_m, 1), 5000))
  order by distance_m
  limit 100;   -- app spawns at most 20 (§8); this is a sanity ceiling, not the cap
$$;

revoke all on function public.markers_near(uuid, double precision, double precision, integer) from public;
grant execute on function public.markers_near(uuid, double precision, double precision, integer) to anon, authenticated;

-- ----------------------------------------------------------------------- RLS
alter table public.worlds  enable row level security;
alter table public.markers enable row level security;

-- Phase 0 only. Both policies below are DEV SCAFFOLDING and must be dropped in
-- Phase 1 when auth and world_members land. They exist so a throwaway page with
-- only the anon key can create one world and one marker.
--   drop policy "phase0_dev_anon_all_worlds"  on public.worlds;
--   drop policy "phase0_dev_anon_all_markers" on public.markers;
drop policy if exists "phase0_dev_anon_all_worlds" on public.worlds;
create policy "phase0_dev_anon_all_worlds" on public.worlds
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "phase0_dev_anon_all_markers" on public.markers;
create policy "phase0_dev_anon_all_markers" on public.markers
  for all to anon, authenticated using (true) with check (true);

-- ------------------------------------------------------------------ join code
-- Ambiguity-free alphabet (§6): no 0/O, no 1/I/L.
create or replace function public.generate_join_code(p_len integer default 6)
returns text language plpgsql as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  result text := '';
  i integer;
begin
  for i in 1..p_len loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;
