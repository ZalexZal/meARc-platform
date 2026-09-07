-- 0030 - a hint ladder is climbed from the bottom
--
-- reveal_hint would open any hint on a marker, in any order. A creator writes
-- three of them as a ladder - a nudge, then a stronger nudge, then most of the
-- answer - and prices them accordingly, cheap at the top and dear at the
-- bottom. Opening the third one first buys the answer at the price of a hint
-- and skips the two that were meant to make it unnecessary.
--
-- So the ladder is climbed from the bottom: a hint opens only when everything
-- ordered before it on the same marker is already open. Same reasoning as the
-- ordered trail in 0028, and enforced in the same place - a rule the app draws
-- but the server does not check is not a rule.
--
-- Safe to run twice.

begin;

create or replace function public.reveal_hint(p_hint uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker uuid;
  v_world  uuid;
  v_team   uuid;
  v_body   jsonb;
  v_cost   integer;
  v_ord    integer;
  v_before integer;
begin
  select h.marker_id, h.body, h.cost, h.ord
    into v_marker, v_body, v_cost, v_ord
  from public.marker_hints h where h.id = p_hint;

  if v_marker is null then
    raise exception 'no such hint' using errcode = 'no_data_found';
  end if;

  select m.world_id into v_world from public.markers m where m.id = v_marker;

  if public.world_role(v_world) is null then
    raise exception 'not a member of this trail' using errcode = '42501';
  end if;

  -- A guide has no hints at all - marker_detail already returns none there, and
  -- reveal_hint would otherwise be a way round that by id.
  if not public.mode_is_scored((select w.mode from public.worlds w where w.id = v_world)) then
    raise exception 'this trail is a guide, not a game' using errcode = '42501';
  end if;

  v_team := public.ensure_team(v_world);

  -- The ones before it on this marker, still shut.
  select count(*) into v_before
  from public.marker_hints h
  where h.marker_id = v_marker
    and h.ord < v_ord
    and not exists (
      select 1 from public.hint_reveals r
      where r.hint_id = h.id and r.team_id = v_team);

  if v_before > 0 then
    raise exception 'open the earlier hints first' using errcode = 'P0001';
  end if;

  insert into public.hint_reveals (team_id, hint_id, user_id)
  values (v_team, p_hint, auth.uid())
  on conflict (team_id, hint_id) do nothing;

  return jsonb_build_object('body', v_body, 'cost', v_cost,
                            'points_left', public.points_after_hints(v_team, v_marker));
end;
$$;

revoke all on function public.reveal_hint(uuid) from public, anon;
grant execute on function public.reveal_hint(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
