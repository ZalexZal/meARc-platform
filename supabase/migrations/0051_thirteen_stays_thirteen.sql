-- 0051: an account that said "13" stays 13.
--
-- accept_terms took any new answer to the age question, so a 13-year-old
-- could accept the terms again as "14 or older" and walk past the parent -
-- even after the parent had said no. The consent would be decoration.
--
-- Now the answer only ever moves towards more protection: '14+' can become
-- 'under14', never back. A slip is corrected by the operator on request
-- (Supabase dashboard, profiles.age_band), after asking the account holder.
-- A 13-year-old who turns 14 keeps the parent's agreement until then; that
-- errs on the careful side.

create or replace function public.accept_terms(p_version text, p_under14 boolean default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set terms_accepted_at = now(),
         terms_version     = p_version,
         age_band          = case when p_under14 is null then age_band
                                  when p_under14 or age_band = 'under14' then 'under14'
                                  else '14+' end
   where id = auth.uid();
$$;

revoke all on function public.accept_terms(text, boolean) from public, anon;
grant execute on function public.accept_terms(text, boolean) to authenticated;
