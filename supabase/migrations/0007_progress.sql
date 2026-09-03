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
