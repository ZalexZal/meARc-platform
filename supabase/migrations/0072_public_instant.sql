-- NOT APPLIED - the controller applies it (node tools/apply-0072.mjs).
--
-- 0072 - two ways to share a trail, and "public" is instant (12 Nov 2026)
--
-- Until now a trail had three rungs: only me (private + draft), with the code
-- (unlisted + published) and public, which was a request that a reviewer had to
-- grant. Alex took the first and the last away:
--
--   * "Only me" is gone. A trail is shared with its code from the moment it is
--     made, and the stops that are still drafts are simply not sent to walkers.
--   * "Make it public" lists the trail at once, for everyone to find. The
--     owner's own call, with no review queue in between.
--
-- What this file does
--
--   1. Moves every trail that was private or draft to the code level
--      (visibility 'unlisted', status 'published'). Every trail already has a
--      join_code (the column is not null); a blank one would be given a new
--      code here. Trails that a moderator archived are left alone.
--   2. Queued rows (status 'submitted'): APPROVED here. The owner asked for the
--      public rung, and the rung is now instant, so leaving them in limbo would
--      keep the one "waiting" state alive for no reason. decide_listing,
--      listing_queue and the review page stay exactly as they are.
--   3. make_public(p_world): the owner's RPC. Owner only; the trail needs at
--      least one finished stop and no stop left as a draft; then
--      visibility = 'public', status = 'published' straight away.
--      request_listing(p_world) now does the same (it calls make_public), so an
--      older client that still calls it gets the instant behaviour.
--      make_code(p_world): back to the code level, which unlists it at once.
--   4. New trails start at the code level: create_world inserts
--      'unlisted' / 'published', and the column defaults say the same, so any
--      other insert path agrees.
--
-- Safe to run twice.
--
-- Undo (run in one transaction): there is nothing to restore for the moved rows
-- (they were the creator's "only me" trails; put one back by hand with
--   update public.worlds set visibility = 'private', status = 'draft' where id = ...).
--   alter table public.worlds alter column visibility set default 'private';
--   alter table public.worlds alter column status set default 'draft';
--   drop function public.make_public(uuid); drop function public.make_code(uuid);
--   then re-create request_listing and create_world from 0018 and 0067.

begin;

-- ------------------------------------------------- 1. "Only me" becomes the code

update public.worlds
   set visibility = 'unlisted',
       status     = 'published'
 where status <> 'archived'
   and (visibility = 'private' or status = 'draft');

update public.worlds
   set join_code = public.new_join_code()
 where join_code is null or btrim(join_code) = '';

-- ------------------------------------------------- 2. the queue is emptied

update public.worlds
   set visibility  = 'public',
       status      = 'published',
       review_note = null
 where status = 'submitted';

-- ------------------------------------------------- 3. going public, instantly

create or replace function public.make_public(p_world uuid)
returns public.worlds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.worlds;
begin
  -- Owner only, not editor: putting a trail in front of everybody is the
  -- owner's call, as it was for request_listing.
  if public.world_role(p_world) is distinct from 'owner' then
    raise exception 'only the owner can make a trail public' using errcode = '42501';
  end if;

  if not exists (select 1 from public.markers m
                  where m.world_id = p_world and m.status = 'published') then
    raise exception 'a trail needs at least one finished stop before it can be public'
      using errcode = 'check_violation';
  end if;

  -- A draft stop is never sent to a walker, so a public trail with one would be
  -- missing a stop for everybody who finds it.
  if exists (select 1 from public.markers m
              where m.world_id = p_world and m.status = 'draft') then
    raise exception 'finish every stop before making the trail public'
      using errcode = 'check_violation';
  end if;

  update public.worlds
     set visibility  = 'public',
         status      = 'published',
         review_note = null
   where id = p_world
     and status <> 'archived'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'no such trail' using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

revoke all on function public.make_public(uuid) from public, anon;
grant execute on function public.make_public(uuid) to authenticated, service_role;

-- The old name, kept for any client that still calls it: same answer, no queue.
create or replace function public.request_listing(p_world uuid)
returns public.worlds
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.make_public(p_world);
end;
$$;

revoke all on function public.request_listing(uuid) from public, anon;
grant execute on function public.request_listing(uuid) to authenticated, service_role;

-- Back to the code: still opens for anybody who has it, no longer in the lists.
create or replace function public.make_code(p_world uuid)
returns public.worlds
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.worlds;
begin
  if public.world_role(p_world) is distinct from 'owner' then
    raise exception 'only the owner can change who can find a trail' using errcode = '42501';
  end if;

  update public.worlds
     set visibility = 'unlisted',
         status     = 'published'
   where id = p_world
     and status <> 'archived'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'no such trail' using errcode = 'P0001';
  end if;

  return v_row;
end;
$$;

revoke all on function public.make_code(uuid) from public, anon;
grant execute on function public.make_code(uuid) to authenticated, service_role;

-- ------------------------------------------------- 4. new trails start at the code

alter table public.worlds alter column visibility set default 'unlisted';
alter table public.worlds alter column status     set default 'published';

create or replace function public.create_world(
  p_name     text,
  p_mode     text default 'guide'::text,
  p_language text default 'bg'::text,
  p_category text default null
)
returns public.worlds
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row   public.worlds;
  v_today integer;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  -- Anyone with an account may create a trail. It starts at the code level:
  -- open only to people who are given the code, and not listed anywhere until
  -- its owner makes it public.
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'making a trail needs a real account' using errcode = '28000';
  end if;

  select count(*) into v_today
  from public.worlds w
  where w.owner_id = auth.uid()
    and w.created_at > now() - interval '1 day';

  if v_today >= 20 then
    raise exception 'that is 20 trails in a day - stopping here in case something is looping'
      using errcode = 'check_violation';
  end if;

  insert into public.worlds
    (owner_id, name, join_code, mode, default_language, visibility, status, category)
  values
    (auth.uid(), trim(p_name), public.new_join_code(), p_mode, p_language,
     'unlisted', 'published', coalesce(p_category, 'other'))
  returning * into v_row;

  -- The on_world_created trigger from 0002 makes the owner a member.
  return v_row;
end;
$function$;

revoke all on function public.create_world(text, text, text, text) from public;
grant execute on function public.create_world(text, text, text, text) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
