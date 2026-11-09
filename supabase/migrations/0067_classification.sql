-- 0067 - line of work, trail category and city (9 Nov 2026)
--
-- Three small facts that later screens read:
--   * profiles.work   what the person does: broker, teacher, guide or other.
--                     Null means "not asked yet" and is treated as other.
--   * worlds.category what the trail is for: education, tourism, estate, other.
--   * worlds.city     {key, bg, en, lat, lng}, found from the first stop by the
--                     editor; city_auto stays true until a person sets it.
--
-- work is a preference that hides things in the clients, not a permission: no
-- function here refuses anybody because of it.
--
-- The four listing functions keep every column they had and gain category and
-- city as the LAST two, so existing clients that read by name are unaffected.
-- Changing a return type needs drop + create; grants are restored exactly.
-- create_world gains p_category (default null -> 'other'). The old three
-- argument version is dropped so PostgREST sees exactly one overload; calls
-- with p_name/p_mode/p_language keep working.
--
-- Undo (run in one transaction):
--   alter table public.profiles drop column work;
--   drop function public.create_world(text, text, text, text);
--   drop function public.public_trails();  drop function public.trails_near(double precision, double precision, double precision);
--   drop function public.my_worlds();      drop function public.trail_summary(uuid);
--   alter table public.worlds drop column city_auto, drop column city, drop column category;
--   then re-create the six functions from their definitions before 0067:
--   public_trails, trails_near, my_worlds, trail_summary, create_world(3 args)
--   and handle_new_user (full text is in
--   docs/db-cleanup-2026-11-09.md, appendix (d)), and restore
--   their grants (public_trails/trails_near/trail_summary: anon, authenticated,
--   service_role; my_worlds and create_world: authenticated, service_role;
--   handle_new_user: service_role only; nothing to PUBLIC).

begin;

-- --------------------------------------------------------- 1. the columns

alter table public.profiles
  add column work text,
  add constraint profiles_work_check check (work is null or work in ('broker', 'teacher', 'guide', 'other'));

alter table public.worlds
  add column category  text    not null default 'other',
  add column city      jsonb,
  add column city_auto boolean not null default true,
  add constraint worlds_category_check check (category in ('education', 'tourism', 'estate', 'other'));

-- --------------------------------------------------------- 2. sign-up copies work

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- to_jsonb rather than new.is_anonymous directly: the column arrived in a
  -- Supabase update, and reading it through jsonb returns null instead of
  -- failing the whole trigger on a project that predates it.
  -- work comes from the sign-up form; anything but the four known values is
  -- dropped to null rather than failing the sign-up.
  insert into public.profiles (id, is_anonymous, display_name, work)
  values (new.id,
          coalesce((to_jsonb(new) ->> 'is_anonymous')::boolean, false),
          left(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 40),
          case when new.raw_user_meta_data ->> 'work' in ('broker', 'teacher', 'guide', 'other')
               then new.raw_user_meta_data ->> 'work' end)
  on conflict (id) do nothing;

  return new;
end;
$function$;

-- --------------------------------------------------------- 3. create_world

drop function public.create_world(text, text, text);

create function public.create_world(
  p_name     text,
  p_mode     text default 'guide'::text,
  p_language text default 'bg'::text,
  p_category text default null
)
returns public.worlds
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row   public.worlds;
  v_today integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  -- Anyone with an account may create a trail. It starts private and draft, so
  -- an open door here costs nothing until somebody deliberately publishes.
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'making a trail needs a real account' using errcode = '28000';
  end if;

  select count(*) into v_today
  from public.worlds w
  where w.owner_id = auth.uid()
    and w.created_at > now() - interval '1 day';

  if v_today >= 20 then
    raise exception 'that is 20 trails in a day - stopping here in case something is looping'
      using errcode = 'check_violation';
  end if;

  insert into public.worlds
    (owner_id, name, join_code, mode, default_language, visibility, status, category)
  values
    (auth.uid(), trim(p_name), public.new_join_code(), p_mode, p_language,
     'private', 'draft', coalesce(p_category, 'other'))
  returning * into v_row;

  -- The on_world_created trigger from 0002 makes the owner a member.
  return v_row;
end;
$function$;

revoke all on function public.create_world(text, text, text, text) from public;
grant execute on function public.create_world(text, text, text, text) to authenticated, service_role;

-- --------------------------------------------------------- 4. the listings

drop function public.public_trails();

create function public.public_trails()
returns table(id uuid, name text, mode text, stop_count bigint, team_count bigint,
              created_at timestamp with time zone, start_lat double precision, start_lng double precision,
              category text, city jsonb)
language sql
stable security definer
set search_path to 'public', 'extensions'
as $function$
  select
    w.id, w.name, w.mode,
    (select count(*) from public.markers m
      where m.world_id = w.id and m.status = 'published'),
    (select count(*) from public.teams t where t.world_id = w.id),
    w.created_at,
    s.lat, s.lng,
    w.category, w.city
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
    and not public.blocked_between(auth.uid(), w.owner_id)
  order by w.created_at desc
  limit 100;
$function$;

revoke all on function public.public_trails() from public;
grant execute on function public.public_trails() to anon, authenticated, service_role;

drop function public.trails_near(double precision, double precision, double precision);

create function public.trails_near(p_lat double precision, p_lng double precision, p_radius_m double precision default 50000)
returns table(id uuid, name text, mode text, stop_count bigint, distance_m double precision,
              lat double precision, lng double precision,
              category text, city jsonb)
language sql
stable security definer
set search_path to 'public', 'extensions'
as $function$
  select w.id, w.name, w.mode, s.n, s.d, s.lat, s.lng, w.category, w.city
  from public.worlds w
  cross join lateral (
    select count(*) over () as n,
           st_distance(m.location, st_makepoint(p_lng, p_lat)::geography) as d,
           st_y(m.location::geometry) as lat,
           st_x(m.location::geometry) as lng
    from public.markers m
    where m.world_id = w.id and m.status = 'published'
    order by m.step nulls last, m.created_at
    limit 1
  ) s
  where w.visibility = 'public'
    and w.status = 'published'
    and w.ended_at is null
    and s.d <= least(p_radius_m, 500000)
    and not public.blocked_between(auth.uid(), w.owner_id)
  order by s.d
  limit 50;
$function$;

revoke all on function public.trails_near(double precision, double precision, double precision) from public;
grant execute on function public.trails_near(double precision, double precision, double precision) to anon, authenticated, service_role;

drop function public.my_worlds();

create function public.my_worlds()
returns table(id uuid, name text, mode text, status text, visibility text, join_code text, role text,
              marker_count bigint, team_count bigint, pending bigint, review_note text,
              created_at timestamp with time zone,
              category text, city jsonb)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    w.id, w.name, w.mode, w.status, w.visibility, w.join_code, m.role,
    (select count(*) from public.markers k where k.world_id = w.id),
    (select count(*) from public.teams   t where t.world_id = w.id),
    (select count(*)
       from public.marker_submissions s
       join public.markers k2 on k2.id = s.marker_id
      where k2.world_id = w.id and s.verdict = 'pending_review'),
    w.review_note,
    w.created_at,
    w.category, w.city
  from public.worlds w
  join public.world_members m on m.world_id = w.id
  where m.user_id = auth.uid()
    and m.role in ('owner','editor')
  order by w.created_at desc;
$function$;

revoke all on function public.my_worlds() from public;
grant execute on function public.my_worlds() to authenticated, service_role;

drop function public.trail_summary(uuid);

create function public.trail_summary(p_world uuid)
returns table(id uuid, name text, mode text, status text, visibility text, stop_count bigint,
              team_count bigint, total_points bigint, needs_account boolean,
              category text, city jsonb)
language sql
stable security definer
set search_path to 'public'
as $function$
  select
    w.id, w.name, w.mode, w.status, w.visibility,
    (select count(*) from public.markers m
      where m.world_id = w.id and m.status = 'published'),
    (select count(*) from public.teams t where t.world_id = w.id),
    (select coalesce(sum(a.points), 0)
       from public.marker_answers a
       join public.markers m2 on m2.id = a.marker_id
      where m2.world_id = w.id and m2.status = 'published'),
    public.mode_is_scored(w.mode),
    w.category, w.city
  from public.worlds w
  where w.id = p_world
    and (public.world_role(w.id) is not null or public.world_is_open(w.id));
$function$;

revoke all on function public.trail_summary(uuid) from public;
grant execute on function public.trail_summary(uuid) to anon, authenticated, service_role;

commit;
