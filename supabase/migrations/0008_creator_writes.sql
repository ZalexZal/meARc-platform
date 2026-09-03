-- =============================================================================
-- Creator writes — the portal's door
-- =============================================================================
--
-- Until this runs, no client can write a marker at all. Phase 0's development
-- policies let the anon key do anything and 0002 removed them, correctly, but
-- put nothing back: every marker in the database so far was inserted from the
-- SQL editor by hand. That is the ceiling the portal exists to remove.
--
-- The rule is the same one the rest of the schema uses. Not "is this person a
-- creator" - there is no such thing - but "what is this person's role in this
-- particular trail", answered by world_role.
--
-- Safe to run twice.
-- =============================================================================

begin;

-- ------------------------------------------------------------- 1. markers
--
-- Owner and editor may write. A viewer - which is what a join code grants - may
-- not, and reads markers only through markers_near like everybody else.

drop policy if exists markers_select_creator on public.markers;
create policy markers_select_creator on public.markers
  for select using (public.world_role(world_id) in ('owner','editor'));

drop policy if exists markers_insert_creator on public.markers;
create policy markers_insert_creator on public.markers
  for insert with check (public.world_role(world_id) in ('owner','editor'));

drop policy if exists markers_update_creator on public.markers;
create policy markers_update_creator on public.markers
  for update using (public.world_role(world_id) in ('owner','editor'))
  with check (public.world_role(world_id) in ('owner','editor'));

drop policy if exists markers_delete_creator on public.markers;
create policy markers_delete_creator on public.markers
  for delete using (public.world_role(world_id) in ('owner','editor'));

-- A note on why the select policy above does not break the seam: a player's
-- role is 'viewer', which fails every one of these, so a player still cannot
-- select markers and still goes through markers_near. The exception is exactly
-- the person who wrote the row, which is not an exception worth calling one.

-- ------------------------------------------------------ 2. placing a marker
--
-- location is geography(Point, 4326) and PostgREST cannot post one directly, so
-- the portal places markers through this rather than through an insert. It also
-- means one place validates the coordinate, instead of every caller.

create or replace function public.place_marker(
  p_world      uuid,
  p_lat        double precision,
  p_lng        double precision,
  p_content    jsonb   default '{}'::jsonb,
  p_style_key  text    default 'default',
  p_colour_hex text    default null,
  p_step       integer default null,
  p_status     text    default 'draft'
)
returns public.markers
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.markers;
begin
  if public.world_role(p_world) not in ('owner','editor') then
    raise exception 'not yours to edit' using errcode = '42501';
  end if;

  -- A marker outside these is a typo - a swapped pair of coordinates, or a
  -- decimal comma read as a thousands separator. Both put the pin in the sea.
  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90
     or p_lng not between -180 and 180 then
    raise exception 'coordinates out of range' using errcode = 'check_violation';
  end if;

  insert into public.markers
    (world_id, location, content, style_key, colour_hex, step, status)
  values
    (p_world,
     st_makepoint(p_lng, p_lat)::geography,
     coalesce(p_content, '{}'::jsonb),
     nullif(trim(coalesce(p_style_key, '')), ''),
     p_colour_hex,
     p_step,
     p_status)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.move_marker(
  p_marker uuid,
  p_lat    double precision,
  p_lng    double precision
)
returns public.markers
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_world uuid;
  v_row   public.markers;
begin
  select m.world_id into v_world from public.markers m where m.id = p_marker;

  if v_world is null or public.world_role(v_world) not in ('owner','editor') then
    raise exception 'not yours to edit' using errcode = '42501';
  end if;

  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'coordinates out of range' using errcode = 'check_violation';
  end if;

  update public.markers
     set location = st_makepoint(p_lng, p_lat)::geography
   where id = p_marker
  returning * into v_row;

  return v_row;
end;
$$;

-- The portal's own read: every marker in a trail you own, in order, with its
-- coordinates as numbers rather than a geography blob PostgREST will not send.
create or replace function public.trail_markers(p_world uuid)
returns table (
  id          uuid,
  lat         double precision,
  lng         double precision,
  style_key   text,
  colour_hex  text,
  content     jsonb,
  step        integer,
  status      text,
  version     integer,
  answer_kind text,
  points      integer,
  updated_at  timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    m.id,
    st_y(m.location::geometry),
    st_x(m.location::geometry),
    m.style_key,
    m.colour_hex,
    m.content,
    m.step,
    m.status,
    m.version,
    a.kind,
    a.points,
    m.updated_at
  from public.markers m
  left join public.marker_answers a on a.marker_id = m.id
  where m.world_id = p_world
    and public.world_role(p_world) in ('owner','editor')
  order by coalesce(m.step, 2147483647), m.created_at;
$$;

revoke all on function public.place_marker(uuid, double precision, double precision, jsonb, text, text, integer, text) from public;
revoke all on function public.move_marker(uuid, double precision, double precision) from public;
revoke all on function public.trail_markers(uuid) from public;

grant execute on function public.place_marker(uuid, double precision, double precision, jsonb, text, text, integer, text) to authenticated;
grant execute on function public.move_marker(uuid, double precision, double precision) to authenticated;
grant execute on function public.trail_markers(uuid) to authenticated;

-- --------------------------------------------------------- 3. making a trail
--
-- worlds_insert_own from 0002 already allows this, but a bare insert leaves the
-- creator to invent a unique join code from the client, which they cannot do
-- without reading the column they are not allowed to read.

create or replace function public.new_join_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_code     text;
  v_tries    integer := 0;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;

    exit when not exists (
      select 1 from public.worlds where upper(join_code) = upper(v_code)
    );

    v_tries := v_tries + 1;
    if v_tries > 50 then
      raise exception 'could not find an unused join code';
    end if;
  end loop;

  return v_code;
end;
$$;

create or replace function public.create_world(
  p_name     text,
  p_mode     text default 'guide',
  p_language text default 'bg'
)
returns public.worlds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.worlds;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  -- Anyone with an account may create a trail. It starts private and draft, so
  -- an open door here costs nothing until somebody deliberately publishes.
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'making a trail needs a real account' using errcode = '28000';
  end if;

  insert into public.worlds
    (owner_id, name, join_code, mode, default_language, visibility, status)
  values
    (auth.uid(), trim(p_name), public.new_join_code(), p_mode, p_language,
     'private', 'draft')
  returning * into v_row;

  -- The on_world_created trigger from 0002 makes the owner a member.
  return v_row;
end;
$$;

create or replace function public.rotate_join_code(p_world uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if public.world_role(p_world) <> 'owner' then
    raise exception 'not yours' using errcode = '42501';
  end if;

  v_code := public.new_join_code();
  update public.worlds set join_code = v_code where id = p_world;

  -- Rotating changes the door, not who is already inside. Anyone who has
  -- joined stays joined, which is what makes this safe to do mid-event.
  return v_code;
end;
$$;

revoke all on function public.new_join_code()                     from public;
revoke all on function public.create_world(text, text, text)      from public;
revoke all on function public.rotate_join_code(uuid)              from public;
grant execute on function public.create_world(text, text, text)   to authenticated;
grant execute on function public.rotate_join_code(uuid)           to authenticated;

-- --------------------------------------------------------------- 4. my trails
--
-- Everything this account owns or edits. Counts come from here rather than from
-- four round trips by the client.

create or replace function public.my_worlds()
returns table (
  id           uuid,
  name         text,
  mode         text,
  status       text,
  visibility   text,
  join_code    text,
  role         text,
  marker_count bigint,
  team_count   bigint,
  pending      bigint,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.id, w.name, w.mode, w.status, w.visibility, w.join_code, m.role,
    (select count(*) from public.markers k where k.world_id = w.id),
    (select count(*) from public.teams   t where t.world_id = w.id),
    (select count(*)
       from public.marker_submissions s
       join public.markers k2 on k2.id = s.marker_id
      where k2.world_id = w.id and s.verdict = 'pending_review'),
    w.created_at
  from public.worlds w
  join public.world_members m on m.world_id = w.id
  where m.user_id = auth.uid()
    and m.role in ('owner','editor')
  order by w.created_at desc;
$$;

revoke all on function public.my_worlds() from public;
grant execute on function public.my_worlds() to authenticated;

-- ---------------------------------------------------------- 5. the review queue

create or replace function public.review_queue(p_world uuid)
returns table (
  submission_id uuid,
  marker_id     uuid,
  marker_title  jsonb,
  team_name     text,
  submitted     text,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.marker_id, m.content, t.name, s.submitted, s.created_at
  from public.marker_submissions s
  join public.markers m on m.id = s.marker_id
  join public.teams   t on t.id = s.team_id
  where m.world_id = p_world
    and s.verdict = 'pending_review'
    and public.world_role(p_world) in ('owner','editor')
  order by s.created_at;
$$;

revoke all on function public.review_queue(uuid) from public;
grant execute on function public.review_queue(uuid) to authenticated;

commit;

-- =============================================================================
-- Still open, deliberately not done here:
--
-- 0002 left a policy called temp_anon_read_published_worlds, marked "PHASE 1
-- ONLY, delete in Phase 3, once the app asks for a join code". The app now does
-- ask for one. Removing it is correct and is also a behaviour change to a build
-- that currently works on a real phone, so it belongs in its own migration with
-- a device test either side of it - not buried at the end of this one.
--
-- Verify from outside the dashboard:
--
--   * insert into markers as a viewer: refused.
--   * place_marker into somebody else's trail: 42501.
--   * trail_markers on a trail you only joined: zero rows.
--   * create_world as an anonymous user: 28000.
--   * my_worlds as somebody who owns nothing: zero rows, not an error.
-- =============================================================================
