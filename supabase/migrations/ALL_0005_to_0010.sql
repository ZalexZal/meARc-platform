-- =============================================================================
-- AR Trail — migrations 0005 to 0010, bundled for one paste
--
-- Generated, not authored. The six files in supabase/migrations/ are the source
-- of truth; this is them concatenated in order so the SQL editor needs one run
-- instead of six.
--
-- Each migration opens and commits its own transaction, so if one fails the
-- ones before it stay applied, and the whole bundle is safe to re-run - every
-- object is created if missing and every policy dropped before it is made.
--
-- Order matters: 0006 creates check_answer, which calls award_progress from
-- 0007. plpgsql resolves called functions at run time rather than creation
-- time, so this order is fine - but do not run 0006 alone and then answer a
-- question.
-- =============================================================================



-- ###########################################################################
-- 0005_teams.sql
-- ###########################################################################

-- =============================================================================
-- Teams — who the progress belongs to
-- =============================================================================
--
-- Progress cannot belong to a device. A device is lost, reinstalled and shared,
-- and a leaderboard built on one is a leaderboard of handsets. It belongs to a
-- team, and a solo player is a team of one - created for them without being
-- asked - so that every progress and leaderboard query has exactly one shape
-- instead of two that drift apart.
--
-- A team belongs to one trail. The same four people walking a second trail are
-- a second team, because their start time, their score and their standing are
-- all per-trail and sharing a row across trails would mean none of those three
-- has a single value.
--
-- Competitive trails reject anonymous members. That is checked here rather than
-- in a client, because a rule enforced in a client is advice.
--
-- Safe to run twice.
-- =============================================================================

begin;

-- ------------------------------------------------------- 0. a mode that was missing
--
-- The app has always offered four modes and the table has only ever allowed
-- three. Nothing failed loudly: freefall simply could not be saved, so every
-- trail that should have had no order silently was not one. Added here because
-- the creator portal is the first thing that will actually try to write it.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'worlds_mode_check'
      and conrelid = 'public.worlds'::regclass
  ) then
    alter table public.worlds drop constraint worlds_mode_check;
  end if;
end $$;

alter table public.worlds
  add constraint worlds_mode_check
  check (mode in ('guide','educational','ctf','freefall'));

-- ------------------------------------------------------------------ 1. teams

create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  world_id    uuid not null references public.worlds(id)   on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 40),
  -- Its own code, unrelated to the trail's. The trail code says which game you
  -- are playing; this says who you are playing it with.
  invite_code text unique not null,
  created_by  uuid references public.profiles(id) on delete set null,
  -- Set by the first solve rather than at creation, so a team that registers a
  -- week early is not ranked as having taken a week.
  started_at  timestamptz,
  created_at  timestamptz not null default now(),

  -- Two teams in one trail may not share a name, or a leaderboard cannot be
  -- read out loud.
  unique (world_id, name)
);

create index if not exists teams_world_idx on public.teams (world_id);

create table if not exists public.team_members (
  team_id   uuid not null references public.teams(id)    on delete cascade,
  user_id   uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists team_members_user_idx on public.team_members (user_id);

-- ------------------------------------------------- 2. the two rules about size
--
-- Neither can be a CHECK constraint: both count other rows, and a CHECK sees
-- only the row in front of it.

create or replace function public.team_membership_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world   uuid;
  v_size    integer;
  v_clashes integer;
begin
  select t.world_id into v_world
  from public.teams t
  where t.id = new.team_id;

  -- Four is the cap both reference events use, and it is the number that still
  -- fits round one phone screen at a marker.
  select count(*) into v_size
  from public.team_members
  where team_id = new.team_id;

  if v_size >= 4 then
    raise exception 'this team is full' using errcode = 'check_violation';
  end if;

  -- One team per person per trail. Without this, somebody can join two teams on
  -- the same trail and solve a stop for both of them.
  select count(*) into v_clashes
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  where tm.user_id = new.user_id
    and t.world_id = v_world
    and tm.team_id <> new.team_id;

  if v_clashes > 0 then
    raise exception 'already on a team for this trail'
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists team_membership_guard_trg on public.team_members;

create trigger team_membership_guard_trg
  before insert on public.team_members
  for each row execute function public.team_membership_guard();

-- ------------------------------------------------------- 3. permission lookup
--
-- SECURITY DEFINER for the same reason world_role is: a policy on teams that
-- reads team_members, whose policy reads teams, asks a question that asks
-- itself until Postgres gives up.

create or replace function public.my_team(p_world uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.id
  from public.teams t
  join public.team_members tm on tm.team_id = t.id
  where t.world_id = p_world
    and tm.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.on_team(p_team uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team and user_id = auth.uid()
  );
$$;

revoke all on function public.my_team(uuid)  from public;
revoke all on function public.on_team(uuid)  from public;
grant execute on function public.my_team(uuid)  to anon, authenticated;
grant execute on function public.on_team(uuid)  to anon, authenticated;

-- --------------------------------------------------------- 4. making a team
--
-- A short code, from an alphabet with no O/0 or I/1/l, because it gets read
-- aloud across a street.

create or replace function public.new_team_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code     text;
  v_tries    integer := 0;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;

    exit when not exists (select 1 from public.teams where invite_code = v_code);

    v_tries := v_tries + 1;
    if v_tries > 50 then
      raise exception 'could not find an unused team code';
    end if;
  end loop;

  return v_code;
end;
$$;

-- Is this caller allowed to play this trail at all, and as themselves?
create or replace function public.assert_may_play(p_world uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mode text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  if public.world_role(p_world) is null then
    raise exception 'not a member of this trail' using errcode = '42501';
  end if;

  select w.mode into v_mode from public.worlds w where w.id = p_world;

  -- A competitive trail keeps a public ranking with a name against it. An
  -- anonymous user is a row that vanishes with the app, which is both unfair to
  -- everybody ranked below them and impossible to contest afterwards.
  if v_mode = 'ctf'
     and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'a competitive trail needs a real account'
      using errcode = '28000';
  end if;
end;
$$;

create or replace function public.create_team(p_world uuid, p_name text)
returns public.teams
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team public.teams;
begin
  perform public.assert_may_play(p_world);

  if public.my_team(p_world) is not null then
    raise exception 'already on a team for this trail'
      using errcode = 'unique_violation';
  end if;

  insert into public.teams (world_id, name, invite_code, created_by)
  values (p_world, trim(p_name), public.new_team_code(), auth.uid())
  returning * into v_team;

  insert into public.team_members (team_id, user_id)
  values (v_team.id, auth.uid());

  return v_team;
end;
$$;

create or replace function public.join_team(p_code text)
returns public.teams
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team public.teams;
begin
  select * into v_team
  from public.teams
  where upper(trim(invite_code)) = upper(trim(p_code));

  if v_team.id is null then
    raise exception 'no team with that code' using errcode = 'no_data_found';
  end if;

  perform public.assert_may_play(v_team.world_id);

  -- The size cap and the one-team rule live in the trigger, so this insert
  -- raises rather than needing to repeat them.
  insert into public.team_members (team_id, user_id)
  values (v_team.id, auth.uid())
  on conflict (team_id, user_id) do nothing;

  return v_team;
end;
$$;

-- The team of one, made without being asked.
--
-- Called by check_answer before it records anything, so a solo player never
-- meets the word "team" unless they go looking for it.
create or replace function public.ensure_team(p_world uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team uuid;
  v_name text;
begin
  v_team := public.my_team(p_world);
  if v_team is not null then
    return v_team;
  end if;

  perform public.assert_may_play(p_world);

  select coalesce(nullif(trim(p.display_name), ''), 'Player')
    into v_name
  from public.profiles p
  where p.id = auth.uid();

  -- The unique (world_id, name) constraint means two silent players called
  -- "Player" would collide, so the id's first characters are appended.
  v_name := left(v_name, 28) || ' · ' || left(replace(auth.uid()::text, '-', ''), 4);

  insert into public.teams (world_id, name, invite_code, created_by)
  values (p_world, v_name, public.new_team_code(), auth.uid())
  returning id into v_team;

  insert into public.team_members (team_id, user_id)
  values (v_team, auth.uid());

  return v_team;
end;
$$;

create or replace function public.leave_team(p_team uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.team_members
  where team_id = p_team and user_id = auth.uid();

  -- A team with nobody in it is not a team. Its progress goes with it, which is
  -- correct: nobody is left who could claim it.
  delete from public.teams t
  where t.id = p_team
    and not exists (select 1 from public.team_members where team_id = t.id);
end;
$$;

revoke all on function public.new_team_code()               from public;
revoke all on function public.assert_may_play(uuid)         from public;
revoke all on function public.create_team(uuid, text)       from public;
revoke all on function public.join_team(text)               from public;
revoke all on function public.ensure_team(uuid)             from public;
revoke all on function public.leave_team(uuid)              from public;

grant execute on function public.create_team(uuid, text) to authenticated;
grant execute on function public.join_team(text)         to authenticated;
grant execute on function public.ensure_team(uuid)       to authenticated;
grant execute on function public.leave_team(uuid)        to authenticated;

-- ------------------------------------------------------------------- 5. RLS
--
-- A team's name is public on a leaderboard; its roster is not. Those are two
-- different questions and they get two different answers: the board is served
-- by a SECURITY DEFINER function that returns names, and these policies never
-- hand a table row to anyone outside the team.

alter table public.teams        enable row level security;
alter table public.team_members enable row level security;

drop policy if exists teams_select_own on public.teams;
create policy teams_select_own on public.teams
  for select using (
    public.on_team(id)
    or public.world_role(world_id) in ('owner','editor')
  );

-- No insert, update or delete policies. create_team, join_team and leave_team
-- are the only doors, and each one checks something a policy cannot express.

drop policy if exists team_members_select_own on public.team_members;
create policy team_members_select_own on public.team_members
  for select using (
    user_id = auth.uid()
    or public.on_team(team_id)
  );

commit;

-- =============================================================================
-- Verify from outside the dashboard, as two different signed-in users:
--
--   * create_team on a ctf trail as an anonymous user must fail with 28000.
--   * join_team with a fifth member must fail with check_violation.
--   * selecting team_members for a team you are not on must return zero rows.
--
-- The third one is the one worth writing carefully. It passed once against a
-- table that happened to hold only the tester's own rows, which proved nothing.
-- =============================================================================


-- ###########################################################################
-- 0006_answers.sql
-- ###########################################################################

-- =============================================================================
-- Answers — the one table no player may read
-- =============================================================================
--
-- The reason markers_near exists is that a client which reads the markers table
-- holds every answer before the player has walked anywhere. That reasoning does
-- not stop at markers. An answer sitting in a table a player can select is an
-- answer already on their phone, and no interface hides data that has arrived.
--
-- So the split here is deliberate and it is the whole design:
--
--   * The **question** and, for multiple choice, the **options** live in
--     markers.content, travel through markers_near, and are meant to be on the
--     phone. A player cannot answer a question they cannot read.
--   * The **correct answer** lives in marker_answers, which no player can select
--     under any policy. Only check_answer touches it, and check_answer returns a
--     verdict.
--
-- A creator can read marker_answers for their own trail, because somebody who
-- cannot see the answer they wrote cannot correct a typo in it. "Readable by
-- nobody" was the original wording and it was wrong: it would have made the
-- editor write-only.
--
-- Safe to run twice.
-- =============================================================================

begin;

-- --------------------------------------------------------- 1. marker_answers
--
-- One row per marker, or none. A marker with no row here asks nothing, which is
-- most of them - a guided trail is markers with something to read and no test.

create table if not exists public.marker_answers (
  marker_id  uuid primary key references public.markers(id) on delete cascade,

  kind       text not null check (kind in ('exact','choice','free')),

  -- exact: every spelling that counts as right. Compared folded and trimmed, so
  -- this holds meanings rather than keystrokes. A creator who writes one entry
  -- has written a question with exactly one acceptable spelling, which is
  -- usually a mistake they find out about from a player.
  accepted   text[] not null default '{}',

  -- choice: which option in markers.content is the right one, zero-based. The
  -- options themselves are not here - they ship to the phone with the question.
  correct_choice integer,

  -- free: nothing to compare. A person decides, later.
  points     integer not null default 10 check (points between 0 and 1000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint marker_answers_shape check (
    (kind = 'exact'  and array_length(accepted, 1) >= 1 and correct_choice is null)
    or (kind = 'choice' and correct_choice >= 0 and array_length(accepted, 1) is null)
    or (kind = 'free'   and correct_choice is null)
  )
);

-- ----------------------------------------------------- 2. marker_submissions
--
-- Every attempt, including the wrong ones. Three jobs: it is what "review the
-- answers" reads, it is the audit trail when a team disputes a score, and it is
-- the only place a creator can see that forty teams all failed one stop because
-- the question is ambiguous rather than hard.

create table if not exists public.marker_submissions (
  id          uuid primary key default gen_random_uuid(),
  marker_id   uuid not null references public.markers(id)   on delete cascade,
  team_id     uuid not null references public.teams(id)     on delete cascade,
  user_id     uuid          references public.profiles(id)  on delete set null,

  submitted   text not null,
  verdict     text not null check (verdict in ('correct','incorrect','pending_review')),

  -- Set when a human decides a free-text answer.
  reviewed_by uuid          references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,

  created_at  timestamptz not null default now()
);

create index if not exists submissions_marker_idx  on public.marker_submissions (marker_id);
create index if not exists submissions_team_idx    on public.marker_submissions (team_id);
-- The review queue's own query: everything still waiting, oldest first.
create index if not exists submissions_pending_idx on public.marker_submissions (verdict, created_at)
  where verdict = 'pending_review';

-- ----------------------------------------------------------- 3. check_answer
--
-- Returns a verdict and a number. Never the expected answer, never a hint, and
-- never a distinguishable error: a wrong answer and a marker that does not
-- exist come back the same way, because the difference between them is itself
-- information about a world the caller may not be in.

create or replace function public.check_answer(p_marker uuid, p_submitted text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_world   uuid;
  v_answer  public.marker_answers;
  v_team    uuid;
  v_verdict text;
  v_points  integer := 0;
  v_norm    text;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select m.world_id into v_world
  from public.markers m
  where m.id = p_marker and m.status = 'published';

  -- No such marker, or one the caller may not touch. Both answer the same way,
  -- so a stranger cannot map which ids are real by watching the errors.
  if v_world is null or public.world_role(v_world) is null then
    return jsonb_build_object('verdict', 'incorrect', 'points', 0);
  end if;

  select * into v_answer from public.marker_answers where marker_id = p_marker;

  if v_answer.marker_id is null then
    return jsonb_build_object('verdict', 'incorrect', 'points', 0);
  end if;

  -- Made here rather than by the caller, so a solo player never has to know the
  -- word team and a first solve is also the moment the clock starts.
  v_team := public.ensure_team(v_world);

  v_norm := lower(btrim(coalesce(p_submitted, '')));

  if v_answer.kind = 'free' then
    v_verdict := 'pending_review';

  elsif v_answer.kind = 'choice' then
    v_verdict := case
      when v_norm ~ '^[0-9]+$' and v_norm::integer = v_answer.correct_choice
      then 'correct' else 'incorrect'
    end;

  else
    -- Every accepted spelling, folded the same way the submission was. Casing
    -- and stray spaces are typing, not knowledge.
    v_verdict := case
      when exists (
        select 1 from unnest(v_answer.accepted) a
        where lower(btrim(a)) = v_norm
      )
      then 'correct' else 'incorrect'
    end;
  end if;

  if v_verdict = 'correct' then
    v_points := v_answer.points;
  end if;

  insert into public.marker_submissions
    (marker_id, team_id, user_id, submitted, verdict)
  values
    (p_marker, v_team, auth.uid(), coalesce(p_submitted, ''), v_verdict);

  if v_verdict = 'correct' then
    perform public.award_progress(v_team, p_marker, v_points, auth.uid());
  end if;

  -- points is the marker's value on a correct answer and zero otherwise. It is
  -- never the value of an answer the team got wrong, which would tell them how
  -- hard they should keep trying.
  return jsonb_build_object('verdict', v_verdict, 'points', v_points);
end;
$$;

revoke all on function public.check_answer(uuid, text) from public;
grant execute on function public.check_answer(uuid, text) to authenticated;

-- --------------------------------------------------------- 4. writing answers
--
-- A creator sets an answer through a function rather than an insert, because
-- the shape rules differ per kind and a client that assembles the row itself
-- will eventually assemble a choice question with no correct index.

create or replace function public.set_marker_answer(
  p_marker         uuid,
  p_kind           text,
  p_accepted       text[]  default null,
  p_correct_choice integer default null,
  p_points         integer default 10
)
returns public.marker_answers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world uuid;
  v_row   public.marker_answers;
begin
  select m.world_id into v_world from public.markers m where m.id = p_marker;

  if v_world is null or public.world_role(v_world) not in ('owner','editor') then
    raise exception 'not yours to edit' using errcode = '42501';
  end if;

  insert into public.marker_answers
    (marker_id, kind, accepted, correct_choice, points)
  values
    (p_marker, p_kind, coalesce(p_accepted, '{}'), p_correct_choice, p_points)
  on conflict (marker_id) do update
    set kind           = excluded.kind,
        accepted       = excluded.accepted,
        correct_choice = excluded.correct_choice,
        points         = excluded.points,
        updated_at     = now()
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.clear_marker_answer(p_marker uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world uuid;
begin
  select m.world_id into v_world from public.markers m where m.id = p_marker;

  if v_world is null or public.world_role(v_world) not in ('owner','editor') then
    raise exception 'not yours to edit' using errcode = '42501';
  end if;

  delete from public.marker_answers where marker_id = p_marker;
end;
$$;

revoke all on function public.set_marker_answer(uuid, text, text[], integer, integer) from public;
revoke all on function public.clear_marker_answer(uuid) from public;
grant execute on function public.set_marker_answer(uuid, text, text[], integer, integer) to authenticated;
grant execute on function public.clear_marker_answer(uuid) to authenticated;

-- ------------------------------------------------------------------- 5. RLS

alter table public.marker_answers     enable row level security;
alter table public.marker_submissions enable row level security;

-- The creator of the trail, and nobody else on earth. There is deliberately no
-- policy that mentions membership: being in a trail is what lets you answer a
-- question, never what lets you read its answer.
drop policy if exists answers_select_creator on public.marker_answers;
create policy answers_select_creator on public.marker_answers
  for select using (
    exists (
      select 1 from public.markers m
      where m.id = marker_answers.marker_id
        and public.world_role(m.world_id) in ('owner','editor')
    )
  );

-- No insert, update or delete policies. set_marker_answer is the only door.

-- A team reads what it typed. A creator reads what was typed at their trail,
-- which is the whole point of a review queue.
drop policy if exists submissions_select_own on public.marker_submissions;
create policy submissions_select_own on public.marker_submissions
  for select using (
    public.on_team(team_id)
    or exists (
      select 1 from public.markers m
      where m.id = marker_submissions.marker_id
        and public.world_role(m.world_id) in ('owner','editor')
    )
  );

-- No insert policy: check_answer writes these. A client that could insert its
-- own submission could insert one with the verdict already set to correct.

commit;

-- =============================================================================
-- Verify from outside the dashboard:
--
--   * select from marker_answers as a joined player: zero rows.
--   * check_answer with a wrong answer, and check_answer with a random uuid:
--     byte-identical responses.
--   * check_answer with the right answer returns points; the response for a
--     wrong one says zero and names no expected value anywhere in the body or
--     the headers.
--   * set_marker_answer as somebody who is not owner or editor: 42501.
-- =============================================================================


-- ###########################################################################
-- 0007_progress.sql
-- ###########################################################################

-- =============================================================================
-- Progress — what a team has actually done
-- =============================================================================
--
-- Until now "found" lived in PlayerPrefs on one handset. That made a reinstall
-- destroy a group's afternoon, made a lost phone unrecoverable, and made a
-- leaderboard impossible: there was nothing on the server to rank.
--
-- One row per team per marker. No row means not solved; there is no "solved =
-- false" to keep in step with anything.
--
-- Nothing writes here from a client. award_progress is called by check_answer,
-- and by a creator's verdict on a free-text answer. A client that could insert
-- its own progress row could insert one for every marker in the trail.
--
-- 0006 creates check_answer, which calls award_progress from this file. plpgsql
-- resolves called functions when the function runs rather than when it is
-- created, so the order 0006 then 0007 is fine - but 0007 must be applied
-- before anybody answers a question.
--
-- Safe to run twice.
-- =============================================================================

begin;

create table if not exists public.marker_progress (
  team_id    uuid not null references public.teams(id)    on delete cascade,
  marker_id  uuid not null references public.markers(id)  on delete cascade,

  -- Which member got it. A team that walked in three directions can see who
  -- brought what back, and it is the only record of that.
  solved_by  uuid references public.profiles(id) on delete set null,

  points     integer not null default 0 check (points >= 0),
  solved_at  timestamptz not null default now(),

  primary key (team_id, marker_id)
);

create index if not exists progress_team_idx   on public.marker_progress (team_id);
create index if not exists progress_marker_idx on public.marker_progress (marker_id);

-- ------------------------------------------------------------ award_progress
--
-- Idempotent on purpose. Two members submitting the right answer within the
-- same second is a race the game should not care about, and the first one to
-- land keeps the credit.
--
-- Also where the clock starts. started_at is set by the first solve rather than
-- at registration, so a team that signs up a week early is not ranked as having
-- taken a week to finish.

create or replace function public.award_progress(
  p_team    uuid,
  p_marker  uuid,
  p_points  integer,
  p_by      uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.marker_progress (team_id, marker_id, solved_by, points)
  values (p_team, p_marker, p_by, greatest(coalesce(p_points, 0), 0))
  on conflict (team_id, marker_id) do nothing;

  update public.teams
     set started_at = coalesce(started_at, now())
   where id = p_team;
end;
$$;

revoke all on function public.award_progress(uuid, uuid, integer, uuid) from public;
-- Granted to nobody. Only other SECURITY DEFINER functions in this schema call
-- it, and they run as the owner. A client with execute on this could award
-- itself the whole trail.

-- ------------------------------------------------------------- review_answer
--
-- A creator's verdict on a free-text submission. This is the second and last
-- thing that may write progress.

create or replace function public.review_answer(
  p_submission uuid,
  p_correct    boolean,
  p_note       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sub    public.marker_submissions;
  v_world  uuid;
  v_points integer;
begin
  select * into v_sub from public.marker_submissions where id = p_submission;

  if v_sub.id is null then
    raise exception 'no such submission' using errcode = 'no_data_found';
  end if;

  select m.world_id into v_world from public.markers m where m.id = v_sub.marker_id;

  if public.world_role(v_world) not in ('owner','editor') then
    raise exception 'not yours to review' using errcode = '42501';
  end if;

  -- Re-deciding an already-decided submission is allowed: a creator who marked
  -- forty answers wrong and then realised the question was ambiguous needs to
  -- be able to undo it. Withdrawing points is the half that is easy to forget.
  update public.marker_submissions
     set verdict     = case when p_correct then 'correct' else 'incorrect' end,
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         review_note = p_note
   where id = p_submission;

  select coalesce(a.points, 0) into v_points
  from public.marker_answers a
  where a.marker_id = v_sub.marker_id;

  if p_correct then
    perform public.award_progress(v_sub.team_id, v_sub.marker_id,
                                  v_points, v_sub.user_id);
  else
    -- Only if no other submission for this marker still stands as correct.
    delete from public.marker_progress mp
    where mp.team_id = v_sub.team_id
      and mp.marker_id = v_sub.marker_id
      and not exists (
        select 1 from public.marker_submissions s
        where s.marker_id = v_sub.marker_id
          and s.team_id   = v_sub.team_id
          and s.id        <> p_submission
          and s.verdict   = 'correct'
      );
  end if;

  return jsonb_build_object(
    'verdict', case when p_correct then 'correct' else 'incorrect' end,
    'points',  case when p_correct then v_points else 0 end
  );
end;
$$;

revoke all on function public.review_answer(uuid, boolean, text) from public;
grant execute on function public.review_answer(uuid, boolean, text) to authenticated;

-- ------------------------------------------------------------- my_progress
--
-- What the phone reads instead of PlayerPrefs, and what "my history" on the
-- site renders. Returns only the caller's own team.

create or replace function public.my_progress(p_world uuid)
returns table (
  marker_id uuid,
  points    integer,
  solved_at timestamptz,
  solved_by uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select mp.marker_id, mp.points, mp.solved_at, mp.solved_by
  from public.marker_progress mp
  where mp.team_id = public.my_team(p_world)
  order by mp.solved_at;
$$;

revoke all on function public.my_progress(uuid) from public;
grant execute on function public.my_progress(uuid) to authenticated;

-- ------------------------------------------------------------------- RLS

alter table public.marker_progress enable row level security;

drop policy if exists progress_select_own on public.marker_progress;
create policy progress_select_own on public.marker_progress
  for select using (
    public.on_team(team_id)
    or exists (
      select 1 from public.markers m
      where m.id = marker_progress.marker_id
        and public.world_role(m.world_id) in ('owner','editor')
    )
  );

-- No insert, update or delete policies at all. award_progress and review_answer
-- run as the owner and are the only writers.

commit;

-- =============================================================================
-- Verify from outside the dashboard:
--
--   * insert into marker_progress directly as a signed-in player: refused.
--   * select marker_progress for a team you are not on: zero rows.
--   * award_progress called directly by a client: no execute permission.
--   * review_answer as somebody who is not owner or editor: 42501.
--   * answering the same marker twice leaves one row and one lot of points.
-- =============================================================================


-- ###########################################################################
-- 0008_creator_writes.sql
-- ###########################################################################

-- =============================================================================
-- Creator writes — the portal's door
-- =============================================================================
--
-- Until this runs, no client can write a marker at all. Phase 0's development
-- policies let the anon key do anything and 0002 removed them, correctly, but
-- put nothing back: every marker in the database so far was inserted from the
-- SQL editor by hand. That is the ceiling the portal exists to remove.
--
-- The rule is the same one the rest of the schema uses. Not "is this person a
-- creator" - there is no such thing - but "what is this person's role in this
-- particular trail", answered by world_role.
--
-- Safe to run twice.
-- =============================================================================

begin;

-- ------------------------------------------------------------- 1. markers
--
-- Owner and editor may write. A viewer - which is what a join code grants - may
-- not, and reads markers only through markers_near like everybody else.

drop policy if exists markers_select_creator on public.markers;
create policy markers_select_creator on public.markers
  for select using (public.world_role(world_id) in ('owner','editor'));

drop policy if exists markers_insert_creator on public.markers;
create policy markers_insert_creator on public.markers
  for insert with check (public.world_role(world_id) in ('owner','editor'));

drop policy if exists markers_update_creator on public.markers;
create policy markers_update_creator on public.markers
  for update using (public.world_role(world_id) in ('owner','editor'))
  with check (public.world_role(world_id) in ('owner','editor'));

drop policy if exists markers_delete_creator on public.markers;
create policy markers_delete_creator on public.markers
  for delete using (public.world_role(world_id) in ('owner','editor'));

-- A note on why the select policy above does not break the seam: a player's
-- role is 'viewer', which fails every one of these, so a player still cannot
-- select markers and still goes through markers_near. The exception is exactly
-- the person who wrote the row, which is not an exception worth calling one.

-- ------------------------------------------------------ 2. placing a marker
--
-- location is geography(Point, 4326) and PostgREST cannot post one directly, so
-- the portal places markers through this rather than through an insert. It also
-- means one place validates the coordinate, instead of every caller.

create or replace function public.place_marker(
  p_world      uuid,
  p_lat        double precision,
  p_lng        double precision,
  p_content    jsonb   default '{}'::jsonb,
  p_style_key  text    default 'default',
  p_colour_hex text    default null,
  p_step       integer default null,
  p_status     text    default 'draft'
)
returns public.markers
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row public.markers;
begin
  if public.world_role(p_world) not in ('owner','editor') then
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
    (world_id, location, content, style_key, colour_hex, step, status)
  values
    (p_world,
     st_makepoint(p_lng, p_lat)::geography,
     coalesce(p_content, '{}'::jsonb),
     nullif(trim(coalesce(p_style_key, '')), ''),
     p_colour_hex,
     p_step,
     p_status)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.move_marker(
  p_marker uuid,
  p_lat    double precision,
  p_lng    double precision
)
returns public.markers
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_world uuid;
  v_row   public.markers;
begin
  select m.world_id into v_world from public.markers m where m.id = p_marker;

  if v_world is null or public.world_role(v_world) not in ('owner','editor') then
    raise exception 'not yours to edit' using errcode = '42501';
  end if;

  if p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'coordinates out of range' using errcode = 'check_violation';
  end if;

  update public.markers
     set location = st_makepoint(p_lng, p_lat)::geography
   where id = p_marker
  returning * into v_row;

  return v_row;
end;
$$;

-- The portal's own read: every marker in a trail you own, in order, with its
-- coordinates as numbers rather than a geography blob PostgREST will not send.
create or replace function public.trail_markers(p_world uuid)
returns table (
  id          uuid,
  lat         double precision,
  lng         double precision,
  style_key   text,
  colour_hex  text,
  content     jsonb,
  step        integer,
  status      text,
  version     integer,
  answer_kind text,
  points      integer,
  updated_at  timestamptz
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    m.id,
    st_y(m.location::geometry),
    st_x(m.location::geometry),
    m.style_key,
    m.colour_hex,
    m.content,
    m.step,
    m.status,
    m.version,
    a.kind,
    a.points,
    m.updated_at
  from public.markers m
  left join public.marker_answers a on a.marker_id = m.id
  where m.world_id = p_world
    and public.world_role(p_world) in ('owner','editor')
  order by coalesce(m.step, 2147483647), m.created_at;
$$;

revoke all on function public.place_marker(uuid, double precision, double precision, jsonb, text, text, integer, text) from public;
revoke all on function public.move_marker(uuid, double precision, double precision) from public;
revoke all on function public.trail_markers(uuid) from public;

grant execute on function public.place_marker(uuid, double precision, double precision, jsonb, text, text, integer, text) to authenticated;
grant execute on function public.move_marker(uuid, double precision, double precision) to authenticated;
grant execute on function public.trail_markers(uuid) to authenticated;

-- --------------------------------------------------------- 3. making a trail
--
-- worlds_insert_own from 0002 already allows this, but a bare insert leaves the
-- creator to invent a unique join code from the client, which they cannot do
-- without reading the column they are not allowed to read.

create or replace function public.new_join_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_code     text;
  v_tries    integer := 0;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;

    exit when not exists (
      select 1 from public.worlds where upper(join_code) = upper(v_code)
    );

    v_tries := v_tries + 1;
    if v_tries > 50 then
      raise exception 'could not find an unused join code';
    end if;
  end loop;

  return v_code;
end;
$$;

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
  v_row public.worlds;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  -- Anyone with an account may create a trail. It starts private and draft, so
  -- an open door here costs nothing until somebody deliberately publishes.
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'making a trail needs a real account' using errcode = '28000';
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

create or replace function public.rotate_join_code(p_world uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if public.world_role(p_world) <> 'owner' then
    raise exception 'not yours' using errcode = '42501';
  end if;

  v_code := public.new_join_code();
  update public.worlds set join_code = v_code where id = p_world;

  -- Rotating changes the door, not who is already inside. Anyone who has
  -- joined stays joined, which is what makes this safe to do mid-event.
  return v_code;
end;
$$;

revoke all on function public.new_join_code()                     from public;
revoke all on function public.create_world(text, text, text)      from public;
revoke all on function public.rotate_join_code(uuid)              from public;
grant execute on function public.create_world(text, text, text)   to authenticated;
grant execute on function public.rotate_join_code(uuid)           to authenticated;

-- --------------------------------------------------------------- 4. my trails
--
-- Everything this account owns or edits. Counts come from here rather than from
-- four round trips by the client.

create or replace function public.my_worlds()
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
    w.created_at
  from public.worlds w
  join public.world_members m on m.world_id = w.id
  where m.user_id = auth.uid()
    and m.role in ('owner','editor')
  order by w.created_at desc;
$$;

revoke all on function public.my_worlds() from public;
grant execute on function public.my_worlds() to authenticated;

-- ---------------------------------------------------------- 5. the review queue

create or replace function public.review_queue(p_world uuid)
returns table (
  submission_id uuid,
  marker_id     uuid,
  marker_title  jsonb,
  team_name     text,
  submitted     text,
  created_at    timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select s.id, s.marker_id, m.content, t.name, s.submitted, s.created_at
  from public.marker_submissions s
  join public.markers m on m.id = s.marker_id
  join public.teams   t on t.id = s.team_id
  where m.world_id = p_world
    and s.verdict = 'pending_review'
    and public.world_role(p_world) in ('owner','editor')
  order by s.created_at;
$$;

revoke all on function public.review_queue(uuid) from public;
grant execute on function public.review_queue(uuid) to authenticated;

commit;

-- =============================================================================
-- Still open, deliberately not done here:
--
-- 0002 left a policy called temp_anon_read_published_worlds, marked "PHASE 1
-- ONLY, delete in Phase 3, once the app asks for a join code". The app now does
-- ask for one. Removing it is correct and is also a behaviour change to a build
-- that currently works on a real phone, so it belongs in its own migration with
-- a device test either side of it - not buried at the end of this one.
--
-- Verify from outside the dashboard:
--
--   * insert into markers as a viewer: refused.
--   * place_marker into somebody else's trail: 42501.
--   * trail_markers on a trail you only joined: zero rows.
--   * create_world as an anonymous user: 28000.
--   * my_worlds as somebody who owns nothing: zero rows, not an error.
-- =============================================================================


-- ###########################################################################
-- 0009_leaderboard.sql
-- ###########################################################################

-- =============================================================================
-- The leaderboard — the one aggregate that is allowed out
-- =============================================================================
--
-- A board is a deliberate leak. It publishes something about every team to
-- every other team, so what it publishes has to be chosen rather than fall out
-- of a join: a name, a total, a count and a duration. Never which markers, never
-- which answers, never who typed what.
--
-- SECURITY DEFINER, so it can read across teams without a policy that would let
-- clients read across teams for any other purpose.
--
-- Ranking is points first, then elapsed time. Points are what the creator said
-- the trail was worth; time only separates teams the creator's own weighting
-- could not.
--
-- Safe to run twice.
-- =============================================================================

begin;

create or replace function public.world_leaderboard(p_world uuid)
returns table (
  rank            bigint,
  team_id         uuid,
  team_name       text,
  points          bigint,
  stops_solved    bigint,
  started_at      timestamptz,
  last_solve_at   timestamptz,
  elapsed_seconds integer,
  pending         bigint,
  is_mine         boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with visible as (
    -- A board is readable by anyone in the trail, and by anyone at all if the
    -- trail is open. A private trail's standings stay inside it.
    select public.world_role(p_world) is not null
        or public.world_is_open(p_world) as ok
  ),
  scored as (
    select
      t.id,
      t.name,
      t.started_at,
      coalesce(sum(mp.points), 0)                        as points,
      count(mp.marker_id)                                as stops_solved,
      max(mp.solved_at)                                  as last_solve_at,
      (select count(*)
         from public.marker_submissions s
         join public.markers m on m.id = s.marker_id
        where s.team_id = t.id
          and m.world_id = p_world
          and s.verdict = 'pending_review')              as pending
    from public.teams t
    left join public.marker_progress mp on mp.team_id = t.id
    where t.world_id = p_world
    group by t.id, t.name, t.started_at
  )
  select
    rank() over (order by s.points desc,
                          coalesce(extract(epoch from (s.last_solve_at - s.started_at)),
                                   'infinity'::double precision) asc),
    s.id,
    s.name,
    s.points,
    s.stops_solved,
    s.started_at,
    s.last_solve_at,
    case
      when s.started_at is null or s.last_solve_at is null then null
      else extract(epoch from (s.last_solve_at - s.started_at))::integer
    end,
    s.pending,
    public.on_team(s.id)
  from scored s, visible v
  where v.ok
    -- A team that has done nothing is not on the board. It has not started, so
    -- there is nothing to rank and a wall of zeroes reads as a broken page.
    and (s.stops_solved > 0 or s.pending > 0)
  order by 1, s.name;
$$;

revoke all on function public.world_leaderboard(uuid) from public;
grant execute on function public.world_leaderboard(uuid) to anon, authenticated;

-- ------------------------------------------------------------ trail_summary
--
-- What a game's public page shows before anybody has joined: how many stops,
-- how many teams are playing, and whether it is still open. Deliberately says
-- nothing about where the stops are.

create or replace function public.trail_summary(p_world uuid)
returns table (
  id           uuid,
  name         text,
  mode         text,
  status       text,
  visibility   text,
  stop_count   bigint,
  team_count   bigint,
  total_points bigint,
  needs_account boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.id, w.name, w.mode, w.status, w.visibility,
    (select count(*) from public.markers m
      where m.world_id = w.id and m.status = 'published'),
    (select count(*) from public.teams t where t.world_id = w.id),
    (select coalesce(sum(a.points), 0)
       from public.marker_answers a
       join public.markers m2 on m2.id = a.marker_id
      where m2.world_id = w.id and m2.status = 'published'),
    w.mode = 'ctf'
  from public.worlds w
  where w.id = p_world
    and (public.world_role(w.id) is not null or public.world_is_open(w.id));
$$;

revoke all on function public.trail_summary(uuid) from public;
grant execute on function public.trail_summary(uuid) to anon, authenticated;

-- ------------------------------------------------------------- public_trails
--
-- The games list. Only what somebody deliberately published to everybody -
-- unlisted trails are reachable with a code and are not advertised here.

create or replace function public.public_trails()
returns table (
  id           uuid,
  name         text,
  mode         text,
  stop_count   bigint,
  team_count   bigint,
  created_at   timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.id, w.name, w.mode,
    (select count(*) from public.markers m
      where m.world_id = w.id and m.status = 'published'),
    (select count(*) from public.teams t where t.world_id = w.id),
    w.created_at
  from public.worlds w
  where w.visibility = 'public'
    and w.status = 'published'
  order by w.created_at desc
  limit 100;
$$;

revoke all on function public.public_trails() from public;
grant execute on function public.public_trails() to anon, authenticated;

commit;

-- =============================================================================
-- Verify from outside the dashboard:
--
--   * world_leaderboard on a private trail you are not in: zero rows.
--   * the response names no marker and no submission anywhere in its body.
--   * a team with pending review appears, with pending > 0, so nobody is
--     silently missing from a board they are actually on.
--   * public_trails as anon returns only public+published, and never a private
--     trail's name.
-- =============================================================================


-- ###########################################################################
-- 0010_account_data.sql
-- ###########################################################################

-- =============================================================================
-- Take it with you, or take it away
-- =============================================================================
--
-- This platform is aimed partly at school groups in the EU, so it will hold
-- minors' typed answers, timestamps and - through the markers they solved - a
-- fair reconstruction of where they walked and when. Export and delete are
-- features of that, not paperwork about it, and they are cheapest to build now
-- while there are ten tables rather than thirty.
--
-- Both run as the caller's own account and neither takes a user id. A function
-- that accepted one would be a function that could be pointed at somebody else.
--
-- Safe to run twice.
-- =============================================================================

begin;

-- ------------------------------------------------------------ export_my_data
--
-- Everything this person can see about themselves, in one document. Not a
-- summary: the actual submissions, with what was typed and what came back.

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
    'trails_created', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name', w.name, 'mode', w.mode, 'created_at', w.created_at)), '[]'::jsonb)
      from public.worlds w
      where w.owner_id = auth.uid()
    )
  );
$$;

revoke all on function public.export_my_data() from public;
grant execute on function public.export_my_data() to authenticated;

-- --------------------------------------------------------- what a delete costs
--
-- worlds.owner_id cascades from profiles, and markers cascade from worlds. So
-- deleting an account that owns trails deletes those trails and every marker in
-- them, for everybody who had joined them. That is the decision already made in
-- 0002 and it is defensible - a trail with no owner is unmaintainable - but it
-- must be said out loud before the button is pressed, not discovered after.
--
-- This is what the confirmation screen reads from.

create or replace function public.what_delete_removes()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'trails_owned', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'name',    w.name,
               'markers', (select count(*) from public.markers m where m.world_id = w.id),
               'teams',   (select count(*) from public.teams  t where t.world_id = w.id)
             )), '[]'::jsonb)
      from public.worlds w where w.owner_id = auth.uid()
    ),
    'teams_left_behind', (
      -- Teams this person is on that other people are also on. Those survive;
      -- only this membership goes.
      select count(*)
      from public.team_members tm
      where tm.user_id = auth.uid()
        and (select count(*) from public.team_members o where o.team_id = tm.team_id) > 1
    ),
    'submissions', (
      select count(*) from public.marker_submissions where user_id = auth.uid()
    )
  );
$$;

revoke all on function public.what_delete_removes() from public;
grant execute on function public.what_delete_removes() to authenticated;

-- ---------------------------------------------------------- delete_my_account
--
-- Deletes the auth user. Everything else follows the cascades already declared:
-- profiles goes with the user, world_members and team_members go with the
-- profile, worlds owned go with it too, and submissions keep their row with a
-- null author so a team's history does not develop holes.

create or replace function public.delete_my_account()
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

  delete from auth.users where id = v_id;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- ------------------------------------------------------------ 4. my_history
--
-- What "everything about me" renders on the site, and the same thing the app
-- will read once it stops keeping progress in PlayerPrefs.

create or replace function public.my_history()
returns table (
  world_id     uuid,
  world_name   text,
  mode         text,
  role         text,
  team_id      uuid,
  team_name    text,
  stops_solved bigint,
  points       bigint,
  pending      bigint,
  last_activity timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    w.id, w.name, w.mode, m.role,
    t.id, t.name,
    (select count(*) from public.marker_progress mp where mp.team_id = t.id),
    (select coalesce(sum(mp.points), 0) from public.marker_progress mp where mp.team_id = t.id),
    (select count(*)
       from public.marker_submissions s
       join public.markers k on k.id = s.marker_id
      where s.team_id = t.id and k.world_id = w.id and s.verdict = 'pending_review'),
    greatest(
      (select max(mp.solved_at)  from public.marker_progress mp    where mp.team_id = t.id),
      (select max(s.created_at)  from public.marker_submissions s  where s.team_id = t.id)
    )
  from public.world_members m
  join public.worlds w on w.id = m.world_id
  left join public.teams t
    on t.world_id = w.id
   and t.id = public.my_team(w.id)
  where m.user_id = auth.uid()
  order by 11 desc nulls last, w.name;
$$;

revoke all on function public.my_history() from public;
grant execute on function public.my_history() to authenticated;

commit;

-- =============================================================================
-- Verify from outside the dashboard:
--
--   * export_my_data as user A never mentions user B's submissions.
--   * what_delete_removes lists the trails that will go, before anything goes.
--   * delete_my_account as a signed-in user leaves no rows behind referencing
--     them, and their access token stops working on the next call.
--   * neither function takes a user id, so neither can be aimed at anybody.
-- =============================================================================
