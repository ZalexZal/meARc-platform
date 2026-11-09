// Runs "Generate with AI" from a description in a real browser and prints
// every console error, failed request and HTTP error along the way.
// Spends real AI allowance: run by hand only.
import { browser, BASE, makeUser, cleanUsers, signIn, api, sql } from './lib.mjs';
// AI_TEXT=... to try another description.
const b = await browser();
try {
  const u = await makeUser('aidebug');
  const c = await api(u);
  const { data: w } = await c.rpc('create_world', { p_name: 'Лаб AI debug', p_mode: 'guide', p_language: 'bg' });
  const id = typeof w === 'string' ? w : w.id;
  const [m] = await sql(`insert into public.markers (world_id, location, style_key, colour_hex, content, status, step, radius_m, created_by)
    values ($1, extensions.st_makepoint(26.5035, 42.4842)::extensions.geography, 'pin', '#0066cc', $2, 'published', 1, 30, $3) returning id`,
    [id, JSON.stringify({ bg: { title: 'Къща' } }), u.id]);
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const t0 = Date.now(); const at = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;
  p.on('console', (msg) => { if (['error', 'warning'].includes(msg.type()) && !/Image ".*" could not|GL Driver|Expected value/.test(msg.text())) console.log(at(), 'console', msg.type(), msg.text().slice(0, 300)); });
  p.on('pageerror', (e) => console.log(at(), 'pageerror', e.message));
  p.on('requestfailed', (r) => console.log(at(), 'requestfailed', r.url().slice(0, 140), r.failure()?.errorText));
  p.on('response', async (r) => {
    const u2 = r.url();
    if (/hf\.space|huggingface|functions\/v1/.test(u2)) console.log(at(), 'response', r.status(), r.request().method(), u2.slice(0, 140));
    if (r.status() >= 400 && /functions\/v1/.test(u2)) console.log(at(), 'body', (await r.text().catch(() => '')).slice(0, 300));
  });
  await signIn(p, u);
  await p.goto(`${BASE}/trail/?id=${id}`);
  await p.waitForSelector(`[data-pick="${m.id}"]`, { timeout: 20000 });
  await p.click(`[data-pick="${m.id}"]`);
  await p.click('[data-step="visual"]');
  await p.waitForSelector('[data-panel="visual"]:not(.hidden)');
  await p.click('label:has(input[name=shape][value=ai])');
  await p.fill('[data-ai-text]', process.env.AI_TEXT || 'Generate me a generic white house with brown doors and a green roof.');
  await p.click('[data-ai-make]');
  let last = '';
  for (let i = 0; i < 200; i++) {
    const said = await p.textContent('[data-model-check]');
    if (said !== last) { console.log(at(), 'says:', said); last = said; }
    if (!(await p.isDisabled('[data-ai-make]'))) break;
    await p.waitForTimeout(1500);
  }
  console.log(at(), 'final:', await p.textContent('[data-model-check]'));
  await p.waitForTimeout(3000);
  await (await p.$('[data-model-fields]')).screenshot({ path: new URL('./shots/ai-debug.png', import.meta.url).pathname });
  if (/MB/.test(await p.textContent('[data-model-check]'))) {
    await p.click('[data-marker-save]');
    let row;
    for (let i = 0; i < 30 && !row; i++) {
      [row] = await sql(`select credit_source, ai_source, height_m, triangles, bytes from marker_models where marker_id = $1`, [m.id]);
      if (!row) await p.waitForTimeout(1000);
    }
    console.log(at(), 'saved:', JSON.stringify(row ?? null), '|', await p.textContent('[data-marker-error]').catch(() => ''));
  }
} finally { await cleanUsers(); await b.close(); }
