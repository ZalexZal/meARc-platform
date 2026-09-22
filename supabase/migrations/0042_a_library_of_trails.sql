-- =============================================================================
-- 0042  A library of trails
--
-- 0041 closed the worlds table to strangers and said how a directory should
-- come back if one was ever wanted: a security definer function returning only
-- what a stranger may see, never join_code. These are those functions.
--
--   trails_near(lat, lng, radius)  public, published trails whose first stop is
--                                  within radius, nearest first. Anon-callable.
--   join_listed(world)             joins a trail by id, but only a listed one -
--                                  the code stays the door for everything else.
--
-- Also: a wrong answer now waits 15 seconds by default instead of 60. A minute
-- read as a punishment in the field; 15 s still stops guessing every option.
-- =============================================================================

begin;

create or replace function public.trails_near(
  p_lat      double precision,
  p_lng      double precision,
  p_radius_m double precision default 50000
)
returns table (
  id          uuid,
  name        text,
  mode        text,
  stop_count  bigint,
  distance_m  double precision,
  lat         double precision,
  lng         double precision
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select w.id, w.name, w.mode, s.n, s.d, s.lat, s.lng
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
  order by s.d
  limit 50;
$$;

revoke all on function public.trails_near(double precision, double precision, double precision) from public;
grant execute on function public.trails_near(double precision, double precision, double precision) to anon, authenticated;

create or replace function public.join_listed(p_world uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  if not exists (select 1 from public.worlds w
                 where w.id = p_world and w.visibility = 'public'
                   and w.status = 'published' and w.ended_at is null) then
    raise exception 'not a listed trail' using errcode = 'P0001';
  end if;

  insert into public.world_members (world_id, user_id, role)
  values (p_world, auth.uid(), 'viewer')
  on conflict (world_id, user_id) do nothing;

  return p_world;
end;
$$;

revoke all on function public.join_listed(uuid) from public;
grant execute on function public.join_listed(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.set_marker_answer(p_marker uuid, p_kind text, p_accepted text[] DEFAULT NULL::text[], p_correct_choices integer[] DEFAULT NULL::integer[], p_points integer DEFAULT 10, p_cooldown_seconds integer DEFAULT NULL::integer, p_after_text jsonb DEFAULT '{}'::jsonb, p_on_wrong text DEFAULT 'retry'::text, p_deduct_points integer DEFAULT 0)
 RETURNS marker_answers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_world uuid;
  v_row   public.marker_answers;
  v_cool  integer;
begin
  select m.world_id into v_world from public.markers m where m.id = p_marker;

  if v_world is null or not public.may_edit(v_world) then
    raise exception 'not yours to edit' using errcode = '42501';
  end if;

  -- A minute on a checked question, nothing on a written one: a human is
  -- deciding there anyway, so a cooldown would only punish spelling.
  v_cool := coalesce(p_cooldown_seconds, case when p_kind = 'free' then 0 else 15 end);

  -- "lock" is the rule that means the cooldown is the point, so a lock of zero
  -- is a contradiction the creator did not intend.
  if p_on_wrong = 'lock' and v_cool <= 0 then
    v_cool := 15;
  end if;

  insert into public.marker_answers as a
    (marker_id, kind, accepted, correct_choices, points, cooldown_seconds,
     after_text, on_wrong, deduct_points)
  values
    (p_marker, p_kind,
     coalesce(p_accepted, '{}'),
     coalesce(p_correct_choices, '{}'),
     p_points,
     v_cool,
     coalesce(p_after_text, '{}'::jsonb),
     coalesce(nullif(trim(coalesce(p_on_wrong, '')), ''), 'retry'),
     greatest(coalesce(p_deduct_points, 0), 0))
  on conflict (marker_id) do update
    set kind             = excluded.kind,
        accepted         = excluded.accepted,
        correct_choices  = excluded.correct_choices,
        points           = excluded.points,
        cooldown_seconds = excluded.cooldown_seconds,
        after_text       = excluded.after_text,
        on_wrong         = excluded.on_wrong,
        deduct_points    = excluded.deduct_points,
        updated_at       = now()
  returning * into v_row;

  return v_row;
end;
$function$
;

commit;
