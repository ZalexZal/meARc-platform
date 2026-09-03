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
