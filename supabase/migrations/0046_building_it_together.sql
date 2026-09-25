-- =============================================================================
-- 0046  Building a trail together
--
-- The editor role has existed since 0002 and nothing could hand it to anybody.
-- This is the door, and the live wire behind it.
--
--   An invite is a link. The owner makes one, sends it however they like, and
--   whoever opens it while signed in becomes an editor. No email lookups - the
--   server never confirms whether an address has an account - and no email to
--   send, so it works before the project has a mail service.
--
--   The code lives in its own table, not on worlds, because every member of a
--   trail can read its worlds row: a player could have read the editor code
--   and promoted themselves. Only the owner can read editor_invites.
--
--   Editors can change stops, answers, hints and media, which RLS already
--   allowed. The trail itself - its name, its level, its code, deleting it,
--   and who else may edit - stays the owner's.
--
--   Live: markers and the three tables hung off them are published to Realtime.
--   Row-level security decides who hears what, exactly as it decides who reads
--   what, so only a trail's owner and editors receive its changes.
-- =============================================================================

begin;

create table public.editor_invites (
  world_id   uuid primary key references public.worlds(id) on delete cascade,
  code       text not null unique,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.editor_invites enable row level security;

create policy editor_invites_select_owner on public.editor_invites
  for select using (public.world_role(world_id) = 'owner');

grant select on public.editor_invites to authenticated;

-- The link for this trail, made on first ask. p_new swaps it for a fresh one,
-- which is how an owner takes back a link that went further than intended.
create or replace function public.editor_invite(p_world uuid, p_new boolean default false)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if public.world_role(p_world) is distinct from 'owner' then
    raise exception 'only the owner can invite editors' using errcode = '42501';
  end if;

  if not p_new then
    select code into v_code from public.editor_invites where world_id = p_world;
    if v_code is not null then
      return v_code;
    end if;
  end if;

  -- Long, because unlike a join code nobody reads this one out across a room.
  loop
    v_code := public.random_code(20);
    exit when not exists (select 1 from public.editor_invites where code = v_code);
  end loop;

  insert into public.editor_invites (world_id, code, created_by)
  values (p_world, v_code, auth.uid())
  on conflict (world_id) do update
    set code = excluded.code, created_by = excluded.created_by, created_at = now();

  return v_code;
end;
$$;

-- No link at all. Editors already in stay in; this only shuts the door.
create or replace function public.stop_editor_invite(p_world uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.world_role(p_world) is distinct from 'owner' then
    raise exception 'only the owner can invite editors' using errcode = '42501';
  end if;

  delete from public.editor_invites where world_id = p_world;
end;
$$;

create or replace function public.join_as_editor(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world uuid;
  v_owner uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  -- An editor is somebody the owner can name, so a guest cannot be one.
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'editing needs a real account' using errcode = '42501';
  end if;

  select i.world_id, w.owner_id into v_world, v_owner
  from public.editor_invites i
  join public.worlds w on w.id = i.world_id
  where i.code = trim(p_code);

  -- A block reads as a dead link, the same as it does for a join code.
  if v_world is null or public.blocked_between(auth.uid(), v_owner) then
    raise exception 'that invite link does not work any more' using errcode = 'P0001';
  end if;

  -- The owner opening their own link changes nothing; a player becomes an
  -- editor; an editor stays one.
  insert into public.world_members (world_id, user_id, role)
  values (v_world, auth.uid(), 'editor')
  on conflict (world_id, user_id) do update
    set role = case when public.world_members.role = 'owner' then 'owner' else 'editor' end;

  return v_world;
end;
$$;

-- Who can edit this trail, for the people who can. The owner also sees each
-- editor's email, because they are the one deciding whether to keep them.
create or replace function public.trail_editors(p_world uuid)
returns table (user_id uuid, name text, email text, role text, joined_at timestamptz, is_me boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.user_id,
    coalesce(nullif(trim(p.display_name), ''), ''),
    case when public.world_role(p_world) = 'owner' then u.email::text end,
    m.role,
    m.joined_at,
    m.user_id = auth.uid()
  from public.world_members m
  left join public.profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where m.world_id = p_world
    and m.role in ('owner', 'editor')
    and public.may_edit(p_world)
  order by m.role = 'owner' desc, m.joined_at;
$$;

create or replace function public.remove_editor(p_world uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.world_role(p_world) is distinct from 'owner' then
    raise exception 'only the owner can remove editors' using errcode = '42501';
  end if;

  delete from public.world_members
  where world_id = p_world and user_id = p_user and role = 'editor';
end;
$$;

revoke all on function public.editor_invite(uuid, boolean) from public, anon;
revoke all on function public.stop_editor_invite(uuid) from public, anon;
revoke all on function public.join_as_editor(text) from public, anon;
revoke all on function public.trail_editors(uuid) from public, anon;
revoke all on function public.remove_editor(uuid, uuid) from public, anon;
grant execute on function public.editor_invite(uuid, boolean) to authenticated;
grant execute on function public.stop_editor_invite(uuid) to authenticated;
grant execute on function public.join_as_editor(text) to authenticated;
grant execute on function public.trail_editors(uuid) to authenticated;
grant execute on function public.remove_editor(uuid, uuid) to authenticated;

-- ------------------------------------------------------------------ live

alter publication supabase_realtime add table
  public.markers, public.marker_answers, public.marker_hints, public.marker_media;

commit;
