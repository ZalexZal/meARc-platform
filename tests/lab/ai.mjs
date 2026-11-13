// AI in the builder (7 Nov 2026): the Translate button and an .stl upload.
// Photo -> 3D is not run here: it spends a real daily GPU allowance. Its
// controls are checked; the model itself is tried by hand.
// Needs tests/lab/fixtures/house.stl (python3 tests/lab/make-stl.py).
import path from 'node:path';
import { browser, BASE, SHOTS, URL, check, done, makeUser, cleanUsers, signIn, api, sql } from './lib.mjs';
const b = await browser();
const errs = [];
try {
  const u = await makeUser('ai');
  const c = await api(u);
  const { data: w } = await c.rpc('create_world', { p_name: 'Лаб AI', p_mode: 'guide', p_language: 'bg' });
  const id = typeof w === 'string' ? w : w.id;
  const [m] = await sql(`insert into public.markers (world_id, location, style_key, colour_hex, content, status, step, radius_m, created_by)
    values ($1, extensions.st_makepoint(26.5035, 42.4842)::extensions.geography, 'pin', '#0066cc', $2, 'published', 1, 30, $3) returning id`,
    [id, JSON.stringify({ bg: { title: 'Безистен', body: 'Покрит пазар от XVI век.' } }), u.id]);

  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  // A step saves first, then shows its pane: wait for the pane.
  // Round 7: Basics is gone; the stop's text (and Translate) sit in Question.
  const PANES = ['place', 'visual', 'question', 'media', 'review'];
  const goStep = async (i) => {
    await p.click(`[data-step="${PANES[i]}"]`);
    await p.waitForSelector(`[data-panel="${PANES[i]}"]:not(.hidden)`, { timeout: 15000 });
  };
  p.on('pageerror', (e) => errs.push(e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' ')));
  p.on('console', (msg) => { if (msg.type() === 'error' || msg.type() === 'warning') console.log('console:', msg.text().slice(0, 200)); });
  p.on('dialog', (d) => d.accept().catch(() => {}));
  await signIn(p, u);
  await p.goto(`${BASE}/trail/?id=${id}`);
  await p.waitForSelector(`[data-pick="${m.id}"]`, { timeout: 20000 });
  await p.click(`[data-pick="${m.id}"]`);
  await goStep(2);
  await p.waitForSelector('[data-ai-translate]', { state: 'visible', timeout: 10000 });
  check('tips card hidden while a stop is open', !(await p.isVisible('.start-card')));
  check('translate button says "to English" for a Bulgarian stop', (await p.textContent('[data-ai-label]')).includes('английски'));
  await p.click('[data-ai-translate]');
  await p.waitForFunction(() => {
    const t = document.querySelector('[data-ai-say]')?.textContent ?? '';
    return t && !t.includes('…');
  }, null, { timeout: 60000 });
  const said = await p.textContent('[data-ai-say]');
  const en = await p.inputValue('input[name=titleEn]');
  check('translate answers (filled, or says the key is not set yet)', /Bezisten/i.test(en) || /не е включен/.test(said), `${said} | ${en}`);

  // The steps (8 Nov 2026): Basics, 3D visual, Place, Question (with hints), Media.
  const steps = await p.$$eval('[data-step]', (b) => b.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  check('five steps, 3D visual second, no separate hints', steps.length === 5 && /3D/.test(steps[1]) && !steps.some((t) => /Подсказки/.test(t)), steps.join(' | '));
  await goStep(2);
  check('hints sit inside the question step', await p.isVisible('[data-panel="question"] [data-hints-box]'));
  await (await p.$('[data-marker-form]')).screenshot({ path: `${SHOTS}/ai-question.png` });

  // Step 2, the 3D visual: five tiles
  await goStep(1);
  const tiles = await p.$$eval('[data-panel="visual"] input[name=shape]', (r) => r.map((x) => x.value));
  check('tiles: pin, cube, sign, AI, 3D model', tiles.join() === 'pin,cube,sign,ai,model', tiles.join());
  await p.click('label:has(input[name=shape][value=ai])');
  check('AI tile: photos/video, description and Make', await p.isVisible('[data-ai-media]') && await p.isVisible('[data-ai-text]')
    && await p.isVisible('[data-ai-make]') && !(await p.isVisible('[data-model-file]')));
  await (await p.$('[data-marker-form]')).screenshot({ path: `${SHOTS}/ai-visual.png` });
  await p.click('[data-ai-make]');
  check('Make with nothing asks for a picture or words', /снимка|видео/.test(await p.textContent('[data-model-check]')));
  await p.click('label:has(input[name=shape][value=model])');
  check('3D model tile: the file picker only', await p.isVisible('[data-model-file]') && !(await p.isVisible('[data-ai-media]')));
  await p.setInputFiles('[data-model-file]', path.join(import.meta.dirname, 'fixtures/house.stl'));
  await p.waitForFunction(() => /MB/.test(document.querySelector('[data-model-check]')?.textContent ?? ''), null, { timeout: 30000 });
  check('stl converted and checked', true, await p.textContent('[data-model-check]'));
  await p.waitForSelector('[data-model-stage] model-viewer', { timeout: 15000 });
  check('stl previewed', true);
  await p.fill('[data-model-height]', '12');
  await p.click('[data-marker-save]');
  // The upload and the row take a few seconds; wait for the row, up to 30 s.
  for (let i = 0; i < 30; i++) {
    if ((await sql(`select 1 from marker_models where marker_id = $1`, [m.id])).length) break;
    await p.waitForTimeout(1000);
  }
  const rows = await sql(`select path, triangles, height_m, credit_source from marker_models where marker_id = $1`, [m.id]);
  check('model row saved from the stl', rows.length === 1 && rows[0].path.endsWith('.glb') && rows[0].triangles === 16 && rows[0].height_m === 12,
    JSON.stringify(rows[0] ?? null));
  await p.screenshot({ path: `${SHOTS}/ai-stl.png`, fullPage: true });

  // A GLB with WebP textures (what TRELLIS.2 makes) is re-saved with JPEG/PNG
  // for the app. Optional: AI_GLB=/path/to/a/trellis.glb (too big for the repo).
  if (process.env.AI_GLB) {
    await p.click(`[data-pick="${m.id}"]`);
    await goStep(1);
    await p.click('label:has(input[name=shape][value=model])');
    await p.setInputFiles('[data-model-file]', process.env.AI_GLB);
    await p.waitForFunction(() => {
      const t = document.querySelector('[data-model-check]')?.textContent ?? '';
      return /MB/.test(t) || /не|n't|not/i.test(t);
    }, null, { timeout: 120000 });
    const said = await p.textContent('[data-model-check]');
    check('webp glb accepted after re-saving', /MB/.test(said), said);
    await p.click('[data-marker-save]');
    await p.waitForTimeout(15000);
    const [row] = await sql(`select path, bytes, triangles from marker_models where marker_id = $1`, [m.id]);
    const [obj] = await sql(`select metadata->>'size' as size from storage.objects where bucket_id = 'marker-media' and name = $1`, [row?.path]);
    check('webp glb saved', row && Number(obj?.size) > 1e6, JSON.stringify({ ...row, size: obj?.size }));
    if (row?.path) {
      // The stored file itself: no WebP left for glTFast to trip on.
      const buf = Buffer.from(await (await fetch(`${URL}/storage/v1/object/public/marker-media/${row.path}`)).arrayBuffer());
      const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString());
      const exts = [...(json.extensionsRequired ?? []), ...(json.extensionsUsed ?? [])];
      const types = [...new Set((json.images ?? []).map((i) => i.mimeType))];
      check('stored glb has no webp', !exts.includes('EXT_texture_webp') && !types.includes('image/webp'), `${exts.join(',') || 'no extensions'} · ${types.join(',')}`);
    }
  }
} finally { await cleanUsers(); await b.close(); }
const real = errs.filter((e) => !/favicon|tiles|sprite|glyph|ERR_|net::|WebGL|webgl/i.test(e));
check('no page errors', real.length === 0, real.slice(0, 5).join(' | '));
done();
