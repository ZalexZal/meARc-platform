-- =============================================================================
-- What a stop needs that it did not have: a radius, hints, media, a cooldown,
-- an afterword, and choice questions that can actually be answered
-- =============================================================================
--
-- Written after looking at the builder behind ctf.myedulink.eu, which runs this
-- format in this city and has the fields a person actually reaches for.
--
-- Six things, and one of them was a plain bug.
--
-- 1. **Multiple choice had no options.** The editor let a creator pick "multiple
--    choice" and set a correct index, and there was nowhere to type what the
--    options were. The question type was unusable. Options are per language and
--    go in markers.content, because a player has to read them - only which one
--    is right stays behind.
--
-- 2. **More than one option may be correct.** correct_choice held a single
--    index. It becomes correct_choices, an array, and the team must select the
--    whole set.
--
-- 3. **A radius.** How close you have to be before the stop opens. Their note is
--    worth keeping: the circles of two neighbouring stops must not overlap, or
--    a walker standing between them opens both.
--
-- 4. **The afterword.** Shown once the answer is right, while the team walks on.
--    It does NOT go in markers.content: content travels through markers_near
--    and would be on the phone before the stop was solved, which for anything
--    that hints at the answer is the same leak markers_near exists to prevent.
--    It lives with the answer and comes back from check_answer on a correct
--    verdict.
--
-- 5. **A cooldown after a wrong answer.** Without one, four options are a
--    ten-second brute force. Per marker, defaulting to 60 seconds on checked
--    questions and 0 on free text - where every spelling would otherwise cost a
--    minute for no gain, since a human is deciding anyway.
--
-- 6. **Hints, with a price.** A hint costs points off that stop, never below
--    zero, and which hints a team opened is recorded so the cost is charged
--    once and the score can be explained afterwards.
--
-- Safe to run twice.
-- =============================================================================

begin;

-- ------------------------------------------------------------ 1. the radius

alter table public.markers
  add column if not exists radius_m integer not null default 100
    check (radius_m between 5 and 2000);

comment on column public.markers.radius_m is
  'How close a walker must be for this stop to open. The circles of two '
  'neighbouring stops should not overlap, or standing between them opens both.';

-- --------------------------------------------- 2. the answer gains four things

alter table public.marker_answers
  add column if not exists correct_choices integer[] not null default '{}',
  add column if not exists cooldown_seconds integer not null default 60
    check (cooldown_seconds between 0 and 3600),
  -- Per language, like every other piece of writing here.
  add column if not exists after_text jsonb not null default '{}'::jsonb;

-- Carry across anything written under the single-index column before this ran.
update public.marker_answers
   set correct_choices = array[correct_choice]
 where correct_choice is not null
   and coalesce(array_length(correct_choices, 1), 0) = 0;

-- The old shape constraint named correct_choice and would reject every row
-- written from now on.
alter table public.marker_answers drop constraint if exists marker_answers_shape;

alter table public.marker_answers
  add constraint marker_answers_shape check (
    (kind = 'exact'  and array_length(accepted, 1) >= 1)
    or (kind = 'choice' and array_length(correct_choices, 1) >= 1)
    or (kind = 'free')
  );

-- ------------------------------------------------------------------ 3. hints
--
-- Read through reveal_hint, never selected directly: a hint a player can read
-- for free is not a hint that costs points.

create table if not exists public.marker_hints (
  id         uuid primary key default gen_random_uuid(),
  marker_id  uuid not null references public.markers(id) on delete cascade,
  ord        integer not null default 1,
  -- { "bg": "...", "en": "..." }
  body       jsonb not null default '{}'::jsonb,
  cost       integer not null default 0 check (cost between 0 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists marker_hints_marker_idx on public.marker_hints (marker_id, ord);

-- Which team opened which hint. The cost is charged once, and a score that
-- looks wrong later can be explained from this.
create table if not exists public.hint_reveals (
  team_id    uuid not null references public.teams(id)         on delete cascade,
  hint_id    uuid not null references public.marker_hints(id)  on delete cascade,
  user_id    uuid references public.profiles(id) on delete set null,
  revealed_at timestamptz not null default now(),
  primary key (team_id, hint_id)
);

alter table public.marker_hints enable row level security;
alter table public.hint_reveals enable row level security;

-- The creator sees their own hints, to write them. Nobody else selects this
-- table at all - a player goes through reveal_hint.
drop policy if exists hints_select_creator on public.marker_hints;
create policy hints_select_creator on public.marker_hints
  for select using (
    exists (select 1 from public.markers m
            where m.id = marker_hints.marker_id and public.may_edit(m.world_id))
  );

drop policy if exists hints_write_creator on public.marker_hints;
create policy hints_write_creator on public.marker_hints
  for all using (
    exists (select 1 from public.markers m
            where m.id = marker_hints.marker_id and public.may_edit(m.world_id))
  ) with check (
    exists (select 1 from public.markers m
            where m.id = marker_hints.marker_id and public.may_edit(m.world_id))
  );

drop policy if exists reveals_select_own on public.hint_reveals;
create policy reveals_select_own on public.hint_reveals
  for select using (public.on_team(team_id));

-- ------------------------------------------------------------------ 4. media

create table if not exists public.marker_media (
  id         uuid primary key default gen_random_uuid(),
  marker_id  uuid not null references public.markers(id) on delete cascade,
  kind       text not null check (kind in ('image','audio','video','link')),
  -- A path inside the marker-media bucket, or an external URL for 'link'.
  path       text not null,
  ord        integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists marker_media_marker_idx on public.marker_media (marker_id, ord);

alter table public.marker_media enable row level security;

-- Media is meant to be seen once the stop is open, so a member of the trail may
-- read the row. It is not the answer; the answer is somewhere a member cannot
-- reach at all.
drop policy if exists media_select_member on public.marker_media;
create policy media_select_member on public.marker_media
  for select using (
    exists (select 1 from public.markers m
            where m.id = marker_media.marker_id
              and (public.world_role(m.world_id) is not null
                   or public.world_is_open(m.world_id)))
  );

drop policy if exists media_write_creator on public.marker_media;
create policy media_write_creator on public.marker_media
  for all using (
    exists (select 1 from public.markers m
            where m.id = marker_media.marker_id and public.may_edit(m.world_id))
  ) with check (
    exists (select 1 from public.markers m
            where m.id = marker_media.marker_id and public.may_edit(m.world_id))
  );

-- The bucket. Public reads, because a photo of a building is not a secret and
-- signing every URL would cost a round trip per image on a phone in the street.
-- Writes are policy-controlled below.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marker-media', 'marker-media', true, 52428800,
        array['image/jpeg','image/png','image/webp','image/avif',
              'audio/mpeg','audio/mp4','audio/ogg',
              'video/mp4','video/webm'])
on conflict (id) do update
  set public = true,
      file_size_limit = 52428800,
      allowed_mime_types = excluded.allowed_mime_types;

-- Objects live under <world_id>/<marker_id>/<file>, so the first path segment
-- is what decides who may write.
drop policy if exists marker_media_insert on storage.objects;
create policy marker_media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'marker-media'
    and public.may_edit(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists marker_media_update on storage.objects;
create policy marker_media_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'marker-media'
    and public.may_edit(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists marker_media_delete on storage.objects;
create policy marker_media_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'marker-media'
    and public.may_edit(((storage.foldername(name))[1])::uuid)
  );

commit;

-- =============================================================================
-- The functions that read all of this live in 0015, because check_answer has to
-- be rewritten around the cooldown and the hint charge rather than patched.
-- =============================================================================
