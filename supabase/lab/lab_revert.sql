-- Undo every lab change to the database (overnight experiment, 4-5 Nov 2026).
begin;
drop function if exists public.lab_trail_code_for_team(text);
commit;
notify pgrst, 'reload schema';
