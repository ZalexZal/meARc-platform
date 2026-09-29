-- 0053  A name is a name
--
-- Found on the phone: the You tab said "ZalexZal" and the team card and board
-- said "Player". The account keeps the name in two places - the auth user's
-- metadata, which the app's profile screen reads, and profiles.display_name,
-- which ensure_team, my_team_detail and every board read - and nothing made
-- the second follow the first. handle_new_user copied whether the account is
-- a guest and nothing else, so a name given at sign-up (or while upgrading a
-- guest in place) reached the profile only if the client also wrote it there,
-- which clients built before 6 September did not.
--
-- So the server copies it: on creation, and whenever the metadata name
-- changes. A name typed into the profile directly still wins, because this
-- only runs when the metadata changes. And the accounts already stranded are
-- filled in once.
--
-- Safe to run twice.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- to_jsonb rather than new.is_anonymous directly: the column arrived in a
  -- Supabase update, and reading it through jsonb returns null instead of
  -- failing the whole trigger on a project that predates it.
  insert into public.profiles (id, is_anonymous, display_name)
  values (new.id,
          coalesce((to_jsonb(new) ->> 'is_anonymous')::boolean, false),
          left(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 40))
  on conflict (id) do nothing;

  return new;
end;
$$;

create or replace function public.follow_metadata_name()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := left(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 40);
begin
  if v_name is not null
     and v_name is distinct from left(nullif(btrim(old.raw_user_meta_data ->> 'display_name'), ''), 40) then
    update public.profiles set display_name = v_name where id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.follow_metadata_name() from public, anon, authenticated;

drop trigger if exists follow_metadata_name on auth.users;
create trigger follow_metadata_name
  after update of raw_user_meta_data on auth.users
  for each row execute function public.follow_metadata_name();

-- The accounts already stranded.
update public.profiles p
   set display_name = left(btrim(u.raw_user_meta_data ->> 'display_name'), 40)
  from auth.users u
 where u.id = p.id
   and coalesce(btrim(p.display_name), '') = ''
   and coalesce(btrim(u.raw_user_meta_data ->> 'display_name'), '') <> '';

commit;
