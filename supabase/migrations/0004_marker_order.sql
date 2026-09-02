-- =============================================================================
-- Marker order — the sequence the "next stop" strip walks
-- =============================================================================
--
-- The app shows previous / here / next at the bottom of the map. Guided and
-- Capture the flag follow the order the creator set; Freefall has no order and
-- falls back to the nearest marker nobody has opened.
--
-- Until this runs, every marker has no step, so every trail behaves as Freefall.
-- The client needs no change to cope with that - JsonUtility leaves the field at
-- zero when the server does not send it, and zero is exactly the value that means
-- "unordered".
--
-- Safe to run twice.
-- =============================================================================

begin;

alter table public.markers
  add column if not exists step integer;

comment on column public.markers.step is
  'Which stop this is on an ordered trail: 1, 2, 3. Null means the trail has no '
  'order and the app falls back to nearest-unopened. Set by the creator.';

create index if not exists markers_world_step_idx
  on public.markers (world_id, step);

-- ------------------------------------------------- markers_near returns it too
--
-- This has to be dropped rather than replaced. Postgres will not let
-- CREATE OR REPLACE change the output columns of a `returns table` function, and
-- adding step changes them.
--
-- markers_near is the only door to the markers table, so between the drop and the
-- create there is no way in. Inside this transaction that window does not exist
-- for anybody else - which is the whole reason the begin/commit is here and not
-- decoration.

drop function if exists public.markers_near(uuid, double precision, double precision, integer);

create function public.markers_near(
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
  step       integer,
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
    m.step,
    st_distance(m.location, st_makepoint(p_lng, p_lat)::geography) as distance_m
  from public.markers m
  where m.world_id = p_world_id
    and m.status   = 'published'
    and (public.world_role(p_world_id) is not null
         or public.world_is_open(p_world_id))
    and st_dwithin(m.location, st_makepoint(p_lng, p_lat)::geography,
                   least(greatest(p_radius_m, 1), 5000))
  order by distance_m
  limit 100;
$$;

revoke all on function public.markers_near(uuid, double precision, double precision, integer) from public;
grant execute on function public.markers_near(uuid, double precision, double precision, integer) to anon, authenticated;

commit;

-- =============================================================================
-- Ordering the test trail, so the strip has a route to walk. Adjust the names to
-- whatever the markers are actually called.
--
--   update public.markers set step = 1 where id = '...';
--   update public.markers set step = 2 where id = '...';
--   update public.markers set step = 3 where id = '...';
--
-- Verify from outside the dashboard, as a member:
--
--   curl -s "$URL/rest/v1/rpc/markers_near" -H "apikey: $ANON" \
--        -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
--        -d '{"p_world_id":"...","p_lat":42.4841,"p_lng":26.5060,"p_radius_m":500}'
--
-- Every row must now carry a "step". Null is fine and means unordered.
-- =============================================================================
