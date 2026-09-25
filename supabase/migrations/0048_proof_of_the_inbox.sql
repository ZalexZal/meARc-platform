-- =============================================================================
-- 0048  Proof of the inbox
--
-- 0047 let whoever was signed in as the parent's email answer the request.
-- With email confirmation off - the state of the project until an email
-- service is connected - anybody can make an account with any address, so a
-- child could sign up as their parent and agree to their own request.
--
-- The answer now has to come from a session that was opened by a link sent
-- to that address: a magic link or a one-time code. Supabase writes how a
-- session was signed in into the token (amr), and "password" is not one of
-- the accepted ways. The consent page's own "send me a link" gives exactly
-- such a session, so a real parent loses nothing.
-- =============================================================================

begin;

create or replace function public.signed_in_by_email_link()
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) e
    where e ->> 'method' in ('otp', 'magiclink'));
$$;

revoke all on function public.signed_in_by_email_link() from public, anon;
grant execute on function public.signed_in_by_email_link() to authenticated;

create or replace function public.consents_to_answer()
returns table (child_id uuid, child_name text, requested_at timestamptz,
               granted boolean, answered_at timestamptz, language text)
language sql
stable
security definer
set search_path = public
as $$
  select c.child_id,
         coalesce(nullif(trim(p.display_name), ''), ''),
         c.requested_at, c.granted, c.answered_at, c.language
  from public.parental_consents c
  join public.profiles p on p.id = c.child_id
  where lower(c.parent_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and coalesce(auth.jwt() ->> 'email', '') <> ''
    and public.signed_in_by_email_link()
  order by c.requested_at desc;
$$;

create or replace function public.answer_parent_consent(p_child uuid, p_agree boolean, p_terms_version text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.parental_consents;
begin
  if not public.signed_in_by_email_link() then
    raise exception 'open the link we emailed to answer' using errcode = '42501';
  end if;

  select * into v_row from public.parental_consents
  where child_id = p_child
    and lower(parent_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and coalesce(auth.jwt() ->> 'email', '') <> '';

  if v_row.child_id is null then
    raise exception 'no request for you to answer' using errcode = 'P0001';
  end if;

  if not coalesce(p_agree, false) then
    perform public.erase_user(p_child);
    return 'erased';
  end if;

  update public.parental_consents
     set granted = true, answered_at = now(), answered_by = auth.uid(),
         terms_version = p_terms_version
   where child_id = p_child;

  return 'granted';
end;
$$;

create or replace function public.withdraw_parent_consent(p_child uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.signed_in_by_email_link() then
    raise exception 'open the link we emailed to answer' using errcode = '42501';
  end if;

  if not exists (select 1 from public.parental_consents
                 where child_id = p_child
                   and lower(parent_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
                   and coalesce(auth.jwt() ->> 'email', '') <> '') then
    raise exception 'no request for you to answer' using errcode = 'P0001';
  end if;

  perform public.erase_user(p_child);
  return 'erased';
end;
$$;

-- The parent's own row of the table: the same proof, or they could read which
-- children named their address before opening any link.
drop policy parental_consents_select on public.parental_consents;
create policy parental_consents_select on public.parental_consents
  for select using (
    child_id = auth.uid()
    or (lower(parent_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        and public.signed_in_by_email_link()));

commit;
