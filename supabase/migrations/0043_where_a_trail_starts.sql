-- =============================================================================
-- 0043  Where a trail starts
--
-- The website's list of public trails gets a map link and a QR code per trail,
-- and a map link needs a place. public_trails() now also returns the first
-- published stop's position - the same point trails_near measures from.
--
-- The return type changes, so the function is dropped and made again rather
-- than replaced. Nothing else calls it; the grants are restated.
-- =============================================================================

begin;

drop function if exists public.public_trails();

create function public.public_trails()
returns table (
  id           uuid,
  name         text,
  mode         text,
  stop_count   bigint,
  team_count   bigint,
  created_at   timestamptz,
  start_lat    double precision,
  start_lng    double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    w.id, w.name, w.mode,
    (select count(*) from public.markers m
      where m.world_id = w.id and m.status = 'published'),
    (select count(*) from public.teams t where t.world_id = w.id),
    w.created_at,
    s.lat, s.lng
  from public.worlds w
  left join lateral (
    select st_y(m.location::geometry) as lat, st_x(m.location::geometry) as lng
    from public.markers m
    where m.world_id = w.id and m.status = 'published'
    order by m.step nulls last, m.created_at
    limit 1
  ) s on true
  where w.visibility = 'public'
    and w.status = 'published'
  order by w.created_at desc
  limit 100;
$$;

revoke all on function public.public_trails() from public;
grant execute on function public.public_trails() to anon, authenticated;

commit;
