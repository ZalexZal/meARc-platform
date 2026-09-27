-- =============================================================================
-- 0050  A parent's account, and a reason for every removal
--
-- 1. Parents.
--
--    0047 let a 13-year-old name a parent's email and wait for them. Now a
--    parent can also start: signed in to the website by an emailed link, they
--    add a child by name and get a one-time code; the child types it into the
--    app and the account is theirs, agreed to, from the first minute. One
--    parent account holds any number of children. For each, the parent sees
--    what the child has done (trails, teams, badges, when last active), can
--    download everything held about them, and can withdraw - which deletes
--    the child's account, as in 0047.
--
--    Every parent function asks for a session opened by an emailed link
--    (signed_in_by_email_link, 0048): with sign-up confirmations off, anybody
--    can make a password account with any address, but only the owner of the
--    inbox can open a link sent to it.
--
-- 2. Removals.
--
--    The EU Digital Services Act (art. 17) requires a hosting service to tell
--    whoever posted something why it was taken down, and how to contest it.
--    remove_world and remove_marker deleted and said nothing. Now each leaves
--    a notice for the trail's owner - what went, when, the reasons it was
--    reported for, the reviewer's note - which My trails shows.
--
-- 3. Your data, for a parent too: export_my_data becomes export_user_data(user)
--    behind two doors, the account itself and its parent.
-- =============================================================================

begin;

-- ------------------------------------------------------------------ parents

alter table public.parental_consents
  add column parent_id uuid references auth.users(id) on delete set null,
  add column via text not null default 'email' check (via in ('email', 'code'));

create index parental_consents_parent_id on public.parental_consents (parent_id);

create table public.child_invites (
  code          text primary key,
  parent_id     uuid not null references public.profiles(id) on delete cascade,
  parent_email  text not null,
  child_name    text not null check (length(trim(child_name)) between 1 and 40),
  terms_version text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '7 days',
  used_by       uuid references public.profiles(id) on delete set null,
  used_at       timestamptz
);

create index child_invites_parent on public.child_invites (parent_id);

-- Read through my_child_invites only.
alter table public.child_invites enable row level security;

-- A parent's own view of the consents table follows the parent id too, now
-- that a consent made from a code carries one.
drop policy parental_consents_select on public.parental_consents;
create policy parental_consents_select on public.parental_consents
  for select using (
    child_id = auth.uid()
    or ((lower(parent_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
         or parent_id = auth.uid())
        and public.signed_in_by_email_link()));

-- Whether the caller is, right now, a parent of this child.
create or replace function public.is_parent_of(p_child uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.signed_in_by_email_link()
     and exists (
       select 1 from public.parental_consents c
       where c.child_id = p_child
         and (c.parent_id = auth.uid()
              or (coalesce(auth.jwt() ->> 'email', '') <> ''
                  and lower(c.parent_email) = lower(auth.jwt() ->> 'email'))));
$$;

revoke all on function public.is_parent_of(uuid) from public, anon, authenticated;

create or replace function public.create_child_invite(p_child_name text, p_terms_version text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_row  public.child_invites;
begin
  if not public.signed_in_by_email_link() or coalesce(auth.jwt() ->> 'email', '') = '' then
    raise exception 'open the link we emailed to add a child' using errcode = '42501';
  end if;

  -- A child cannot be somebody's parent here.
  if exists (select 1 from public.profiles p where p.id = auth.uid() and p.age_band = 'under14') then
    raise exception 'only an adult can add a child' using errcode = '42501';
  end if;

  if length(trim(coalesce(p_child_name, ''))) not between 1 and 40 then
    raise exception 'give the child a name of up to 40 letters' using errcode = 'check_violation';
  end if;

  if (select count(*) from public.child_invites
      where parent_id = auth.uid() and used_at is null and expires_at > now()) >= 10 then
    raise exception 'too many open codes; use or cancel some first' using errcode = 'P0001';
  end if;

  loop
    v_code := public.random_code(10);
    exit when not exists (select 1 from public.child_invites where code = v_code);
  end loop;

  insert into public.child_invites (code, parent_id, parent_email, child_name, terms_version)
  values (v_code, auth.uid(), lower(auth.jwt() ->> 'email'), trim(p_child_name), p_terms_version)
  returning * into v_row;

  return jsonb_build_object('code', v_row.code, 'child_name', v_row.child_name,
                            'expires_at', v_row.expires_at);
end;
$$;

create or replace function public.cancel_child_invite(p_code text)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.child_invites
  where code = upper(trim(p_code)) and parent_id = auth.uid() and used_at is null
    and public.signed_in_by_email_link();
$$;

create or replace function public.my_child_invites()
returns table (code text, child_name text, created_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select i.code, i.child_name, i.created_at, i.expires_at
  from public.child_invites i
  where i.parent_id = auth.uid() and i.used_at is null and i.expires_at > now()
    and public.signed_in_by_email_link()
  order by i.created_at desc;
$$;

-- The child's side: a 13-year-old types the code their parent was given.
create or replace function public.redeem_child_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.child_invites;
  v_now    public.parental_consents;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.age_band = 'under14') then
    raise exception 'only an account for a 13-year-old takes a parent code' using errcode = 'P0001';
  end if;

  select * into v_invite from public.child_invites
  where code = upper(trim(coalesce(p_code, '')))
  for update;

  if v_invite.code is null or v_invite.used_at is not null or v_invite.expires_at < now()
     or v_invite.parent_id = auth.uid() then
    raise exception 'that code does not work; ask your parent for a new one' using errcode = 'P0001';
  end if;

  select * into v_now from public.parental_consents where child_id = auth.uid();

  if coalesce(v_now.granted, false) then
    raise exception 'a parent has already agreed for this account' using errcode = 'P0001';
  end if;

  insert into public.parental_consents
    (child_id, parent_email, parent_id, via, language, requested_at,
     answered_at, answered_by, granted, terms_version)
  values
    (auth.uid(), v_invite.parent_email, v_invite.parent_id, 'code', 'bg', v_invite.created_at,
     now(), v_invite.parent_id, true, v_invite.terms_version)
  on conflict (child_id) do update
    set parent_email = excluded.parent_email, parent_id = excluded.parent_id, via = 'code',
        requested_at = excluded.requested_at, answered_at = excluded.answered_at,
        answered_by = excluded.answered_by, granted = true, terms_version = excluded.terms_version;

  update public.child_invites set used_by = auth.uid(), used_at = now() where code = v_invite.code;

  -- The name the parent gave, unless the child already chose one.
  update public.profiles set display_name = v_invite.child_name
  where id = auth.uid() and coalesce(trim(display_name), '') = '';

  return public.consent_state();
end;
$$;

-- A parent answering a request made to their email now records who they are,
-- so their account holds the child from then on.
create or replace function public.answer_parent_consent(p_child uuid, p_agree boolean, p_terms_version text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.parental_consents;
begin
  if not public.signed_in_by_email_link() then
    raise exception 'open the link we emailed to answer' using errcode = '42501';
  end if;

  select * into v_row from public.parental_consents
  where child_id = p_child
    and lower(parent_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and coalesce(auth.jwt() ->> 'email', '') <> '';

  if v_row.child_id is null then
    raise exception 'no request for you to answer' using errcode = 'P0001';
  end if;

  if not coalesce(p_agree, false) then
    perform public.erase_user(p_child);
    return 'erased';
  end if;

  update public.parental_consents
     set granted = true, answered_at = now(), answered_by = auth.uid(), parent_id = auth.uid(),
         terms_version = p_terms_version
   where child_id = p_child;

  return 'granted';
end;
$$;

create or replace function public.withdraw_parent_consent(p_child uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_parent_of(p_child) then
    raise exception 'open the link we emailed to answer' using errcode = '42501';
  end if;

  perform public.erase_user(p_child);
  return 'erased';
end;
$$;

-- Everything a parent sees about their children, fresh: each child's badges
-- are brought up to date before they are counted.
create or replace function public.my_children()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_child uuid;
begin
  if not public.signed_in_by_email_link() or v_email = '' then
    return '[]'::jsonb;
  end if;

  for v_child in
    select c.child_id from public.parental_consents c
    where c.parent_id = auth.uid() or lower(c.parent_email) = v_email
  loop
    perform public.profile_for(v_child);
  end loop;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'child_id',     c.child_id,
      'name',         coalesce(nullif(trim(p.display_name), ''), ''),
      'granted',      coalesce(c.granted, false),
      'via',          c.via,
      'requested_at', c.requested_at,
      'answered_at',  c.answered_at,
      'trails', (select coalesce(jsonb_agg(jsonb_build_object('name', w.name, 'mode', w.mode)
                                           order by m.joined_at desc), '[]'::jsonb)
                 from public.world_members m join public.worlds w on w.id = m.world_id
                 where m.user_id = c.child_id),
      'teams',  (select coalesce(jsonb_agg(t.name), '[]'::jsonb)
                 from public.team_members tm join public.teams t on t.id = tm.team_id
                 where tm.user_id = c.child_id),
      'walked', (select count(*) from public.walked_trails w where w.user_id = c.child_id),
      'badges', (select count(*) from public.earned_badges e where e.user_id = c.child_id),
      'last_active', greatest(
                 (select max(v.visited_at) from public.stop_visits v where v.user_id = c.child_id),
                 (select max(s.created_at) from public.marker_submissions s where s.user_id = c.child_id)))
      order by c.requested_at desc)
    from public.parental_consents c
    join public.profiles p on p.id = c.child_id
    where c.parent_id = auth.uid() or lower(c.parent_email) = v_email), '[]'::jsonb);
end;
$$;

-- ------------------------------------------------------------------ your data

create table public.moderation_notices (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null references public.profiles(id) on delete cascade,
  kind       text not null check (kind in ('trail', 'stop')),
  title      text,
  trail_name text,
  reasons    text[] not null default '{}',
  note       text,
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);

create index moderation_notices_owner on public.moderation_notices (owner_id);

alter table public.moderation_notices enable row level security;
create policy moderation_notices_select_own on public.moderation_notices
  for select using (owner_id = auth.uid());
grant select on public.moderation_notices to authenticated;


create or replace function public.export_user_data(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'account', (select to_jsonb(p) - 'id' from public.profiles p where p.id = p_user),
    'trails_joined', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', w.name, 'role', m.role, 'joined_at', m.joined_at)), '[]'::jsonb)
      from public.world_members m join public.worlds w on w.id = m.world_id
      where m.user_id = p_user),
    'trails_walked', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', w.name, 'mode', w.mode, 'finished_at', w.finished_at)), '[]'::jsonb)
      from public.walked_trails w where w.user_id = p_user),
    'badges', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'badge', e.badge, 'tier', e.tier, 'earned_at', e.earned_at)), '[]'::jsonb)
      from public.earned_badges e where e.user_id = p_user),
    'teams', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'team', t.name, 'trail', w.name, 'joined_at', tm.joined_at)), '[]'::jsonb)
      from public.team_members tm
      join public.teams t on t.id = tm.team_id
      join public.worlds w on w.id = t.world_id
      where tm.user_id = p_user),
    'solved', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trail', w.name, 'points', mp.points, 'solved_at', mp.solved_at)), '[]'::jsonb)
      from public.marker_progress mp
      join public.markers m on m.id = mp.marker_id
      join public.worlds w on w.id = m.world_id
      where mp.solved_by = p_user),
    'submissions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trail', w.name, 'submitted', s.submitted, 'verdict', s.verdict,
               'at', s.created_at)), '[]'::jsonb)
      from public.marker_submissions s
      join public.markers m on m.id = s.marker_id
      join public.worlds w on w.id = m.world_id
      where s.user_id = p_user),
    'stops_visited', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trail', w.name, 'via', v.via, 'at', v.visited_at)), '[]'::jsonb)
      from public.stop_visits v
      join public.markers m on m.id = v.marker_id
      join public.worlds w on w.id = m.world_id
      where v.user_id = p_user),
    'trails_created', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', w.name, 'mode', w.mode, 'created_at', w.created_at)), '[]'::jsonb)
      from public.worlds w where w.owner_id = p_user),
    'blocked', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'what', b.via, 'name', b.label, 'at', b.created_at)), '[]'::jsonb)
      from public.user_blocks b where b.blocker_id = p_user),
    'last_answer_position', (
      select jsonb_build_object('lat', f.lat, 'lng', f.lng, 'accuracy_m', f.accuracy_m, 'at', f.at)
      from public.player_fixes f where f.user_id = p_user),
    'position_warnings', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trail', w.name, 'problem', f.problem, 'at', f.created_at)), '[]'::jsonb)
      from public.position_flags f join public.worlds w on w.id = f.world_id
      where f.user_id = p_user),
    'parental_consent', (
      select jsonb_build_object(
               'parent_email', c.parent_email, 'via', c.via, 'requested_at', c.requested_at,
               'granted', c.granted, 'answered_at', c.answered_at,
               'terms_version', c.terms_version)
      from public.parental_consents c where c.child_id = p_user),
    'children', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', coalesce(nullif(trim(p.display_name), ''), ''),
               'granted', c.granted, 'answered_at', c.answered_at)), '[]'::jsonb)
      from public.parental_consents c join public.profiles p on p.id = c.child_id
      where c.parent_id = p_user),
    'removal_notices', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'what', n.kind, 'title', n.title, 'trail', n.trail_name,
               'reasons', n.reasons, 'note', n.note, 'at', n.created_at)), '[]'::jsonb)
      from public.moderation_notices n where n.owner_id = p_user)
  );
$$;

revoke all on function public.export_user_data(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ removals


create or replace function public.notice_seen(p_notice uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.moderation_notices set seen_at = now()
  where id = p_notice and owner_id = auth.uid() and seen_at is null;
$$;

create or replace function public.remove_world(p_world uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world public.worlds;
begin
  if not public.is_admin() then
    raise exception 'not a reviewer' using errcode = '42501';
  end if;

  select * into v_world from public.worlds where id = p_world;

  -- The statement of reasons, before there is nothing left to state it about.
  if v_world.owner_id is not null then
    insert into public.moderation_notices (owner_id, kind, title, trail_name, reasons, note)
    select v_world.owner_id, 'trail', v_world.name, v_world.name,
           coalesce(array_agg(distinct r.reason) filter (where r.reason is not null), '{}'),
           nullif(trim(coalesce(p_note, '')), '')
    from public.reports r
    where (r.world_id = p_world
           or r.marker_id in (select id from public.markers where world_id = p_world))
      and r.state = 'open';
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

create or replace function public.remove_marker(p_marker uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_title text;
  v_trail text;
begin
  if not public.is_admin() then
    raise exception 'not a reviewer' using errcode = '42501';
  end if;

  select w.owner_id, coalesce(m.content -> 'bg' ->> 'title', m.content -> 'en' ->> 'title'), w.name
    into v_owner, v_title, v_trail
  from public.markers m join public.worlds w on w.id = m.world_id
  where m.id = p_marker;

  if v_owner is not null then
    insert into public.moderation_notices (owner_id, kind, title, trail_name, reasons, note)
    select v_owner, 'stop', v_title, v_trail,
           coalesce(array_agg(distinct r.reason) filter (where r.reason is not null), '{}'),
           nullif(trim(coalesce(p_note, '')), '')
    from public.reports r
    where r.marker_id = p_marker and r.state = 'open';
  end if;

  update public.reports
     set state = 'actioned', handled_by = auth.uid(), handled_at = now(),
         note = coalesce(note, nullif(trim(coalesce(p_note, '')), ''))
   where marker_id = p_marker and state = 'open';

  delete from public.markers where id = p_marker;
end;
$$;

-- ------------------------------------------------------------------ the doors

create or replace function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.export_user_data(auth.uid()) where auth.uid() is not null;
$$;

create or replace function public.export_child_data(p_child uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_parent_of(p_child) then
    raise exception 'open the link we emailed to answer' using errcode = '42501';
  end if;

  return public.export_user_data(p_child);
end;
$$;

revoke all on function public.create_child_invite(text, text) from public, anon;
revoke all on function public.cancel_child_invite(text) from public, anon;
revoke all on function public.my_child_invites() from public, anon;
revoke all on function public.redeem_child_invite(text) from public, anon;
revoke all on function public.my_children() from public, anon;
revoke all on function public.export_child_data(uuid) from public, anon;
revoke all on function public.notice_seen(uuid) from public, anon;
grant execute on function public.create_child_invite(text, text) to authenticated;
grant execute on function public.cancel_child_invite(text) to authenticated;
grant execute on function public.my_child_invites() to authenticated;
grant execute on function public.redeem_child_invite(text) to authenticated;
grant execute on function public.my_children() to authenticated;
grant execute on function public.export_child_data(uuid) to authenticated;
grant execute on function public.notice_seen(uuid) to authenticated;

commit;
