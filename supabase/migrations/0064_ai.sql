-- 0064 - AI in the builder: translation and models made by AI (7 Nov 2026)
--
-- 1. The Gemini key for the translate Edge Function lives in Supabase Vault
--    (put there by tools/set-ai-keys.mjs, never in a file in the repo, the
--    site or a deploy panel). ai_secret() hands it to the service role only:
--    the Edge Function asks with the service key it is given by Supabase.
-- 2. ai_usage counts each person's translations per day, so one account
--    cannot spend the shared free Gemini quota for everyone.
-- 3. A model can now be made by AI (TRELLIS.2 from a photo or a description,
--    run in the creator's browser): credit_source 'ai', and ai_source says
--    which model made it.
--
-- Undo: drop function public.ai_secret(text), public.ai_count_translation();
-- drop table public.ai_usage; alter table public.marker_models drop column
-- ai_source; restore marker_models_credit_source_check to ('own','other').

begin;

-- ------------------------------------------------------------------ the key
create or replace function public.ai_secret(p_name text)
returns text
language sql
stable
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1;
$$;

revoke all on function public.ai_secret(text) from public, anon, authenticated;
grant execute on function public.ai_secret(text) to service_role;

-- ---------------------------------------------------------- daily allowance
create table if not exists public.ai_usage (
  user_id      uuid not null references auth.users(id) on delete cascade,
  day          date not null default (now() at time zone 'utc')::date,
  translations integer not null default 0,
  primary key (user_id, day)
);

alter table public.ai_usage enable row level security;

drop policy if exists ai_usage_own on public.ai_usage;
create policy ai_usage_own on public.ai_usage
  for select to authenticated using (user_id = auth.uid());

grant select on public.ai_usage to authenticated;

-- Counts one translation for the caller and says whether it is allowed.
-- Called by the Edge Function with the caller's own token, so auth.uid() is
-- the person asking. 100 a day is far more than a trail needs.
create or replace function public.ai_count_translation()
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

  insert into public.ai_usage (user_id, day, translations)
       values (auth.uid(), (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day)
       do update set translations = public.ai_usage.translations + 1
  returning translations into v_count;

  return v_count <= 100;
end;
$$;

revoke all on function public.ai_count_translation() from public, anon;
grant execute on function public.ai_count_translation() to authenticated;

-- ------------------------------------------------------------ AI-made models
alter table public.marker_models add column if not exists ai_source text
  check (ai_source is null or ai_source in ('trellis2'));

alter table public.marker_models drop constraint if exists marker_models_credit_source_check;
alter table public.marker_models
  add constraint marker_models_credit_source_check
  check (credit_source in ('own', 'other', 'ai'));

-- An AI model needs no author, licence or link (TRELLIS.2 is MIT; the result
-- is the creator's), but it must say which AI made it.
alter table public.marker_models drop constraint if exists marker_models_credit_given;
alter table public.marker_models
  add constraint marker_models_credit_given check (
    credit_source = 'own'
    or (credit_source = 'ai' and ai_source is not null)
    or (credit_author is not null and credit_licence is not null and credit_link is not null)
  );

commit;
