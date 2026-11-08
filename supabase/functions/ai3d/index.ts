// The server half of "a 3D model by AI" (7-8 Nov 2026).
//
// The builder first asks Hugging Face's free Spaces straight from the
// creator's browser. Hugging Face gives an anonymous visitor only a little
// free GPU time a day, so when that is refused the builder comes here, and
// this runs the same Spaces with AR Trail's own Hugging Face token (in Vault
// as 'hf_token', read through ai_secret, never sent anywhere else).
//
//   { action: 'picture', prompt }   FLUX.1 [schnell]  -> { ok, url }  (a .webp)
//   { action: 'model', image }      TRELLIS.2         -> { ok, url }  (a .glb)
//
// image is a JPEG as a data URL; the browser has already scaled it down and
// stripped its metadata. The returned url is the Space's own file link, which
// the browser downloads itself, so nothing large passes through here. A
// TRELLIS.2 model took 84 s on 8 Nov 2026, inside the function's 150 s.
//
// Signed-in people only, a few models a day each (ai_count_model): the
// token's allowance is shared by everyone.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { Client, handle_file } from 'npm:@gradio/client@1';

const TRELLIS = 'microsoft/TRELLIS.2';
const FLUX = 'black-forest-labs/FLUX.1-schnell';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

const urlOf = (v: any): string | null =>
  !v ? null : typeof v === 'string' ? v : v.url ?? (v.value ? urlOf(v.value) : null);

async function predict(app: any, endpoint: string, data: Record<string, unknown>): Promise<any[]> {
  return (await app.predict(endpoint, data)).data as any[];
}

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
  const hf_token = token as `hf_${string}`;

  try {
    if (action === 'picture') {
      const prompt = (body?.prompt ?? '').trim().slice(0, 600);
      if (!prompt) return reply({ ok: false, reason: 'prompt' }, 400);
      const app = await Client.connect(FLUX, { hf_token });
      const [image] = await predict(app, '/infer', {
        prompt, seed: 0, randomize_seed: true, width: 1024, height: 1024, num_inference_steps: 4,
      });
      const link = urlOf(image);
      return link ? reply({ ok: true, url: link }) : reply({ ok: false, reason: 'failed' }, 502);
    }

    const match = /^data:image\/jpeg;base64,(.+)$/.exec(body?.image ?? '');
    if (!match) return reply({ ok: false, reason: 'image' }, 400);
    const jpeg = Uint8Array.from(atob(match[1]), (c) => c.charCodeAt(0));
    if (jpeg.length > 4 * 1024 * 1024) return reply({ ok: false, reason: 'image' }, 400);

    // The Space keeps each visitor's work in a session: start one, cut the
    // object out of its background, build the model, then export it.
    const app = await Client.connect(TRELLIS, { hf_token });
    await predict(app, '/start_session', {}).catch(() => null);
    const [cut] = await predict(app, '/preprocess_image', { input: handle_file(new Blob([jpeg], { type: 'image/jpeg' })) });
    await predict(app, '/image_to_3d', { image: cut, seed: 0, resolution: '1024' });
    const out = await predict(app, '/extract_glb', { decimation_target: 300000, texture_size: 2048 });
    const link = urlOf(out[1]) ?? urlOf(out[0]);
    return link ? reply({ ok: true, url: link, source: 'trellis2' }) : reply({ ok: false, reason: 'failed' }, 502);
  } catch (e) {
    const m = String((e as any)?.message ?? JSON.stringify(e)).toLowerCase();
    return reply({ ok: false, reason: /quota|exceeded|429/.test(m) ? 'quota' : /queue|busy|timeout/.test(m) ? 'busy' : 'failed' }, 502);
  }
});
