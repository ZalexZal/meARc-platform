-- =============================================================================
-- marker_detail — the one door the app reads a stop's contents through
-- =============================================================================
--
-- The two halves of this project were built to different contracts and have
-- never once agreed.
--
--   The app reads content.media[] and content.task{} out of the marker's jsonb.
--   That is what MARKER-CONTENT.md specifies and what RemoteMarkerSource parses.
--
--   The website writes rows: marker_media for uploads, set_marker_answer into
--   marker_answers for questions, marker_hints for hints. It has never written
--   content.media or content.task, and the app has never called any of those
--   tables.
--
-- So a creator attaches a video and a question, and the phone shows neither.
-- Not a bug in either half - they pass each other.
--
-- The tables win, and the app learns to read them. Mirroring into content would
-- duplicate state that drifts the first time somebody edits one side, and it
-- would ship every question in a trail to every phone in radius, which is the
-- leak marker_answers exists to prevent. So markers_near keeps carrying only
-- what is needed to DRAW a marker, and the contents arrive when a stop is
-- actually opened.
--
-- Safe to run twice.
-- =============================================================================

begin;

-- ------------------------------------------------ 1. markers_near sends radius
--
-- 0014 gave every marker a radius the creator sets in the builder, and nothing
-- ever sent it to the phone: markers_near still returns 0004's column list. It
-- is the number that decides whether somebody is actually standing at a stop, so
-- without it the app cannot tell arriving from browsing.
--
-- Dropped rather than replaced. Postgres will not let CREATE OR REPLACE change
-- the output columns of a `returns table` function, and adding one changes them.
-- markers_near is the only door to the markers table, so between the drop and
-- the create there is no way in - which is why this file is one transaction and
-- not a courtesy.

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
  radius_m   integer,
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
    m.radius_m,
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

revoke all on function public.markers_near(uuid, double precision, double precision, integer)
  from public;
grant execute on function public.markers_near(uuid, double precision, double precision, integer)
  to anon, authenticated;

-- ------------------------------------------------------------ 2. the contents
--
-- Everything a phone needs once a stop is open, in one call: the media, the
-- question as a question, and the hints with their reveal state.
--
-- What it deliberately does not return is any part of the answer - not
-- `accepted`, not `correct_choices`. The options travel because they have to be
-- displayed; which of them is right is compared inside check_answer and never
-- leaves the database. A client holding this reply knows exactly what a person
-- standing at the marker knows.
--
-- Shaped for JsonUtility, which the app parses with: fixed keys, no maps with
-- arbitrary keys, and arrays rather than objects keyed by id.

create or replace function public.marker_detail(p_marker uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_world   uuid;
  v_content jsonb;
  v_answer  public.marker_answers;
  v_media   jsonb;
  v_hints   jsonb;
  v_task    jsonb;
begin
  select m.world_id, m.content
    into v_world, v_content
  from public.markers m
  where m.id = p_marker
    and m.status = 'published';

  -- No such marker, or one this caller may not see. Both answer the same way, so
  -- a stranger cannot map which ids are real by watching the errors - the same
  -- rule check_answer follows.
  if v_world is null
     or not (public.world_role(v_world) is not null
             or public.world_is_open(v_world)) then
    return jsonb_build_object('media', '[]'::jsonb, 'hints', '[]'::jsonb);
  end if;

  -- ---------------------------------------------------------------- media
  --
  -- The bucket is public, so a path is enough and the phone needs no signed URL
  -- per file - a round trip per image on a street connection is a real cost. A
  -- 'link' row already holds a whole URL and is passed through untouched.

  select coalesce(jsonb_agg(
           jsonb_build_object(
             'kind', d.kind,
             'path', d.path,
             'ord',  d.ord
           ) order by d.ord, d.created_at
         ), '[]'::jsonb)
    into v_media
  from public.marker_media d
  where d.marker_id = p_marker;

  -- ---------------------------------------------------------------- hints
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'id',       h.id,
             'ord',      h.ord,
             'cost',     h.cost,
             'revealed', exists (
               select 1 from public.hint_reveals r
               where r.hint_id = h.id
                 and r.team_id = public.my_team(v_world)
             ),
             -- The text itself only once it has been paid for. A hint that
             -- travels unrevealed is a hint that cost nothing.
             'body', case
               when exists (
                 select 1 from public.hint_reveals r
                 where r.hint_id = h.id
                   and r.team_id = public.my_team(v_world)
               ) then h.body
               else null
             end
           ) order by h.ord
         ), '[]'::jsonb)
    into v_hints
  from public.marker_hints h
  where h.marker_id = p_marker;

  -- ----------------------------------------------------------------- task
  select * into v_answer from public.marker_answers where marker_id = p_marker;

  if v_answer.marker_id is not null then
    v_task := jsonb_build_object(
      'kind',             v_answer.kind,
      'points',           v_answer.points,
      'cooldown_seconds', v_answer.cooldown_seconds,
      -- The question, per language. It lives in content beside the title and
      -- body because it is writing, and writing is localised here.
      'prompt', jsonb_build_object(
        'bg', v_content -> 'bg' ->> 'question',
        'en', v_content -> 'en' ->> 'question'
      ),
      'after', v_answer.after_text
    );

    -- Options ship for a choice question and for nothing else. They are the
    -- question, not the answer: which index is right is in correct_choices,
    -- which is not in this reply and is not selectable by anyone.
    if v_answer.kind = 'choice' then
      v_task := v_task || jsonb_build_object(
        -- Paired by position, with Bulgarian as the spine: it is the language
        -- the creator is made to fill in, so a trail with no English still has
        -- a complete set of options rather than a list of blanks.
        'options', coalesce((
          select jsonb_agg(
                   jsonb_build_object(
                     'bg', bg.value,
                     'en', coalesce(
                             v_content -> 'en' -> 'choices' ->> (bg.ordinality::int - 1),
                             bg.value)
                   ) order by bg.ordinality)
            from jsonb_array_elements_text(
                   coalesce(v_content -> 'bg' -> 'choices', '[]'::jsonb)
                 ) with ordinality as bg(value, ordinality)
        ), '[]'::jsonb)
      );
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'media', v_media,
    'hints', v_hints,
    'task',  v_task
  ));
end;
$$;

-- 0011 closed the default grant, so a new function is unreachable until named.
-- anon gets it too: an anonymous walker is a real user with a real uid, and an
-- open trail is meant to be walkable before anybody signs up.
revoke all on function public.marker_detail(uuid) from public;
grant execute on function public.marker_detail(uuid) to anon, authenticated;

comment on function public.marker_detail(uuid) is
  'Everything a phone needs once a stop is opened: media, hints with their '
  'reveal state, and the question WITHOUT any part of its answer. The one door '
  'the app reads a marker''s contents through.';

commit;
