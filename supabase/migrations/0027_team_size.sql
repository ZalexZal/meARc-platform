-- 0027 - the creator decides how big a team is
--
-- Four was hard-coded in the membership trigger, with a comment saying it was
-- the number both reference events use and the number that fits round one phone
-- at a marker. Both true, and neither is the creator's business to be told: a
-- class split into pairs and a family walking together want different numbers,
-- and the person who knows which is the person who made the trail.
--
-- One to twelve. The lower bound is a real choice - a trail of solo walkers is
-- a legitimate thing to run - and the upper one is there so a typo cannot make
-- a five-hundred-person team out of a stray keystroke. Existing trails keep
-- four, which is what they have been running with.
--
-- Safe to run twice.

begin;

alter table public.worlds
  add column if not exists team_size integer not null default 4;

alter table public.worlds drop constraint if exists worlds_team_size;
alter table public.worlds
  add constraint worlds_team_size check (team_size between 1 and 12);

comment on column public.worlds.team_size is
  'How many people may be on one team here. Enforced by team_membership_guard, '
  'not by any client.';

-- The guard, reading the trail instead of a constant.
create or replace function public.team_membership_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_world   uuid;
  v_cap     integer;
  v_size    integer;
  v_clashes integer;
begin
  select t.world_id into v_world
  from public.teams t
  where t.id = new.team_id;

  -- The trail's own number. coalesce for a team whose world vanished under it,
  -- which should not happen and is not worth a different error than "full".
  select coalesce(w.team_size, 4) into v_cap
  from public.worlds w
  where w.id = v_world;

  select count(*) into v_size
  from public.team_members
  where team_id = new.team_id;

  if v_size >= coalesce(v_cap, 4) then
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
    raise exception 'already on a team here' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- The phone needs the number too, or its "team full" greying is a guess.
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
    'points', (select coalesce(sum(mp.points), 0) from public.marker_progress mp
                where mp.team_id = v_team)
  );
end;
$$;

commit;

notify pgrst, 'reload schema';
