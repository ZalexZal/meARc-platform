-- 0033 - a team is told what was done to them
--
-- 0032 gave a moderator three levers and made every pull of one leave a row
-- naming who did it and why. The team on the receiving end could read that row
-- from the moment it was written - the policy allows it - and nothing in the app
-- ever asked for it. Which makes it the same shape of fault as the reports, the
-- marker colours and the hints before it: finished on the server, invisible to
-- the person it was written for.
--
-- Two things go into my_team_detail, which the team card already calls:
--
--   adjustments   what was added or taken, and the sentence explaining it
--   disqualified  whether they are off the board, and why
--
-- The second is not decoration. A disqualified team opens their card, sees the
-- leaderboard beside it, and cannot find themselves on it. Without a line
-- saying so that reads as the app being broken, and on the day it becomes an
-- argument with a moderator about whether the phone is lying.
--
-- points now means the same number the board shows - earned, plus what a
-- moderator moved, floored at nothing. A card that says 100 next to a board
-- that says 75 is worse than either number alone. What was earned is kept
-- alongside it as `earned`, so the card can show the arithmetic rather than
-- just the answer.
--
-- Safe to run twice.

begin;

create or replace function public.my_team_detail(p_world uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_team uuid;
  v_row  public.teams;
  v_cap  integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select coalesce(w.team_size, 4) into v_cap from public.worlds w where w.id = p_world;

  v_team := public.my_team(p_world);

  -- Not on a team is a normal answer, not an error. The screen that asks this
  -- is the screen that offers to make one - and it needs the cap either way,
  -- because it says how many people a team holds before you make one.
  if v_team is null then
    return jsonb_build_object('on_team', false, 'max_size', coalesce(v_cap, 4));
  end if;

  select * into v_row from public.teams where id = v_team;

  return jsonb_build_object(
    'on_team', true,
    'id',      v_row.id,
    'name',    v_row.name,
    'invite_code', v_row.invite_code,
    'started_at',  v_row.started_at,
    'max_size', coalesce(v_cap, 4),
    'members', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'name', coalesce(nullif(trim(p.display_name), ''), 'Player'),
                 'is_me', tm.user_id = auth.uid()
               ) order by tm.joined_at)
        from public.team_members tm
        left join public.profiles p on p.id = tm.user_id
       where tm.team_id = v_team), '[]'::jsonb),
    'solved', (select count(*) from public.marker_progress mp
                where mp.team_id = v_team and not mp.skipped),
    -- What the board says, so the two agree.
    'points', greatest(
      (select coalesce(sum(mp.points), 0) from public.marker_progress mp
        where mp.team_id = v_team)
      + (select coalesce(sum(a.points), 0) from public.team_adjustments a
          where a.team_id = v_team), 0),
    -- And what they walked for, kept apart so the card can show its working.
    'earned', (select coalesce(sum(mp.points), 0) from public.marker_progress mp
                where mp.team_id = v_team),
    'adjustments', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'points', a.points,
                 'reason', a.reason,
                 'at',     a.created_at
               ) order by a.created_at)
        from public.team_adjustments a
       where a.team_id = v_team), '[]'::jsonb),
    'disqualified', v_row.disqualified_at is not null,
    'disqualified_reason', v_row.disqualified_reason
  );
end;
$$;

revoke all on function public.my_team_detail(uuid) from public;
grant execute on function public.my_team_detail(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
