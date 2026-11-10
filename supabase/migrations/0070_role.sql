-- 0070 - creator or viewer (10 Nov 2026)
--
--   * profiles.role  how the person uses AR Trail: creator or viewer.
--                    Null means "not asked yet"; nobody is back-filled, so
--                    every existing user sees the choose-role screen once.
--
-- role is a preference that hides things in the clients, not a permission: no
-- function refuses anybody because of it (viewers can still join any trail
-- with a code, creators can still walk trails).
--
-- Grants: none needed. profiles has table-level UPDATE for anon and
-- authenticated (information_schema.column_privileges lists every column,
-- work included, with no per-column ACL), and profiles_update_own limits
-- updates to the user's own row, so role is updatable by its owner like work.
--
-- handle_new_user is the 0067 version plus one more column: a valid
-- raw_user_meta_data->>'role' is copied, anything else is dropped to null.
--
-- Undo (run in one transaction):
--   alter table public.profiles drop column role;
--   then restore handle_new_user to its 0067 body, which was:
--
--   create or replace function public.handle_new_user() returns trigger
--    language plpgsql security definer set search_path to 'public'
--   as $function$
--   begin
--     -- to_jsonb rather than new.is_anonymous directly: the column arrived in a
--     -- Supabase update, and reading it through jsonb returns null instead of
--     -- failing the whole trigger on a project that predates it.
--     -- work comes from the sign-up form; anything but the four known values is
--     -- dropped to null rather than failing the sign-up.
--     insert into public.profiles (id, is_anonymous, display_name, work)
--     values (new.id,
--             coalesce((to_jsonb(new) ->> 'is_anonymous')::boolean, false),
--             left(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 40),
--             case when new.raw_user_meta_data ->> 'work' in ('broker', 'teacher', 'guide', 'other')
--                  then new.raw_user_meta_data ->> 'work' end)
--     on conflict (id) do nothing;
--
--     return new;
--   end;
--   $function$;
--   (its grants are unchanged: service_role only, nothing to PUBLIC)

begin;

alter table public.profiles
  add column role text,
  add constraint profiles_role_check check (role is null or role in ('creator', 'viewer'));

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- to_jsonb rather than new.is_anonymous directly: the column arrived in a
  -- Supabase update, and reading it through jsonb returns null instead of
  -- failing the whole trigger on a project that predates it.
  -- work and role come from the sign-up form; anything but the known values is
  -- dropped to null rather than failing the sign-up.
  insert into public.profiles (id, is_anonymous, display_name, work, role)
  values (new.id,
          coalesce((to_jsonb(new) ->> 'is_anonymous')::boolean, false),
          left(nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''), 40),
          case when new.raw_user_meta_data ->> 'work' in ('broker', 'teacher', 'guide', 'other')
               then new.raw_user_meta_data ->> 'work' end,
          case when new.raw_user_meta_data ->> 'role' in ('creator', 'viewer')
               then new.raw_user_meta_data ->> 'role' end)
  on conflict (id) do nothing;

  return new;
end;
$function$;

commit;
