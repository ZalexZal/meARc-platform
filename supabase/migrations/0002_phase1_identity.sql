-- =============================================================================
-- Phase 1 — identity, membership, and shutting the door
-- =============================================================================
--
-- Phase 0 left two policies that let anybody holding the anon key read, write,
-- edit and delete every row in every world. That key ships inside the APK. This
-- migration replaces them with real rules.
--
-- Written to be safe to run twice. Every object is created if missing and every
-- policy is dropped before it is made, so a half-finished run can be repeated
-- rather than unpicked.
--
-- Read PHASE-1.md alongside this. The reasoning lives there; this is the doing.
-- =============================================================================

begin;

-- ---------------------------------------------------------------- 1. profiles
--
-- Supabase owns auth.users and it cannot be altered, so the convention is a
-- table keyed 1:1 to it. Populated by a trigger rather than by the client:
-- a client that inserts its own profile row can insert one for somebody else.

create table if not exists public.profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  display_name      text,
  is_anonymous      boolean     not null default false,
  terms_accepted_at timestamptz,
  terms_version     text,
  created_at        timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- to_jsonb rather than new.is_anonymous directly: the column arrived in a
  -- Supabase update, and reading it through jsonb returns null instead of
  -- failing the whole trigger on a project that predates it.
  insert into public.profiles (id, is_anonymous)
  values (new.id, coalesce((to_jsonb(new) ->> 'is_anonymous')::boolean, false))
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Anyone who signed up before this migration existed has no profile row.
insert into public.profiles (id)
select u.id from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

-- ----------------------------------------------------------- 2. world_members
--
-- The composite primary key is the rule that one person cannot hold two roles
-- in one world.

create table if not exists public.world_members (
  world_id  uuid not null references public.worlds(id)   on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  role      text not null check (role in ('owner','editor','viewer')),
  joined_at timestamptz not null default now(),
  primary key (world_id, user_id)
);

create index if not exists world_members_user_idx on public.world_members (user_id);

-- worlds.owner_id was left free in Phase 0 because there was nobody to point it
-- at. Deleting a creator now takes their worlds and, through the existing
-- cascade on markers, everything in them (decision 6).
--
-- Phase 0 worlds have a null owner_id and survive: a null passes a foreign key.
-- They belong to nobody and can only be reached with the service key, which is
-- the correct outcome for rows created before there were accounts.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'worlds_owner_id_fkey'
  ) then
    alter table public.worlds
      add constraint worlds_owner_id_fkey
      foreign key (owner_id) references public.profiles(id) on delete cascade;
  end if;
end $$;

-- A world's owner is also a member, so every permission check consults one
-- table instead of two.
create or replace function public.world_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_id is not null then
    insert into public.world_members (world_id, user_id, role)
    values (new.id, new.owner_id, 'owner')
    on conflict (world_id, user_id) do update set role = 'owner';
  end if;

  return new;
end;
$$;

drop trigger if exists on_world_created on public.worlds;

create trigger on_world_created
  after insert on public.worlds
  for each row execute function public.world_owner_membership();

-- ------------------------------------------------------- 3. permission lookups
--
-- SECURITY DEFINER on purpose, and it is not a shortcut.
--
-- A policy on worlds that reads world_members, whose own policy reads worlds,
-- recurses until Postgres gives up. These functions run past RLS, so a policy
-- can ask "what is my role here" without asking a question that asks itself.

create or replace function public.world_role(p_world uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role
  from public.world_members m
  where m.world_id = p_world
    and m.user_id  = auth.uid();
$$;

-- A world anybody may read without joining: published, and not private.
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
      and w.status = 'published'
  );
$$;

revoke all on function public.world_role(uuid)    from public;
revoke all on function public.world_is_open(uuid) from public;
grant execute on function public.world_role(uuid)    to anon, authenticated;
grant execute on function public.world_is_open(uuid) to anon, authenticated;

-- ------------------------------------------------------------ 4. join_world
--
-- SECURITY DEFINER for the same reason markers_near is: the caller cannot read
-- worlds until they are a member, so the function has to look the code up on
-- their behalf.
--
-- A join code always grants viewer. A leaked viewer code costs an unwanted
-- reader; a leaked editor code costs the trail.

create or replace function public.join_world(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select w.id into v_world
  from public.worlds w
  where upper(trim(w.join_code)) = upper(trim(p_code));

  if v_world is null then
    raise exception 'no world with that code' using errcode = 'no_data_found';
  end if;

  -- Rotating a join code changes the door, not who is already inside.
  insert into public.world_members (world_id, user_id, role)
  values (v_world, auth.uid(), 'viewer')
  on conflict (world_id, user_id) do nothing;

  return v_world;
end;
$$;

revoke all on function public.join_world(text) from public;
grant execute on function public.join_world(text) to authenticated;

-- ------------------------------------------------- 5. accepting the terms
--
-- Recorded against the profile, including anonymous ones. Somebody who looked
-- at a trail without an account still agreed to something.

create or replace function public.accept_terms(p_version text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set terms_accepted_at = now(),
         terms_version     = p_version
   where id = auth.uid();
$$;

revoke all on function public.accept_terms(text) from public;
grant execute on function public.accept_terms(text) to authenticated;

-- ------------------------------------------------------------------- 6. RLS
--
-- The Phase 0 development policies go first. They are the hole this migration
-- exists to close.

drop policy if exists phase0_dev_anon_all_worlds  on public.worlds;
drop policy if exists phase0_dev_anon_all_markers on public.markers;

alter table public.profiles      enable row level security;
alter table public.world_members enable row level security;
alter table public.worlds        enable row level security;
alter table public.markers       enable row level security;

-- --- profiles: your own row, and nothing else -------------------------------
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select using (id = auth.uid());

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- No insert policy: the trigger creates profiles. No delete policy: profiles go
-- when the auth user goes.

-- --- worlds -----------------------------------------------------------------
drop policy if exists worlds_select_member on public.worlds;
create policy worlds_select_member on public.worlds
  for select using (public.world_role(id) is not null);

-- PHASE 1 ONLY. Delete in Phase 3, once the app asks for a join code.
-- This is what keeps the working build alive while the app has no login: it
-- lets an unauthenticated client see a published, non-private world. It is a
-- deliberate hole with a date on it, not a considered permission.
drop policy if exists temp_anon_read_published_worlds on public.worlds;
create policy temp_anon_read_published_worlds on public.worlds
  for select using (visibility in ('unlisted','public') and status = 'published');

drop policy if exists worlds_insert_own on public.worlds;
create policy worlds_insert_own on public.worlds
  for insert with check (auth.uid() is not null and owner_id = auth.uid());

drop policy if exists worlds_update_owner on public.worlds;
create policy worlds_update_owner on public.worlds
  for update using (public.world_role(id) = 'owner')
  with check (public.world_role(id) = 'owner');

drop policy if exists worlds_delete_owner on public.worlds;
create policy worlds_delete_owner on public.worlds
  for delete using (public.world_role(id) = 'owner');

-- --- world_members ----------------------------------------------------------
drop policy if exists members_select_own_worlds on public.world_members;
create policy members_select_own_worlds on public.world_members
  for select using (public.world_role(world_id) is not null);

-- No insert policy. join_world is the only way in.

drop policy if exists members_update_owner on public.world_members;
create policy members_update_owner on public.world_members
  for update using (public.world_role(world_id) = 'owner')
  with check (public.world_role(world_id) = 'owner');

drop policy if exists members_delete_owner_or_self on public.world_members;
create policy members_delete_owner_or_self on public.world_members
  for delete using (
    public.world_role(world_id) = 'owner' or user_id = auth.uid()
  );

-- --- markers ----------------------------------------------------------------
--
-- There is deliberately no select policy. Clients never read this table; the
-- app calls markers_near, which is SECURITY DEFINER and is the only door. That
-- is what makes a hidden marker in a CTF world actually hidden - a client that
-- can select the table can select the answers.

drop policy if exists markers_write_editor on public.markers;
create policy markers_write_editor on public.markers
  for insert with check (public.world_role(world_id) in ('owner','editor'));

drop policy if exists markers_update_editor on public.markers;
create policy markers_update_editor on public.markers
  for update using (public.world_role(world_id) in ('owner','editor'))
  with check (public.world_role(world_id) in ('owner','editor'));

drop policy if exists markers_delete_editor on public.markers;
create policy markers_delete_editor on public.markers
  for delete using (public.world_role(world_id) in ('owner','editor'));

-- ------------------------------------------- 7. markers_near respects membership
--
-- The function body changes and the client does not. Both the Unity app and the
-- throwaway web page keep working with no edit, which is the seam from §4 of the
-- handbook paying out a second time.

create or replace function public.markers_near(
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
    st_distance(m.location, st_makepoint(p_lng, p_lat)::geography) as distance_m
  from public.markers m
  where m.world_id = p_world_id
    and m.status   = 'published'
    -- The new line. A member sees the world; so does anybody, if the world is
    -- published and not private. Everyone else gets an empty list, not an error:
    -- an error tells an attacker the world exists.
    and (public.world_role(p_world_id) is not null
         or public.world_is_open(p_world_id))
    and st_dwithin(m.location, st_makepoint(p_lng, p_lat)::geography,
                   least(greatest(p_radius_m, 1), 5000))
  order by distance_m
  limit 100;
$$;

revoke all on function public.markers_near(uuid, double precision, double precision, integer) from public;
grant execute on function public.markers_near(uuid, double precision, double precision, integer) to anon, authenticated;

commit;

-- =============================================================================
-- After running this, verify from outside the dashboard.
--
-- The SQL editor runs with elevated privileges and proves nothing about what a
-- client can do. The checks are in PHASE-1.md, step 7, and they use curl with
-- real tokens. Do not skip them: this migration is the only thing standing
-- between the anon key in the APK and every row in the database.
-- =============================================================================
