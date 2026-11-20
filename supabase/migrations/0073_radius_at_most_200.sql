-- 0073 - a stop's radius is at most 200 m (20 Nov 2026)
--
-- Applied to the live database on 20 Nov 2026.
--
-- markers.radius_m is how close a walker must be for the stop to open. 0014
-- allowed 5 to 2000 m; a circle that wide covers whole neighbourhoods, swallows
-- the neighbouring stops and lets a walker "reach" a stop from far away. The
-- builder now offers 5 to 200 m, and this makes the database agree.
--
-- Live check before writing this: all 55 markers are between 25 and 200 m, so
-- the new check applies cleanly. place_marker() defaults to 100, inside range.
-- The p_radius_m arguments of markers_near / trails_near (default 500 / 50000)
-- are a search radius, a different thing, and are not touched.
--
-- Safe to run twice.
--
-- Undo (run in one transaction):
--   alter table public.markers drop constraint if exists markers_radius_m_check;
--   alter table public.markers add constraint markers_radius_m_check
--     check (radius_m >= 5 and radius_m <= 2000);

begin;

alter table public.markers drop constraint if exists markers_radius_m_check;

alter table public.markers add constraint markers_radius_m_check
  check (radius_m between 5 and 200);

comment on column public.markers.radius_m is
  'How close a walker must be for this stop to open, 5 to 200 m. The circles '
  'of two neighbouring stops should not overlap, or standing between them '
  'opens both.';

commit;
