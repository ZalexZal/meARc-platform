-- 0059 - answers from the website, marked for the organiser
--
-- Design: docs/superpowers/specs/2026-10-30-web-lite-design.md, part 4. The
-- website can walk a trail too (web lite). A browser cannot say whether its
-- position is faked the way Android does, so answers sent from it are kept
-- with source 'web' and the organiser sees how many each team sent that way.
-- They count the same; it is information, not a penalty.
--
-- check_answer gains p_source ('app' unless said), kept on marker_submissions;
-- world_web_answers gives the organiser the count per team.
--
-- Safe to run twice.

begin;

alter table public.marker_submissions add column if not exists source text not null default 'app';
alter table public.marker_submissions drop constraint if exists marker_submissions_source_known;
alter table public.marker_submissions add constraint marker_submissions_source_known
  check (source in ('app', 'web'));

do $$
declare d text; n text;
begin
  select pg_get_functiondef('public.check_answer(uuid, text, double precision, double precision, double precision, boolean)'::regprocedure)
    into d;
  n := replace(d, 'p_mock boolean DEFAULT NULL::boolean)',
                  'p_mock boolean DEFAULT NULL::boolean, p_source text DEFAULT ''app''::text)');
  if n = d then raise exception 'check_answer: signature anchor not found'; end if;
  d := n;
  n := replace(d, E'(marker_id, team_id, user_id, submitted, verdict)',
                  E'(marker_id, team_id, user_id, submitted, verdict, source)');
  if n = d then raise exception 'check_answer: insert columns anchor not found'; end if;
  d := n;
  n := replace(d, E'(p_marker, v_team, auth.uid(), coalesce(p_submitted, ''''), v_verdict);',
                  E'(p_marker, v_team, auth.uid(), coalesce(p_submitted, ''''), v_verdict,\n     case when p_source = ''web'' then ''web'' else ''app'' end);');
  if n = d then raise exception 'check_answer: insert values anchor not found'; end if;
  drop function public.check_answer(uuid, text, double precision, double precision, double precision, boolean);
  execute n;
end $$;

revoke all on function public.check_answer(uuid, text, double precision, double precision, double precision, boolean, text) from public, anon;
grant execute on function public.check_answer(uuid, text, double precision, double precision, double precision, boolean, text) to authenticated;

create or replace function public.world_web_answers(p_world uuid)
returns table (team_id uuid, web bigint, total bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.can_moderate(p_world) then
    raise exception 'not yours' using errcode = '42501';
  end if;
  return query
  select s.team_id, count(*) filter (where s.source = 'web'), count(*)
  from public.marker_submissions s
  join public.teams t on t.id = s.team_id
  where t.world_id = p_world
  group by s.team_id;
end;
$$;

revoke all on function public.world_web_answers(uuid) from public, anon;
grant execute on function public.world_web_answers(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
