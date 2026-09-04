-- =============================================================================
-- Stop order — every marker gets a number, and the creator can drag them about
-- =============================================================================
--
-- 0004 added markers.step and left it nullable, meaning "this trail has no
-- order". That was right when nothing set it. It is not right now: a creator
-- placing stops on a map is building a sequence, and a list of stops where the
-- first has a #1 and the rest have a dot is a list that looks broken.
--
-- So step is assigned on creation - the next number in that trail - and
-- reorder_markers rewrites the whole sequence when the creator drags a row.
--
-- What this does NOT do is decide whether a trail is walked in order. That is
-- the mode, and the app now reads it from the mode rather than inferring it from
-- whether any marker happens to carry a step. Freefall trails get numbered stops
-- like everything else and ignore the numbers, which is the same arrangement
-- every other ordered field in this schema has.
--
-- Safe to run twice.
-- =============================================================================

begin;

-- ------------------------------------------------- 1. number what is already there
--
-- Whole trails at a time, not just the gaps in them.
--
-- Filling only the null rows looks tidier and collides. A trail where the
-- creator numbered one stop #1 and left the rest blank - which is exactly what
-- the editor produced, and what sent me here - would number the blanks from a
-- row_number that counts the numbered one too, and hand a second marker the #1
-- that is already taken. So every marker in any trail holding a null gets
-- rewritten to 1..n.
--
-- The existing relative order survives: numbered stops keep their sequence
-- because step sorts first, and the blanks fall in behind them by creation time,
-- which is the order the creator made them in and the only order the data
-- remembers.

with numbered as (
  select
    m.id,
    row_number() over (
      partition by m.world_id
      order by m.step nulls last, m.created_at, m.id
    ) as position
  from public.markers m
  where m.world_id in (
    select world_id from public.markers where step is null
  )
)
update public.markers m
   set step = n.position
  from numbered n
 where m.id = n.id
   and m.step is distinct from n.position;

-- ------------------------------------------------------- 2. and on the way in
--
-- The default stays null in the signature so existing callers - the app, and any
-- half-typed script - keep working; null now means "put it at the end" rather
-- than "leave it unordered". A creator who wants a specific number can still
-- pass one, and reorder_markers will tidy up after them.

-- The signature is 0015's nine-argument one, radius and all. Re-creating the
-- eight-argument version 0012 left behind would not replace this function, it
-- would sit beside it as an overload, and every call naming its arguments would
-- become ambiguous - a function that fails at the call site rather than at the
-- create.

create or replace function public.place_marker(
  p_world      uuid,
  p_lat        double precision,
  p_lng        double precision,
  p_content    jsonb   default '{}'::jsonb,
  p_style_key  text    default 'default',
  p_colour_hex text    default null,
  p_step       integer default null,
  p_status     text    default 'draft',
  p_radius_m   integer default 100
)
returns public.markers
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.markers;
begin
  if not public.may_edit(p_world) then
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
    (world_id, location, content, style_key, colour_hex, step, status, radius_m)
  values
    (p_world, st_makepoint(p_lng, p_lat)::geography, coalesce(p_content, '{}'::jsonb),
     nullif(trim(coalesce(p_style_key, '')), ''), p_colour_hex,
     coalesce(
       p_step,
       (select coalesce(max(k.step), 0) + 1
          from public.markers k
         where k.world_id = p_world)),
     p_status,
     coalesce(p_radius_m, 100))
  returning * into v_row;

  return v_row;
end;
$$;

-- --------------------------------------------------------- 3. dragging a row
--
-- The whole sequence at once, not a swap. A swap needs the client to work out
-- which two rows moved and leaves the trail in a half-sorted state if the second
-- call never lands; sending the order the creator is looking at cannot disagree
-- with itself.
--
-- Ids from another trail are ignored rather than rejected, and markers left out
-- of the list keep their position after the ones named. Neither is a case the
-- editor produces - both are what stops a stale tab from scrambling a trail
-- somebody else has since edited.

create or replace function public.reorder_markers(
  p_world uuid,
  p_ids   uuid[]
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_count integer;
begin
  if not public.may_edit(p_world) then
    raise exception 'not yours to edit' using errcode = '42501';
  end if;

  if p_ids is null or array_length(p_ids, 1) is null then
    return;
  end if;

  -- Numbered from the list, but only where the id really belongs to this trail.
  with wanted as (
    select id, ordinality::integer as position
      from unnest(p_ids) with ordinality as t(id, ordinality)
  )
  update public.markers m
     set step = w.position
    from wanted w
   where m.id = w.id
     and m.world_id = p_world;

  get diagnostics v_count = row_count;

  -- Anything the list did not mention goes after everything it did, keeping the
  -- order it already had. Without this a marker added in another tab would sit
  -- at the same number as one of the reordered rows.
  with rest as (
    select m.id,
           row_number() over (order by m.step nulls last, m.created_at, m.id)
             as position
      from public.markers m
     where m.world_id = p_world
       and not (m.id = any (p_ids))
  )
  update public.markers m
     set step = v_count + r.position
    from rest r
   where m.id = r.id;
end;
$$;

-- ----------------------------------------------------------------- 4. the door
--
-- 0011 closed the default grant to anon and authenticated, so a new function is
-- unreachable until it is named here. place_marker keeps the grants it had.

revoke all on function public.reorder_markers(uuid, uuid[]) from public;
grant execute on function public.reorder_markers(uuid, uuid[]) to authenticated;

comment on function public.reorder_markers(uuid, uuid[]) is
  'Rewrites step 1..n across a trail from the order the ids are given in. '
  'Owner or editor only. Ids from other trails are ignored; markers not named '
  'are placed after the ones that are.';

comment on column public.markers.step is
  'Which stop this is: 1, 2, 3, assigned on creation and rewritten by '
  'reorder_markers. Every marker has one. Whether a trail is WALKED in order is '
  'the world''s mode, not this - Freefall carries steps and ignores them.';

commit;
