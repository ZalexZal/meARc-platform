-- =============================================================================
-- Moderation — a way to say "this should not be there", and a way to act on it
-- =============================================================================
--
-- Handbook §10 lists seven things as the minimum surface for v1. This is four of
-- them: a report button on every marker and every trail, an inbox for the
-- reviewer, the power to remove either, and rate limits. Block-user, the admin
-- map with delete-by-area, and the geographic blocklist come after.
--
-- The abuse this exists for is specific and worth restating: somebody will
-- eventually place a marker at a school, a hospital, a private house or a
-- memorial. The offence is the LOCATION, not the words, so nothing that reads
-- text can catch it. A person has to be told, and a person has to be able to
-- remove it in one action.
--
-- --- rate limits need a creator, and markers had none
--
-- "Markers per user per day" was unimplementable: markers records which trail it
-- belongs to and not who placed it. That column is added here, which also makes
-- "who put this here" answerable when a report arrives - the question a reviewer
-- asks first and could not previously ask at all.
--
-- --- and account deletion becomes a choice
--
-- worlds.owner_id cascades from profiles, so deleting an account has always
-- deleted every trail that account owned, taking every other walker's history
-- with it. Now the person is asked. Keeping a trail detaches it: no owner, not
-- editable by anybody, and off the public list, because an unowned public trail
-- is one nobody can answer a report about - which is the thing this file exists
-- to prevent.
--
-- Safe to run twice.
-- =============================================================================

begin;

-- ----------------------------------------------------------- 1. who placed it

alter table public.markers
  add column if not exists created_by uuid references public.profiles(id) on delete set null;

create index if not exists markers_created_by_idx on public.markers (created_by, created_at);

comment on column public.markers.created_by is
  'Who placed this. Null for anything predating the column. Answers the first '
  'question a reviewer asks, and is what makes a per-person rate limit possible.';

-- ------------------------------------------------------------- 2. the reports

create table if not exists public.reports (
  id          uuid primary key default gen_random_uuid(),

  -- A report is about a marker or about a whole trail, never both, and it has
  -- to outlive whichever one it was about: the first thing a removal does is
  -- destroy the evidence for it, and a moderation record that vanishes when the
  -- moderator acts is not a record. So these go null on delete, and the snapshot
  -- below is what is left to read afterwards.
  marker_id   uuid references public.markers(id) on delete set null,
  world_id    uuid references public.worlds(id)  on delete set null,

  -- Which kind of thing this was, kept because both ids above may be null once
  -- it is gone.
  target_kind text not null default 'marker',

  -- What it was, at the moment it was reported. Denormalised on purpose: the
  -- point of an audit trail is that it still says something after the row it
  -- pointed at has been deleted.
  target_title text,
  target_trail text,
  target_lat   double precision,
  target_lng   double precision,

  reporter_id uuid references public.profiles(id) on delete set null,

  reason      text not null,
  detail      text,

  state       text not null default 'open',
  handled_by  uuid references public.profiles(id) on delete set null,
  handled_at  timestamptz,
  note        text,

  created_at  timestamptz not null default now()
);

alter table public.reports drop constraint if exists reports_one_target;
alter table public.reports
  -- At most one, not exactly one. Zero is the state after the thing was removed.
  add constraint reports_one_target check (num_nonnulls(marker_id, world_id) <= 1);

-- The columns first, then the constraint that reads them. A table created by
-- the first version of this file has none of these, and `create table if not
-- exists` above will not have added them.
alter table public.reports
  add column if not exists target_kind  text not null default 'marker',
  add column if not exists target_title text,
  add column if not exists target_trail text,
  add column if not exists target_lat   double precision,
  add column if not exists target_lng   double precision;

alter table public.reports drop constraint if exists reports_target_kind;
alter table public.reports
  add constraint reports_target_kind check (target_kind in ('marker','trail'));

alter table public.reports drop constraint if exists reports_reason;
alter table public.reports
  add constraint reports_reason
  check (reason in ('private_property','unsafe','offensive','wrong_place','spam','other'));

alter table public.reports drop constraint if exists reports_state;
alter table public.reports
  add constraint reports_state check (state in ('open','actioned','dismissed'));

-- A table created by the first version of this file keeps its old cascading
-- keys: `create table if not exists` does not revisit them. Re-pointed here, or
-- the very first removal would take its own audit trail with it.
alter table public.reports drop constraint if exists reports_marker_id_fkey;
alter table public.reports
  add constraint reports_marker_id_fkey
  foreign key (marker_id) references public.markers(id) on delete set null;

alter table public.reports drop constraint if exists reports_world_id_fkey;
alter table public.reports
  add constraint reports_world_id_fkey
  foreign key (world_id) references public.worlds(id) on delete set null;

create index if not exists reports_open_idx on public.reports (state, created_at);

-- RLS on with no policies: nothing reaches this table through the API in either
-- direction. Every path in and out is a SECURITY DEFINER function below, which
-- is what keeps one reporter from reading another's report - or from counting
-- how many reports a trail has collected.
alter table public.reports enable row level security;

-- --------------------------------------------------------- 3. making a report
--
-- Open to anyone who can see the thing, anonymous walkers included. Somebody
-- standing in front of a marker at a school is exactly who needs this, and
-- making them sign up first is making them give up.

create or replace function public.report_marker(
  p_marker uuid,
  p_reason text,
  p_detail text default null
)
returns uuid
language plpgsql
security definer
-- extensions too: the snapshot reads the marker's coordinates, and the geometry
-- cast that needs lives there rather than in public.
set search_path = public, extensions
as $$
declare
  v_world uuid;
  v_id    uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select m.world_id into v_world
  from public.markers m
  where m.id = p_marker;

  -- Reportable only if the reporter could see it in the first place. Otherwise
  -- this is a way to probe which marker ids exist.
  if v_world is null
     or not (public.world_role(v_world) is not null or public.world_is_open(v_world)) then
    raise exception 'no such marker' using errcode = 'no_data_found';
  end if;

  -- One open report per person per marker. A second press is not a second
  -- problem, and a queue with the same thing in it forty times is a queue
  -- nobody reads.
  select id into v_id
  from public.reports
  where marker_id = p_marker and reporter_id = auth.uid() and state = 'open';

  if v_id is not null then
    return v_id;
  end if;

  insert into public.reports
    (marker_id, reporter_id, reason, detail,
     target_kind, target_title, target_trail, target_lat, target_lng)
  select
    p_marker, auth.uid(), p_reason, nullif(trim(coalesce(p_detail, '')), ''),
    'marker',
    coalesce(m.content -> 'bg' ->> 'title', m.content -> 'en' ->> 'title'),
    w.name,
    st_y(m.location::geometry),
    st_x(m.location::geometry)
  from public.markers m
  join public.worlds w on w.id = m.world_id
  where m.id = p_marker
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.report_world(
  p_world  uuid,
  p_reason text,
  p_detail text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  if not (public.world_role(p_world) is not null or public.world_is_open(p_world)) then
    raise exception 'no such trail' using errcode = 'no_data_found';
  end if;

  select id into v_id
  from public.reports
  where world_id = p_world and reporter_id = auth.uid() and state = 'open';

  if v_id is not null then
    return v_id;
  end if;

  insert into public.reports
    (world_id, reporter_id, reason, detail, target_kind, target_trail)
  select p_world, auth.uid(), p_reason, nullif(trim(coalesce(p_detail, '')), ''),
         'trail', w.name
  from public.worlds w where w.id = p_world
  returning id into v_id;

  return v_id;
end;
$$;

-- ------------------------------------------------------------- 4. the inbox

-- Dropped rather than replaced: this gained a column, and CREATE OR REPLACE
-- cannot change the output shape of a `returns table` function.
drop function if exists public.reports_queue(text);

create function public.reports_queue(p_state text default 'open')
returns table (
  id           uuid,
  created_at   timestamptz,
  reason       text,
  detail       text,
  state        text,
  target       text,
  marker_id    uuid,
  world_id     uuid,
  title        text,
  trail_name   text,
  lat          double precision,
  lng          double precision,
  placed_by    text,
  reporter     text,
  gone         boolean
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    r.id,
    r.created_at,
    r.reason,
    r.detail,
    r.state,
    r.target_kind,
    r.marker_id,
    coalesce(r.world_id, m.world_id),
    -- The snapshot first. The live row is only a fallback for reports written
    -- before this column existed.
    coalesce(r.target_title, m.content -> 'bg' ->> 'title', m.content -> 'en' ->> 'title'),
    coalesce(r.target_trail, w.name),
    coalesce(r.target_lat, case when m.id is not null then st_y(m.location::geometry) end),
    coalesce(r.target_lng, case when m.id is not null then st_x(m.location::geometry) end),
    (select u.email::text from auth.users u where u.id = m.created_by),
    (select u.email::text from auth.users u where u.id = r.reporter_id),
    -- Already removed. The row stays so the decision is on the record; the flag
    -- is what stops a reviewer being offered a Remove button for it.
    (r.marker_id is null and r.world_id is null)
  from public.reports r
  left join public.markers m on m.id = r.marker_id
  left join public.worlds  w on w.id = coalesce(r.world_id, m.world_id)
  where public.is_admin()
    and r.state = coalesce(nullif(trim(coalesce(p_state, '')), ''), 'open')
  order by r.created_at;
$$;

-- --------------------------------------------------------- 5. acting on one
--
-- Removing is separate from resolving on purpose. A reviewer often wants to
-- dismiss without touching anything, and occasionally wants to remove something
-- they found on their own with no report attached to it.

create or replace function public.resolve_report(
  p_report uuid,
  p_state  text,
  p_note   text default null
)
returns public.reports
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.reports;
begin
  if not public.is_admin() then
    raise exception 'not a reviewer' using errcode = '42501';
  end if;

  if p_state not in ('actioned','dismissed') then
    raise exception 'a report is actioned or dismissed' using errcode = 'check_violation';
  end if;

  update public.reports
     set state      = p_state,
         handled_by = auth.uid(),
         handled_at = now(),
         note       = nullif(trim(coalesce(p_note, '')), '')
   where id = p_report
  returning * into v_row;

  if v_row.id is null then
    raise exception 'no such report' using errcode = 'no_data_found';
  end if;

  return v_row;
end;
$$;

create or replace function public.remove_marker(p_marker uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not a reviewer' using errcode = '42501';
  end if;

  -- Every open report about it is closed by the removal itself. Leaving them
  -- open would leave a queue full of things that are already gone.
  update public.reports
     set state = 'actioned', handled_by = auth.uid(), handled_at = now(),
         note = coalesce(note, nullif(trim(coalesce(p_note, '')), ''))
   where marker_id = p_marker and state = 'open';

  delete from public.markers where id = p_marker;
end;
$$;

create or replace function public.remove_world(p_world uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not a reviewer' using errcode = '42501';
  end if;

  update public.reports
     set state = 'actioned', handled_by = auth.uid(), handled_at = now(),
         note = coalesce(note, nullif(trim(coalesce(p_note, '')), ''))
   where (world_id = p_world
          or marker_id in (select id from public.markers where world_id = p_world))
     and state = 'open';

  delete from public.worlds where id = p_world;
end;
$$;

-- --------------------------------------------------------- 6. the doors

revoke all on function public.report_marker(uuid, text, text) from public;
revoke all on function public.report_world(uuid, text, text)  from public;
grant execute on function public.report_marker(uuid, text, text) to authenticated;
grant execute on function public.report_world(uuid, text, text)  to authenticated;

revoke all on function public.reports_queue(text)                from public, anon;
revoke all on function public.resolve_report(uuid, text, text)   from public, anon;
revoke all on function public.remove_marker(uuid, text)          from public, anon;
revoke all on function public.remove_world(uuid, text)           from public, anon;
grant execute on function public.reports_queue(text)              to authenticated;
grant execute on function public.resolve_report(uuid, text, text) to authenticated;
grant execute on function public.remove_marker(uuid, text)        to authenticated;
grant execute on function public.remove_world(uuid, text)         to authenticated;

-- ------------------------------------------------------- 7. rate limits
--
-- Not to stop a person, to stop a script. The numbers are far above anything a
-- creator does by hand in a day and far below what an automated placement run
-- would want, which is the only band a limit like this can usefully sit in.
--
-- Counted from the rows themselves rather than a tally, so there is nothing to
-- reset and nothing that can disagree with the data.

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
  v_row   public.markers;
  v_today integer;
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

  select count(*) into v_today
  from public.markers m
  where m.created_by = auth.uid()
    and m.created_at > now() - interval '1 day';

  if v_today >= 200 then
    raise exception 'that is 200 stops in a day - stopping here in case something is looping'
      using errcode = 'check_violation';
  end if;

  insert into public.markers
    (world_id, location, content, style_key, colour_hex, step, status, radius_m, created_by)
  values
    (p_world, st_makepoint(p_lng, p_lat)::geography, coalesce(p_content, '{}'::jsonb),
     nullif(trim(coalesce(p_style_key, '')), ''), p_colour_hex,
     coalesce(
       p_step,
       (select coalesce(max(k.step), 0) + 1
          from public.markers k
         where k.world_id = p_world)),
     p_status,
     coalesce(p_radius_m, 100),
     auth.uid())
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.place_marker(uuid, double precision, double precision, jsonb, text, text, integer, text, integer) from public, anon;
grant execute on function public.place_marker(uuid, double precision, double precision, jsonb, text, text, integer, text, integer) to authenticated;

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
    (owner_id, name, join_code, mode, default_language, visibility, status)
  values
    (auth.uid(), trim(p_name), public.new_join_code(), p_mode, p_language,
     'private', 'draft')
  returning * into v_row;

  -- The on_world_created trigger from 0002 makes the owner a member.
  return v_row;
end;
$$;

revoke all on function public.create_world(text, text, text) from public, anon;
grant execute on function public.create_world(text, text, text) to authenticated;

-- ------------------------------------------- 8. deleting an account is a choice
--
-- It used to take every trail the person owned with it, because worlds.owner_id
-- cascades from profiles - and with them every other walker's record of having
-- been there. Now they are asked.
--
-- Keeping a trail detaches it rather than transferring it: no owner, no member
-- rows (those cascade), so may_edit answers false for everybody and it cannot be
-- changed again. It also leaves the public list, because an unowned public trail
-- is one that nobody can answer a report about.
--
-- The old no-argument version is dropped: left in place a client calling it
-- without the argument would silently get the destructive behaviour.

drop function if exists public.delete_my_account();

create or replace function public.delete_my_account(p_keep_trails boolean default false)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_id uuid := auth.uid();
begin
  if v_id is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  -- Teams whose only member is this person go now, so they do not survive as
  -- unreachable rows once the membership cascade has run.
  delete from public.teams t
  where t.id in (
    select tm.team_id from public.team_members tm where tm.user_id = v_id
  )
  and (select count(*) from public.team_members o where o.team_id = t.id) = 1;

  if p_keep_trails then
    update public.worlds
       set owner_id   = null,
           visibility = case when visibility = 'public' then 'unlisted' else visibility end,
           status     = case when status = 'submitted' then 'published' else status end
     where owner_id = v_id;
  end if;

  delete from auth.users where id = v_id;
end;
$$;

revoke all on function public.delete_my_account(boolean) from public, anon;
grant execute on function public.delete_my_account(boolean) to authenticated;

commit;
