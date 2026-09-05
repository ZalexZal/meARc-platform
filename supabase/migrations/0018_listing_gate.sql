-- =============================================================================
-- The listing gate — a trail becomes public because somebody said yes
-- =============================================================================
--
-- Handbook §10: "Publishing to public goes through an approval queue. Private
-- and unlisted worlds publish instantly; moving a world to visibility = public
-- puts it in submitted, and a human moves it to public. Auto-publish with
-- reactive takedown is what gets an app pulled, and it puts unbounded reactive
-- work on one person."
--
-- The My trails page currently writes visibility = 'public' straight through,
-- which is exactly the auto-publish that paragraph forbids. This is that hole
-- closed.
--
-- --- why status and not a new column
--
-- 'submitted' is already in worlds.status's check constraint, unused. The only
-- thing that reads status as "is this live" is world_is_open, and widening it to
-- accept 'submitted' means a trail under review keeps working for the people
-- already walking it: markers_near lets a member through on world_role alone,
-- join_world only matches the code, and public_trails still asks for
-- 'published', so a submitted trail is live and unlisted, which is precisely
-- what "waiting to be listed" should mean.
--
-- Taking a trail offline while somebody reviews it would punish the creator for
-- asking.
--
-- --- before you run this
--
-- Put your own address in the marked line in section 2. Without it the admin
-- table is empty, nobody can approve anything, and the queue is a locked door.
-- The DO block below will say so rather than let it pass quietly.
--
-- --- what this does not do
--
-- Trails already sitting at visibility = 'public' stay public. They were put
-- there by the button this migration replaces, they are the author's own, and
-- quietly pulling somebody's live trail down is a worse default than leaving a
-- handful of known rows alone. Un-list one by hand if it should not be there.
--
-- Safe to run twice.
-- =============================================================================

begin;

-- ------------------------------------------------------------- 1. the note
--
-- Why a listing was refused. The creator is owed a reason, and "no" with no
-- sentence attached is how a person learns nothing and submits the same trail
-- again tomorrow.

alter table public.worlds
  add column if not exists review_note text;

comment on column public.worlds.review_note is
  'What the reviewer said when they last approved or refused a listing. Shown '
  'to the creator. Cleared when a new request is made.';

-- --------------------------------------------------------- 2. who may decide
--
-- A table rather than a flag on the user, because "is an admin" is a fact about
-- the platform and not about a person's profile - and because §1 of the app
-- handoff is emphatic that there are no account types. This is the one
-- exception, and it is deliberately not called a role.

create table if not exists public.platform_admins (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

-- RLS on and no policies at all: nothing reaches this table through the API,
-- in either direction. is_admin() reads it as definer, which is the only way in.
alter table public.platform_admins enable row level security;

-- ↓↓↓ PUT YOUR OWN ADDRESS HERE ↓↓↓
insert into public.platform_admins (user_id)
select u.id
  from auth.users u
 where lower(u.email) = lower('REPLACE-WITH-YOUR-EMAIL')
on conflict (user_id) do nothing;
-- ↑↑↑ PUT YOUR OWN ADDRESS HERE ↑↑↑

do $$
begin
  if not exists (select 1 from public.platform_admins) then
    raise warning
      'No platform admin was set. Edit the address in section 2 of this file and '
      'run it again, or nothing will ever be approved.';
  end if;
end;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- coalesce for the same reason may_edit has one: a null here would be a null
  -- through every caller, and "null not in (...)" is a guard that does not guard.
  select coalesce(
    (select true from public.platform_admins a where a.user_id = auth.uid()),
    false);
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ------------------------------------------------- 3. submitted counts as live
--
-- The one behavioural change in this file. Everything else is new surface.

create or replace function public.world_is_open(p_world uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.worlds w
    where w.id = p_world
      and w.visibility in ('unlisted','public')
      -- 'submitted' is live-but-not-listed. A trail does not go dark because
      -- its creator asked to have it listed.
      and w.status in ('published','submitted')
  );
$$;

revoke all on function public.world_is_open(uuid) from public;
grant execute on function public.world_is_open(uuid) to anon, authenticated;

-- ------------------------------------------------------------- 4. asking
--
-- Owner only, not editor. Putting a trail in front of the public is the owner's
-- call, and world_members.role already draws that line.

create or replace function public.request_listing(p_world uuid)
returns public.worlds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.worlds;
begin
  if public.world_role(p_world) is distinct from 'owner' then
    raise exception 'only the owner can ask for a listing' using errcode = '42501';
  end if;

  -- An empty trail is not a trail. Every reviewer would refuse this by hand, so
  -- refusing it here saves them the round trip and tells the creator sooner.
  if not exists (select 1 from public.markers m
                  where m.world_id = p_world and m.status = 'published') then
    raise exception 'a trail needs at least one published stop before it can be listed'
      using errcode = 'check_violation';
  end if;

  update public.worlds
     set status      = 'submitted',
         -- Not public yet. That word is what the reviewer grants.
         visibility  = case when visibility = 'private' then 'unlisted' else visibility end,
         review_note = null
   where id = p_world
  returning * into v_row;

  return v_row;
end;
$$;

-- Taking the request back. A creator who submitted by accident, or who spotted
-- something wrong while waiting, should not have to ask a reviewer to refuse it.
create or replace function public.withdraw_listing(p_world uuid)
returns public.worlds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.worlds;
begin
  if public.world_role(p_world) is distinct from 'owner' then
    raise exception 'not yours' using errcode = '42501';
  end if;

  update public.worlds
     set status = 'published'
   where id = p_world
     and status = 'submitted'
  returning * into v_row;

  return v_row;
end;
$$;

-- ------------------------------------------------------------ 5. the queue
--
-- What is waiting, oldest first, with enough to judge it by without opening it.
-- The owner's address is here because a reviewer refusing a trail wants to know
-- whether it is the same person's fourth attempt this morning.

create or replace function public.listing_queue()
returns table (
  id           uuid,
  name         text,
  mode         text,
  owner_email  text,
  marker_count bigint,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.id, w.name, w.mode,
    (select u.email::text from auth.users u where u.id = w.owner_id),
    (select count(*) from public.markers m
      where m.world_id = w.id and m.status = 'published'),
    w.created_at
  from public.worlds w
  where w.status = 'submitted'
    and public.is_admin()
  order by w.created_at;
$$;

revoke all on function public.listing_queue() from public, anon;
grant execute on function public.listing_queue() to authenticated;

-- ------------------------------------------------------------ 6. deciding

create or replace function public.decide_listing(
  p_world   uuid,
  p_approve boolean,
  p_note    text default null
)
returns public.worlds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.worlds;
begin
  if not public.is_admin() then
    raise exception 'not a reviewer' using errcode = '42501';
  end if;

  if p_approve then
    update public.worlds
       set visibility  = 'public',
           status      = 'published',
           review_note = nullif(trim(coalesce(p_note, '')), '')
     where id = p_world
    returning * into v_row;
  else
    -- Refused, not deleted. It goes back to being a working unlisted trail with
    -- a sentence saying why, which is a state its creator can act on.
    update public.worlds
       set visibility  = 'unlisted',
           status      = 'published',
           review_note = nullif(trim(coalesce(p_note, '')), '')
     where id = p_world
    returning * into v_row;
  end if;

  if v_row.id is null then
    raise exception 'no such trail' using errcode = 'no_data_found';
  end if;

  return v_row;
end;
$$;

revoke all on function public.decide_listing(uuid, boolean, text) from public, anon;
grant execute on function public.decide_listing(uuid, boolean, text) to authenticated;

revoke all on function public.request_listing(uuid) from public, anon;
grant execute on function public.request_listing(uuid) to authenticated;
revoke all on function public.withdraw_listing(uuid) from public, anon;
grant execute on function public.withdraw_listing(uuid) to authenticated;

-- ------------------------------------------------ 7. my_worlds carries the state
--
-- Dropped and recreated: CREATE OR REPLACE cannot change the output columns of a
-- `returns table` function, and this adds one.

drop function if exists public.my_worlds();

create function public.my_worlds()
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
  review_note  text,
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
    w.review_note,
    w.created_at
  from public.worlds w
  join public.world_members m on m.world_id = w.id
  where m.user_id = auth.uid()
    and m.role in ('owner','editor')
  order by w.created_at desc;
$$;

revoke all on function public.my_worlds() from public, anon;
grant execute on function public.my_worlds() to authenticated;

commit;
