-- 0066 - models made by Gemini from a description (9 Nov 2026)
--
-- "Generate with AI" from a description: Gemini (free tier, the translate
-- key) writes the model as simple shapes, which the builder turns into a
-- .glb. Such a model is credited as AI with ai_source 'gemini'.
--
-- Undo: restore the check to ('trellis2') once no row uses 'gemini'.

begin;

alter table public.marker_models drop constraint if exists marker_models_ai_source_check;
alter table public.marker_models
  add constraint marker_models_ai_source_check check (ai_source is null or ai_source in ('trellis2', 'gemini'));

commit;
