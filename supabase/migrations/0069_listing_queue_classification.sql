-- 0069 - the review queue knows a trail's category and city (9 Nov 2026)
--
-- Review shows each waiting trail as "Category · City" (no team wording for real
-- estate), so listing_queue() gains category and city as its LAST two columns,
-- the way 0067 did for the public lists. A return type cannot change in place,
-- so drop + create; grants are restored exactly (authenticated, service_role;
-- nothing to public or anon).
--
-- Undo (run in one transaction):
--   drop function public.listing_queue();
--   create function public.listing_queue()
--   returns table(id uuid, name text, mode text, owner_email text, marker_count bigint, created_at timestamp with time zone)
--   language sql stable security definer set search_path to 'public'
--   as $f$
--     select
--       w.id, w.name, w.mode,
--       (select u.email::text from auth.users u where u.id = w.owner_id),
--       (select count(*) from public.markers m
--         where m.world_id = w.id and m.status = 'published'),
--       w.created_at
--     from public.worlds w
--     where w.status = 'submitted'
--       and public.is_admin()
--     order by w.created_at;
--   $f$;
--   revoke all on function public.listing_queue() from public, anon;
--   grant execute on function public.listing_queue() to authenticated, service_role;

begin;

drop function public.listing_queue();

create function public.listing_queue()
returns table(id uuid, name text, mode text, owner_email text, marker_count bigint,
              created_at timestamp with time zone, category text, city jsonb)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    w.id, w.name, w.mode,
    (select u.email::text from auth.users u where u.id = w.owner_id),
    (select count(*) from public.markers m
      where m.world_id = w.id and m.status = 'published'),
    w.created_at,
    w.category, w.city
  from public.worlds w
  where w.status = 'submitted'
    and public.is_admin()
  order by w.created_at;
$function$;

revoke all on function public.listing_queue() from public, anon;
grant execute on function public.listing_queue() to authenticated, service_role;

commit;
