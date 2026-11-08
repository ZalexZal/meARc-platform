// Translates one stop between Bulgarian and English for the builder's
// "Translate" button (7 Nov 2026). Ported from Yambol Trails'
// web/src/app/api/translate/route.ts: the same Gemini models (lite ones
// first here), the same rules about names, temperature 0.2, 15 s a model.
//
// One call per stop, not per field: the free tier counts requests, so the
// whole stop goes as JSON and comes back as JSON with the same keys.
//
// Who may use it: a signed-in person who may edit the stop's trail
// (may_edit), at most 100 translations a day (ai_count_translation).
// The key is read from Supabase Vault through ai_secret(), which only the
// service role may call; it is never sent to the browser.
import { createClient } from 'npm:@supabase/supabase-js@2';

// Lite first (8 Nov 2026): a stop's text is short, the lite models answer
// in about a second, and on the free tier the big ones were often busy (503)
// or slow (60 s+). The big ones stay as the fallback.
const MODELS = (Deno.env.get('GEMINI_MODELS') ??
  'gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.5-flash,gemini-3.7-flash,gemini-3.8-flash')
  .split(',').map((m) => m.trim()).filter(Boolean);

const LANG = { bg: 'Bulgarian', en: 'English' } as const;
const MAX_CHARS = 8000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

type Fields = {
  title?: string; body?: string; sign?: string; question?: string; after?: string;
  choices?: string[]; hints?: string[];
};

// Only strings and lists of strings, trimmed; anything else is dropped.
function clean(input: unknown): Fields {
  const out: Fields = {};
  if (!input || typeof input !== 'object') return out;
  const src = input as Record<string, unknown>;
  for (const k of ['title', 'body', 'sign', 'question', 'after'] as const) {
    if (typeof src[k] === 'string' && (src[k] as string).trim()) out[k] = (src[k] as string).trim();
  }
  for (const k of ['choices', 'hints'] as const) {
    if (Array.isArray(src[k])) {
      const list = (src[k] as unknown[]).map((v) => (typeof v === 'string' ? v.trim() : ''));
      if (list.some(Boolean)) out[k] = list;
    }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply({ ok: false, reason: 'method' }, 405);

  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return reply({ ok: false, reason: 'signin' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  // The caller's own client: may_edit and the daily count see who they are.
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: who } = await asCaller.auth.getUser();
  if (!who?.user) return reply({ ok: false, reason: 'signin' }, 401);

  const body = await req.json().catch(() => null) as
    { world?: string; from?: string; to?: string; fields?: unknown } | null;
  const from = body?.from === 'en' ? 'en' : 'bg';
  const to = body?.to === 'bg' ? 'bg' : 'en';
  if (from === to) return reply({ ok: false, reason: 'same_language' }, 400);
  if (!body?.world) return reply({ ok: false, reason: 'world' }, 400);

  const { data: mayEdit } = await asCaller.rpc('may_edit', { p_world: body.world });
  if (mayEdit !== true) return reply({ ok: false, reason: 'not_yours' }, 403);

  const fields = clean(body.fields);
  const size = JSON.stringify(fields).length;
  if (size <= 2) return reply({ ok: true, fields: {}, model: null });
  if (size > MAX_CHARS) return reply({ ok: false, reason: 'too_long' }, 400);

  const { data: allowed } = await asCaller.rpc('ai_count_translation');
  if (allowed !== true) return reply({ ok: false, reason: 'quota' }, 429);

  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: key } = await service.rpc('ai_secret', { p_name: 'gemini_api_key' });
  if (!key) return reply({ ok: false, reason: 'not_configured' }, 503);

  const prompt =
    `Translate the values of this JSON object from ${LANG[from]} into ${LANG[to]}. ` +
    `It is one stop of a city walk in Bulgaria: a lesson, a guided tour or a building on show.\n` +
    `Rules: keep the same keys and the same number of items in every list; keep numbers, years, ` +
    `codes and punctuation exactly; transliterate Bulgarian names of people, streets and landmarks ` +
    `(for example Безистен → Bezisten, Тунджа → Tundzha) instead of translating them; keep line breaks; ` +
    `an empty string stays empty. Reply with the JSON object only.\n\n${JSON.stringify(fields)}`;

  for (const model of MODELS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key as string, 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue; // 429 out of quota, 5xx busy, 404 retired: the next model
      const data = await res.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim();
      if (!text) continue;
      const out = clean(JSON.parse(text));
      // Lists must line up with what was sent, or a choice lands on the wrong answer.
      for (const k of ['choices', 'hints'] as const) {
        if (fields[k] && out[k]?.length !== fields[k]!.length) delete out[k];
      }
      return reply({ ok: true, fields: out, model });
    } catch {
      // timeout, network or a reply that was not JSON: the next model
    }
  }
  return reply({ ok: false, reason: 'translate_failed' }, 502);
});
