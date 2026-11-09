// "A 3D model by AI" for the builder (7-9 Nov 2026).
//
// Runs Hugging Face's free Spaces with AR Trail's own Hugging Face token (in
// Vault as 'hf_token', read through ai_secret, never sent anywhere else). The
// browser cannot call them itself: the Spaces refuse cross-site requests from
// artrails.netlify.app (CORS), found 9 Nov 2026.
//
//   { action: 'picture', prompt }   FLUX.1 [schnell]  -> { ok, url }  (a .webp)
//   { action: 'model', image }      TRELLIS.2         -> { ok, url }  (a .glb)
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
  if (action !== 'picture' && action !== 'model') return reply({ ok: false, reason: 'action' }, 400);

  // A picture costs a few GPU seconds and is the first half of a model, so
  // only the model is counted.
  if (action === 'model') {
    const { data: allowed } = await asCaller.rpc('ai_count_model');
    if (allowed !== true) return reply({ ok: false, reason: 'quota' }, 429);
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
    return reply({ ok: true, url: await model(jpeg, token as string), source: 'trellis2' });
  } catch (e) {
    const reason = e instanceof SpaceError ? e.reason : 'failed';
    console.log('ai3d', action, reason, String((e as Error)?.message ?? e).slice(0, 200));
    return reply({ ok: false, reason }, reason === 'quota' ? 429 : 502);
  }
});
