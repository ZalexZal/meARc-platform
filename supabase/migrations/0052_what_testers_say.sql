-- 0052  What testers say, and the promises the privacy policy makes
--
-- Two things before Google's closed test.
--
-- FEEDBACK. Google asks, before it opens production, how testers were found,
-- what they said and what changed. So there is a place for them to say it:
-- "Send feedback" in the app and on the website, landing in the reviewer's
-- queue with the app version and phone model that make a report usable.
--
--   * Any signed-in session may send, guests included - a tester should not
--     need an email to say the camera is black.
--   * A 13-year-old whose parent has not agreed yet may not: a child's free
--     text is personal data processed before consent. The same consent_guard
--     trigger that stops them joining a trail stops this insert; the clients
--     show the contact address instead.
--   * Ten a day per person, so the queue cannot be flooded.
--   * The sender's email reaches the reviewer only if they ticked "you may
--     reply by email". It goes with the account, it is in the data export,
--     and it is deleted after twelve months.
--
-- HOUSEKEEPING. The privacy policy says the last answer position is kept for
-- one day. 0045 deleted old positions only when somebody next answered, so a
-- quiet week kept a week of them: a promise kept by traffic. A daily job now
-- keeps it, and three more retention rules with it:
--
--   player_fixes      older than 1 day
--   child_invites     30 days after they expired or were used
--   feedback          older than 12 months
--   guest accounts    anonymous, no sign-in or session refresh for 6 months -
--                     an abandoned guest can never sign back in, so keeping
--                     its data serves nobody (GDPR art. 5(1)(e)). Deleted the
--                     way delete_my_account does: one-person teams first.
--                     A guest cannot own a trail (create_world refuses), and
--                     the query checks anyway.
--
-- HEARTBEAT. Supabase Free pauses a project after a week with no requests. A
-- Netlify scheduled function calls keep_alive() once a day; the timestamp it
-- leaves is how anyone can check it is still running.
--
-- Safe to run twice.

begin;

-- ------------------------------------------------------------------ feedback

create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  source      text not null check (source in ('app', 'web')),
  app_version text check (char_length(app_version) <= 40),
  device      text check (char_length(device) <= 120),
  place       text check (char_length(place) <= 80),
  message     text not null check (char_length(btrim(message)) between 1 and 2000),
  reply_ok    boolean not null default false,
  created_at  timestamptz not null default now(),
  handled_at  timestamptz
);

comment on table public.feedback is
  'What testers and walkers tell us. Read only through feedback_queue (reviewers); '
  'deleted with the account and after 12 months.';

create index if not exists feedback_user_time on public.feedback (user_id, created_at);

alter table public.feedback enable row level security;
-- No policies: written through send_feedback, read through feedback_queue.

drop trigger if exists consent_guard_trg on public.feedback;
create trigger consent_guard_trg before insert on public.feedback
  for each row execute function public.consent_guard();

create or replace function public.send_feedback(
  p_message     text,
  p_source      text,
  p_app_version text default null,
  p_device      text default null,
  p_place       text default null,
  p_reply_ok    boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me  uuid := auth.uid();
  v_id  uuid;
begin
  if v_me is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  if char_length(btrim(coalesce(p_message, ''))) = 0 then
    raise exception 'write something first' using errcode = 'P0001';
  end if;

  if (select count(*) from public.feedback f
       where f.user_id = v_me and f.created_at > now() - interval '1 day') >= 10 then
    raise exception 'that is a lot of feedback for one day; try again tomorrow'
      using errcode = 'P0001';
  end if;

  insert into public.feedback (user_id, source, app_version, device, place, message, reply_ok)
  values (
    v_me,
    case when p_source = 'web' then 'web' else 'app' end,
    left(nullif(btrim(p_app_version), ''), 40),
    left(nullif(btrim(p_device), ''), 120),
    left(nullif(btrim(p_place), ''), 80),
    left(btrim(p_message), 2000),
    -- Only an account with an email can be replied to.
    coalesce(p_reply_ok, false) and coalesce(auth.jwt() ->> 'email', '') <> ''
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.send_feedback(text, text, text, text, text, boolean) from public, anon;
grant execute on function public.send_feedback(text, text, text, text, text, boolean) to authenticated;

create or replace function public.feedback_queue(p_include_handled boolean default false)
returns table (
  id          uuid,
  created_at  timestamptz,
  source      text,
  app_version text,
  device      text,
  place       text,
  message     text,
  reply_to    text,
  guest       boolean,
  handled_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  if not public.is_admin() then
    raise exception 'not a reviewer' using errcode = '42501';
  end if;

  return query
  select f.id, f.created_at, f.source, f.app_version, f.device, f.place, f.message,
         case when f.reply_ok then u.email::text end,
         coalesce(u.is_anonymous, false),
         f.handled_at
  from public.feedback f
  left join auth.users u on u.id = f.user_id
  where p_include_handled or f.handled_at is null
  order by f.created_at desc
  limit 200;
end;
$$;

revoke all on function public.feedback_queue(boolean) from public, anon;
grant execute on function public.feedback_queue(boolean) to authenticated;

create or replace function public.feedback_handled(p_id uuid, p_handled boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not a reviewer' using errcode = '42501';
  end if;

  update public.feedback
     set handled_at = case when p_handled then now() end
   where id = p_id;
end;
$$;

revoke all on function public.feedback_handled(uuid, boolean) from public, anon;
grant execute on function public.feedback_handled(uuid, boolean) to authenticated;

-- ------------------------------------------------------------------ the export

create or replace function public.export_user_data(p_user uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    'feedback', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'sent_at', f.created_at, 'from', f.source, 'where', f.place,
               'app_version', f.app_version, 'device', f.device,
               'message', f.message, 'reply_by_email', f.reply_ok)
               order by f.created_at), '[]'::jsonb)
      from public.feedback f where f.user_id = p_user),
    'removal_notices', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'what', n.kind, 'title', n.title, 'trail', n.trail_name,
               'reasons', n.reasons, 'note', n.note, 'at', n.created_at)), '[]'::jsonb)
      from public.moderation_notices n where n.owner_id = p_user)
  );
$function$;

revoke all on function public.export_user_data(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ heartbeat

create table if not exists public.heartbeat (
  id  int primary key default 1 check (id = 1),
  at  timestamptz not null default now()
);

alter table public.heartbeat enable row level security;

create or replace function public.keep_alive()
returns timestamptz
language sql
security definer
set search_path = public
as $$
  insert into public.heartbeat (id, at) values (1, now())
  on conflict (id) do update set at = excluded.at
  returning at;
$$;

revoke all on function public.keep_alive() from public;
grant execute on function public.keep_alive() to anon, authenticated;

-- ------------------------------------------------------------------ housekeeping

create or replace function public.housekeeping()
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_fixes    int;
  v_invites  int;
  v_feedback int;
  v_guests   uuid[];
begin
  delete from public.player_fixes where at < now() - interval '1 day';
  get diagnostics v_fixes = row_count;

  delete from public.child_invites
   where coalesce(used_at, expires_at) < now() - interval '30 days';
  get diagnostics v_invites = row_count;

  delete from public.feedback where created_at < now() - interval '12 months';
  get diagnostics v_feedback = row_count;

  select coalesce(array_agg(u.id), '{}') into v_guests
  from auth.users u
  where coalesce(u.is_anonymous, false)
    and greatest(
          u.created_at,
          coalesce(u.last_sign_in_at, u.created_at),
          coalesce((select max(s.updated_at) from auth.sessions s where s.user_id = u.id), u.created_at),
          coalesce((select max(rt.updated_at) from auth.refresh_tokens rt where rt.user_id = u.id::text), u.created_at)
        ) < now() - interval '6 months'
    and not exists (select 1 from public.worlds w where w.owner_id = u.id);

  if cardinality(v_guests) > 0 then
    delete from public.teams t
    where t.id in (select tm.team_id from public.team_members tm where tm.user_id = any(v_guests))
      and not exists (select 1 from public.team_members o
                      where o.team_id = t.id and o.user_id <> all(v_guests));

    delete from auth.users where id = any(v_guests);
  end if;

  return jsonb_build_object('at', now(), 'positions', v_fixes, 'parent_codes', v_invites,
                            'feedback', v_feedback, 'guests', cardinality(v_guests));
end;
$$;

revoke all on function public.housekeeping() from public, anon, authenticated;

commit;

-- pg_cron lives outside the transaction: creating the extension and scheduling
-- are each their own statement, and cron.schedule with a name replaces a job
-- of that name, so running this file again leaves one job, not two.
create extension if not exists pg_cron;
select cron.schedule('artrail-housekeeping', '30 2 * * *', 'select public.housekeeping()');

notify pgrst, 'reload schema';
