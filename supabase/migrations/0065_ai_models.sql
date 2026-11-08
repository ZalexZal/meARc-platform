-- 0065 - AI models through our server, when the free browser route is used up
-- (7 Nov 2026).
--
-- Photo -> 3D runs first in the creator's browser on Hugging Face's free
-- anonymous GPU allowance. When that is refused, the ai3d Edge Function asks
-- again with AR Trail's own Hugging Face token (in Vault as 'hf_token'). That
-- allowance is shared by everyone, so each person gets a few a day.
--
-- Undo: alter table public.ai_usage drop column models; drop function
-- public.ai_count_model().

begin;

alter table public.ai_usage add column if not exists models integer not null default 0;

create or replace function public.ai_count_model()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    return false;
  end if;

  insert into public.ai_usage (user_id, day, models)
       values (auth.uid(), (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day)
       do update set models = public.ai_usage.models + 1
  returning models into v_count;

  return v_count <= 5;
end;
$$;

revoke all on function public.ai_count_model() from public, anon;
grant execute on function public.ai_count_model() to authenticated;

commit;
