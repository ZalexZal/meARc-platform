-- =============================================================================
-- 0047  A parent says yes
--
-- Bulgarian law puts the age of digital consent at 14 (Personal Data Protection
-- Act, art. 25c, under GDPR art. 8). Below it, an account needs a parent or
-- guardian to agree. The terms have said so since the first draft; nothing
-- enforced it. This does.
--
-- How it works:
--
--   * Everybody is asked, once, at the terms: 14 or older, or under 14. Only
--     the answer is kept - never a date of birth (profiles.age_band).
--
--   * An under-14 names a parent's email. The request is written here, and the
--     parent is sent a sign-in link by Supabase Auth's own mailer - the same one
--     that sends confirmation emails - so there is one mail setup, not two, and
--     opening the link proves the parent controls that address. The link lands
--     on the website's consent page, where the parent reads what AR Trail is
--     and answers.
--
--   * Until a parent agrees, the child can read the terms and play the demo,
--     which never touches the server, and nothing else: no joining a trail, no
--     team, no answer, no visit, no trail of their own. That is enforced by
--     triggers on the tables those actions write to, so no function can forget
--     to check.
--
--   * A parent who says no, or later withdraws, ends the account: everything
--     it holds is deleted. Consent is what the processing rested on.
--
-- Kept about the parent: their email, when they were asked, when and how they
-- answered, and which version of the terms they saw. Deleted with the child's
-- account.
-- =============================================================================

begin;

alter table public.profiles
  add column age_band text check (age_band in ('14+', 'under14'));

create table public.parental_consents (
  child_id      uuid primary key references public.profiles(id) on delete cascade,
  parent_email  text not null check (parent_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  language      text not null default 'bg' check (language in ('bg', 'en')),
  requested_at  timestamptz not null default now(),
  requests      integer not null default 1,
  answered_at   timestamptz,
  answered_by   uuid references auth.users(id) on delete set null,
  granted       boolean,
  terms_version text
);

create index parental_consents_parent on public.parental_consents (lower(parent_email));

alter table public.parental_consents enable row level security;

-- The child sees their own request; the parent sees the requests made to their
-- address. Nobody writes except through the functions below.
create policy parental_consents_select on public.parental_consents
  for select using (
    child_id = auth.uid()
    or lower(parent_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

grant select on public.parental_consents to authenticated;

-- ------------------------------------------------------------------ the rule

create or replace function public.needs_parent(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles p
                 where p.id = p_user and p.age_band = 'under14')
     and not exists (select 1 from public.parental_consents c
                     where c.child_id = p_user and c.granted);
$$;

revoke all on function public.needs_parent(uuid) from public, anon, authenticated;

create or replace function public.consent_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  -- Through jsonb: plpgsql resolves every branch of a CASE against the row
  -- type, and worlds has no user_id - it refused every new trail when this
  -- read new.user_id directly.
  v_user := (to_jsonb(new) ->> case tg_table_name when 'worlds' then 'owner_id' else 'user_id' end)::uuid;

  if public.needs_parent(v_user) then
    raise exception 'a parent needs to agree first' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger consent_guard_trg before insert on public.worlds
  for each row execute function public.consent_guard();
create trigger consent_guard_trg before insert on public.world_members
  for each row execute function public.consent_guard();
create trigger consent_guard_trg before insert on public.team_members
  for each row execute function public.consent_guard();
create trigger consent_guard_trg before insert on public.marker_submissions
  for each row execute function public.consent_guard();
create trigger consent_guard_trg before insert or update on public.stop_visits
  for each row execute function public.consent_guard();

-- ------------------------------------------------------------------ the terms, with the age

-- p_under14 is optional so that a build which predates the question still
-- records its acceptance. Answering it again changes the answer; leaving it
-- out never erases one.
drop function public.accept_terms(text);

create function public.accept_terms(p_version text, p_under14 boolean default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set terms_accepted_at = now(),
         terms_version     = p_version,
         age_band          = case when p_under14 is null then age_band
                                  when p_under14 then 'under14' else '14+' end
   where id = auth.uid();
$$;

revoke all on function public.accept_terms(text, boolean) from public, anon;
grant execute on function public.accept_terms(text, boolean) to authenticated;

-- ------------------------------------------------------------------ the child's side

-- One word for the app and the site to act on:
--   not_needed  14 or older, or never asked
--   needed      under 14, no parent asked yet
--   pending     a parent has been asked and has not answered
--   granted     a parent agreed
create or replace function public.consent_state()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'state',
      case
        when coalesce(p.age_band, '14+') <> 'under14' then 'not_needed'
        when c.child_id is null then 'needed'
        when c.granted then 'granted'
        else 'pending'
      end,
    'parent_email', c.parent_email,
    'requested_at', c.requested_at)
  from public.profiles p
  left join public.parental_consents c on c.child_id = p.id
  where p.id = auth.uid();
$$;

-- Asks, or asks again - with the same address or a corrected one. The email
-- itself is sent by the caller through Supabase Auth; this is the record it
-- will be checked against.
create or replace function public.request_parent_consent(p_parent_email text, p_language text default 'bg')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_parent_email, '')));
  v_row   public.parental_consents;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  if not exists (select 1 from public.profiles p
                 where p.id = auth.uid() and p.age_band = 'under14') then
    raise exception 'only an under-14 account needs a parent' using errcode = 'P0001';
  end if;

  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'that is not an email address' using errcode = 'check_violation';
  end if;

  if v_email = lower(coalesce(auth.jwt() ->> 'email', '')) then
    raise exception 'a parent''s email, not your own' using errcode = 'check_violation';
  end if;

  select * into v_row from public.parental_consents where child_id = auth.uid();

  if v_row.granted then
    return public.consent_state();
  end if;

  -- Ten asks a day is plenty for a mistyped address; more is somebody using
  -- this to send email to strangers.
  if v_row.child_id is not null and v_row.requests >= 10
     and v_row.requested_at > now() - interval '1 day' then
    raise exception 'too many requests, try again tomorrow' using errcode = 'P0001';
  end if;

  insert into public.parental_consents (child_id, parent_email, language)
  values (auth.uid(), v_email, case when p_language = 'en' then 'en' else 'bg' end)
  on conflict (child_id) do update
    set parent_email = excluded.parent_email,
        language     = excluded.language,
        requested_at = now(),
        requests     = case when public.parental_consents.requested_at > now() - interval '1 day'
                            then public.parental_consents.requests + 1 else 1 end,
        answered_at  = null,
        answered_by  = null,
        granted      = null;

  return public.consent_state();
end;
$$;

-- ------------------------------------------------------------------ the parent's side

-- What waits for the signed-in parent: every request made to their address.
create or replace function public.consents_to_answer()
returns table (child_id uuid, child_name text, requested_at timestamptz,
               granted boolean, answered_at timestamptz, language text)
language sql
stable
security definer
set search_path = public
as $$
  select c.child_id,
         coalesce(nullif(trim(p.display_name), ''), ''),
         c.requested_at, c.granted, c.answered_at, c.language
  from public.parental_consents c
  join public.profiles p on p.id = c.child_id
  where lower(c.parent_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and coalesce(auth.jwt() ->> 'email', '') <> ''
  order by c.requested_at desc;
$$;

-- Everything an account holds, as delete_my_account removes it, for when the
-- person deciding is a parent rather than the account's owner.
create or replace function public.erase_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  delete from public.teams t
  where t.id in (select tm.team_id from public.team_members tm where tm.user_id = p_user)
    and (select count(*) from public.team_members o where o.team_id = t.id) = 1;

  delete from auth.users where id = p_user;
end;
$$;

revoke all on function public.erase_user(uuid) from public, anon, authenticated;

-- Yes, or no. No deletes the child's account: without consent there is no
-- basis to keep anything it holds.
create or replace function public.answer_parent_consent(p_child uuid, p_agree boolean, p_terms_version text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.parental_consents;
begin
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
     set granted = true, answered_at = now(), answered_by = auth.uid(),
         terms_version = p_terms_version
   where child_id = p_child;

  return 'granted';
end;
$$;

-- Changing one's mind later. Same outcome as a no.
create or replace function public.withdraw_parent_consent(p_child uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.parental_consents
                 where child_id = p_child
                   and lower(parent_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                   and coalesce(auth.jwt() ->> 'email', '') <> '') then
    raise exception 'no request for you to answer' using errcode = 'P0001';
  end if;

  perform public.erase_user(p_child);
  return 'erased';
end;
$$;

revoke all on function public.consent_state() from public, anon;
revoke all on function public.request_parent_consent(text, text) from public, anon;
revoke all on function public.consents_to_answer() from public, anon;
revoke all on function public.answer_parent_consent(uuid, boolean, text) from public, anon;
revoke all on function public.withdraw_parent_consent(uuid) from public, anon;
grant execute on function public.consent_state() to authenticated;
grant execute on function public.request_parent_consent(text, text) to authenticated;
grant execute on function public.consents_to_answer() to authenticated;
grant execute on function public.answer_parent_consent(uuid, boolean, text) to authenticated;
grant execute on function public.withdraw_parent_consent(uuid) to authenticated;

-- ------------------------------------------------------------------ your data, all of it
--
-- The download gains what the last four migrations started keeping: blocks,
-- position warnings, the parent's consent. The profile row already carries
-- age_band.

create or replace function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'exported_at', now(),
    'account', (
      select to_jsonb(p) - 'id'
      from public.profiles p where p.id = auth.uid()
    ),
    'trails_joined', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', w.name, 'role', m.role, 'joined_at', m.joined_at)), '[]'::jsonb)
      from public.world_members m
      join public.worlds w on w.id = m.world_id
      where m.user_id = auth.uid()
    ),
    'teams', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'team', t.name, 'trail', w.name, 'joined_at', tm.joined_at)), '[]'::jsonb)
      from public.team_members tm
      join public.teams  t on t.id = tm.team_id
      join public.worlds w on w.id = t.world_id
      where tm.user_id = auth.uid()
    ),
    'solved', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trail', w.name, 'points', mp.points, 'solved_at', mp.solved_at)), '[]'::jsonb)
      from public.marker_progress mp
      join public.markers m on m.id = mp.marker_id
      join public.worlds  w on w.id = m.world_id
      where mp.solved_by = auth.uid()
    ),
    'submissions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trail',     w.name,
               'submitted', s.submitted,
               'verdict',   s.verdict,
               'at',        s.created_at)), '[]'::jsonb)
      from public.marker_submissions s
      join public.markers m on m.id = s.marker_id
      join public.worlds  w on w.id = m.world_id
      where s.user_id = auth.uid()
    ),
    'stops_visited', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trail', w.name, 'via', v.via, 'at', v.visited_at)), '[]'::jsonb)
      from public.stop_visits v
      join public.markers m on m.id = v.marker_id
      join public.worlds  w on w.id = m.world_id
      where v.user_id = auth.uid()
    ),
    'trails_created', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', w.name, 'mode', w.mode, 'created_at', w.created_at)), '[]'::jsonb)
      from public.worlds w
      where w.owner_id = auth.uid()
    ),
    'blocked', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'what', b.via, 'name', b.label, 'at', b.created_at)), '[]'::jsonb)
      from public.user_blocks b
      where b.blocker_id = auth.uid()
    ),
    'last_answer_position', (
      select jsonb_build_object('lat', f.lat, 'lng', f.lng, 'accuracy_m', f.accuracy_m, 'at', f.at)
      from public.player_fixes f
      where f.user_id = auth.uid()
    ),
    'position_warnings', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'trail', w.name, 'problem', f.problem, 'at', f.created_at)), '[]'::jsonb)
      from public.position_flags f
      join public.worlds w on w.id = f.world_id
      where f.user_id = auth.uid()
    ),
    'parental_consent', (
      select jsonb_build_object(
               'parent_email', c.parent_email, 'requested_at', c.requested_at,
               'granted', c.granted, 'answered_at', c.answered_at,
               'terms_version', c.terms_version)
      from public.parental_consents c
      where c.child_id = auth.uid()
    )
  );
$$;

commit;
