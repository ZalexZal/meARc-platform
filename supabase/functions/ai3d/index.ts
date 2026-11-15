// "A 3D model by AI" for the builder (7-9 Nov 2026).
//
// Free only. A description: Gemini designs the model as shapes (shapes.ts,
// the translate key). A photo: TRELLIS.2 on Hugging Face's free Spaces with
// 'hf_token' (spaces.ts). Keys are read through ai_secret and never sent
// anywhere else. The browser cannot call either itself (the Spaces refuse
// cross-site requests; a key must not reach the browser).
//
//   { action: 'picture', prompt }   FLUX.1 [schnell]  -> { ok, url }  (a .webp)
//   { action: 'model', image }      TRELLIS.2         -> { ok, url }  (a .glb)
//   { action: 'shapes', prompt, image? }  Gemini       -> { ok, spec }  (shapes; the builder makes the .glb)
//
// image is a JPEG as a data URL; the browser has already scaled it down and
// stripped its metadata. The returned url is the Space's own file link, which
// the browser downloads itself, so nothing large passes through here. A
// TRELLIS.2 model took 84 s on 8 Nov 2026, inside the function's 150 s.
// The Space calls are plain HTTP (spaces.ts): the Gradio client library ran
// out of the function's compute while waiting (9 Nov 2026).
//
// Signed-in people only, a few models a day each (ai_count_model): the
// token's allowance is shared by everyone.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { picture, model, SpaceError } from './spaces.ts';
import { shapes, ShapesError } from './shapes.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply({ ok: false, reason: 'method' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL')!;
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: who } = await asCaller.auth.getUser();
  if (!who?.user) return reply({ ok: false, reason: 'signin' }, 401);

  const body = await req.json().catch(() => null) as { action?: string; prompt?: string; image?: string } | null;
  const action = body?.action;
  if (action !== 'picture' && action !== 'model' && action !== 'shapes') return reply({ ok: false, reason: 'action' }, 400);

  // Gemini writes the model as shapes (shapes.ts): free on the translate key,
  // counted like a translation (100 a day each), only when it worked.
  if (action === 'shapes') {
    const prompt = (body?.prompt ?? '').trim().slice(0, 600);
    const photo = /^data:image\/jpeg;base64,(.+)$/.exec(body?.image ?? '')?.[1];
    if (!prompt && !photo) return reply({ ok: false, reason: 'prompt' }, 400);
    const { data: used } = await asCaller.from('ai_usage').select('translations')
      .eq('day', new Date().toISOString().slice(0, 10)).maybeSingle();
    if ((used?.translations ?? 0) >= 100) return reply({ ok: false, reason: 'quota' }, 429);
    const keys = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: gemini } = await keys.rpc('ai_secret', { p_name: 'gemini_api_key' });
    if (!gemini) return reply({ ok: false, reason: 'not_configured' }, 503);
    try {
      const made = await shapes(gemini as string, prompt, photo);
      await asCaller.rpc('ai_count_translation');
      console.log('ai3d shapes by', made.model, made.spec.parts.length, 'parts');
      return reply({ ok: true, spec: made.spec, model: made.model, source: 'gemini' });
    } catch (e) {
      const reason = e instanceof ShapesError ? e.reason : 'failed';
      console.log('ai3d shapes', reason, String((e as Error)?.message ?? e).slice(0, 200));
      return reply({ ok: false, reason }, 502);
    }
  }

  // Each person's 5 models a day. Checked first, counted only when a model was
  // actually made: a failed try must not cost one (9 Nov 2026). A picture is
  // the first half of a model and is not counted.
  const today = new Date().toISOString().slice(0, 10);
  if (action === 'model') {
    const { data: row } = await asCaller.from('ai_usage').select('models').eq('day', today).maybeSingle();
    if ((row?.models ?? 0) >= 5) return reply({ ok: false, reason: 'quota' }, 429);
  }

  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: token } = await service.rpc('ai_secret', { p_name: 'hf_token' });
  if (!token) return reply({ ok: false, reason: 'not_configured' }, 503);

  try {
    if (action === 'picture') {
      const prompt = (body?.prompt ?? '').trim().slice(0, 600);
      if (!prompt) return reply({ ok: false, reason: 'prompt' }, 400);
      return reply({ ok: true, url: await picture(prompt, token as string) });
    }

    const match = /^data:image\/jpeg;base64,(.+)$/.exec(body?.image ?? '');
    if (!match) return reply({ ok: false, reason: 'image' }, 400);
    const jpeg = Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0));
    if (jpeg.length > 4 * 1024 * 1024) return reply({ ok: false, reason: 'image' }, 400);
    const link = await model(jpeg, token as string);
    await asCaller.rpc('ai_count_model');
    return reply({ ok: true, url: link, source: 'trellis2' });
  } catch (e) {
    // Hugging Face's own daily limit on meARc's token is shared by everyone:
    // 'allowance', not 'quota', so nobody is told they used up their own.
    const reason = e instanceof SpaceError ? (e.reason === 'quota' ? 'allowance' : e.reason) : 'failed';
    console.log('ai3d', action, reason, String((e as Error)?.message ?? e).slice(0, 200));
    return reply({ ok: false, reason }, reason === 'allowance' ? 429 : 502);
  }
});
