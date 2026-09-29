-- 0054  Shapes in the street, and stops placed where they stand
--
-- Shapes. markers.style_key has existed since 0001 and every stop says
-- 'default'. The app has always had a slot for a prefab per key and nothing
-- ever filled it. Now there are five: the pin, a sphere, a cone, a cube and a
-- sign - a board with words on it, which is what "a canvas people can type on"
-- means in a street. The key is checked here, so a typo in any client is a
-- refusal rather than a stop that silently falls back to the pin; the list
-- widens when creators' own models arrive.
--
-- A sign's words are content.<lang>.sign, translated like the title, at most
-- 80 characters - a sign is read from across a street, not studied.
--
-- Capture mode. A creator standing in the street can now make a stop there,
-- in the app, as a draft. markers_near sent published stops only, to everybody,
-- so a draft made on site could not be seen even by the person who had just
-- made it. The trail's owner and editors now get drafts too; walkers never do.
-- It also says which is which (status), which is a new output column, so the
-- function is dropped and recreated in one transaction - it is the only door
-- the app has to the markers, and there is no moment without it.
--
-- Safe to run twice.

begin;

alter table public.markers drop constraint if exists markers_style_key_known;
alter table public.markers add constraint markers_style_key_known
  check (style_key is null or style_key in ('default', 'pin', 'sphere', 'cone', 'cube', 'sign'));

alter table public.markers drop constraint if exists markers_sign_short;
alter table public.markers add constraint markers_sign_short
  check (char_length(coalesce(content -> 'bg' ->> 'sign', '')) <= 80
     and char_length(coalesce(content -> 'en' ->> 'sign', '')) <= 80);

drop function if exists public.markers_near(uuid, double precision, double precision, integer);

create function public.markers_near(p_world_id uuid, p_lat double precision, p_lng double precision,
                                    p_radius_m integer default 500)
returns table (id uuid, lat double precision, lng double precision, style_key text,
               colour_hex text, content jsonb, version integer, step integer,
               radius_m integer, distance_m double precision, status text)
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
    m.radius_m,
    st_distance(m.location, st_makepoint(p_lng, p_lat)::geography) as distance_m,
    m.status
  from public.markers m
  where m.world_id = p_world_id
    -- Drafts to the people building the trail, and to nobody else.
    and (m.status = 'published'
         or (m.status = 'draft' and public.world_role(p_world_id) in ('owner', 'editor')))
    and (public.world_role(p_world_id) is not null
         or public.world_is_open(p_world_id))
    and st_dwithin(m.location, st_makepoint(p_lng, p_lat)::geography,
                   least(greatest(p_radius_m, 1), 5000))
    -- One at a time, when the trail says so.
    --
    -- Not drawn by the app: not sent. A walker who has not reached marker four
    -- has not earned its coordinates, and an app that receives them and chooses
    -- not to draw them is one request away from giving the route away.
    --
    -- The creator of the trail is exempt, or they could not build it.
    and (
      public.world_role(p_world_id) in ('owner', 'editor')
      or not public.world_reveals_one_at_a_time(p_world_id)
      or m.step is null
      or m.step <= 0
      or m.step <= public.next_step_for(p_world_id)
    )
  order by distance_m
  limit 100;
$$;

revoke all on function public.markers_near(uuid, double precision, double precision, integer) from public;
grant execute on function public.markers_near(uuid, double precision, double precision, integer)
  to anon, authenticated;

-- The shape, changed from the street. Capture mode cycles through the shapes
-- while the creator watches the marker change in the camera; this is the one
-- door that writes it, with the same check move_marker makes.
create or replace function public.set_marker_shape(p_marker uuid, p_style_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world uuid;
begin
  select m.world_id into v_world from public.markers m where m.id = p_marker;

  if v_world is null or not public.may_edit(v_world) then
    raise exception 'not yours to edit' using errcode = '42501';
  end if;

  update public.markers
     set style_key = nullif(btrim(coalesce(p_style_key, '')), '')
   where id = p_marker;
end;
$$;

revoke all on function public.set_marker_shape(uuid, text) from public, anon;
grant execute on function public.set_marker_shape(uuid, text) to authenticated;

commit;

notify pgrst, 'reload schema';
