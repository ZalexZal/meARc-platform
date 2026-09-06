-- 0023 - codes nobody can guess
--
-- Both codes were already random six-character strings from an alphabet with
-- no 0/O and no 1/I/L, so they survive being read aloud across a room. What
-- they were NOT is unpredictable: random() is a seeded PRNG shared by the
-- whole session, so codes made one after another come from one stream, and a
-- stream that anyone can observe the output of is a stream they can continue.
--
-- A team code is a credential. Guess one and you are on somebody's team,
-- scoring into their column. So it comes from gen_random_bytes now, with the
-- top eight byte values thrown away rather than folded in - 256 does not
-- divide by 31, and taking the remainder would make the first eight letters
-- of the alphabet slightly likelier than the rest.
--
-- Six characters out of 31 is 887 million, which is not a lot against a
-- machine but is a great deal against join_team, which needs one HTTP round
-- trip per guess and answers only signed-in callers.

create or replace function public.random_code(p_len integer default 6)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  -- No 0/O, no 1/I/L: the code gets read out loud and typed by somebody else.
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_size     constant int  := length(v_alphabet);
  v_ceiling  constant int  := 256 - (256 % v_size);   -- 248
  v_out      text := '';
  v_bytes    bytea;
  v_byte     int;
begin
  while length(v_out) < p_len loop
    -- A handful at a time. Asking for one byte per letter would be six calls
    -- into the entropy source for a six-letter code, and roughly one byte in
    -- thirty-two gets thrown away anyway.
    v_bytes := extensions.gen_random_bytes(p_len * 2);

    for i in 0 .. p_len * 2 - 1 loop
      exit when length(v_out) >= p_len;

      v_byte := get_byte(v_bytes, i);
      continue when v_byte >= v_ceiling;

      v_out := v_out || substr(v_alphabet, 1 + (v_byte % v_size), 1);
    end loop;
  end loop;

  return v_out;
end;
$$;

create or replace function public.new_team_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code  text;
  v_tries integer := 0;
begin
  loop
    v_code := public.random_code(6);
    exit when not exists (select 1 from public.teams where invite_code = v_code);

    v_tries := v_tries + 1;
    if v_tries > 50 then
      raise exception 'could not find an unused team code';
    end if;
  end loop;

  return v_code;
end;
$$;

create or replace function public.new_join_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code  text;
  v_tries integer := 0;
begin
  loop
    -- Lower case, because a trail code is printed on a worksheet and a team
    -- code is said out loud; keeping them visibly different is how somebody
    -- stops typing one into the box meant for the other.
    v_code := lower(public.random_code(6));
    exit when not exists (
      select 1 from public.worlds where upper(join_code) = upper(v_code)
    );

    v_tries := v_tries + 1;
    if v_tries > 50 then
      raise exception 'could not find an unused join code';
    end if;
  end loop;

  return v_code;
end;
$$;

-- Nobody calls these from a client. They exist to be called by create_world,
-- create_team and rotate_join_code, which are the things that check who you
-- are first.
revoke all on function public.random_code(integer)  from public;
revoke all on function public.new_team_code()       from public;
revoke all on function public.new_join_code()       from public;

notify pgrst, 'reload schema';
