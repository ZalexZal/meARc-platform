// A stop's radius (20 Nov 2026): 5 to 200 m in the editor and the CSV import,
// and a ring on the builder map showing the circle each stop opens within.
// Behaviour checked: out-of-range radii are refused with the inline error (not
// clamped) and nothing over 200 reaches the database; every stop gets a faint
// ring, the selected one a strong one, drawn to scale and following the form.
// The 0073 constraint is not tested here (it may not be applied yet).
// tests/lab/build.sh && node tests/lab/radius-ring.mjs
import { browser, BASE, check, done, makeUser, cleanUsers, signIn, api, sql } from './lib.mjs';

const b = await browser();
const errs = [];

// Records every maplibre map the page makes, so the test can read its sources.
const TRAP = () => {
  let lib;
  Object.defineProperty(window, 'maplibregl', {
    configurable: true,
    get: () => lib,
    set: (v) => {
      const Base = v.Map;
      class Kept extends Base { constructor(o) { super(o); (window.__maps ||= []).push(this); } }
      try { v.Map = Kept; lib = v; } catch { lib = Object.assign(Object.create(v), { Map: Kept }); }
    },
  });
};

function metres(a, b2) {   // haversine, [lng, lat]
  const R = 6371008.8, r = Math.PI / 180;
  const dl = (b2[1] - a[1]) * r, dg = (b2[0] - a[0]) * r;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b2[1] * r) * Math.sin(dg / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

try {
  const u = await makeUser('radius');
  const c = await api(u);
  const { data: w, error } = await c.rpc('create_world', { p_name: 'Лаб радиус', p_mode: 'ctf', p_language: 'bg', p_category: 'education' });
  if (error) throw error;
  const id = typeof w === 'string' ? w : w.id;
  const A = [26.5060, 42.4841], B = [26.5085, 42.4850];
  for (const [i, [lng, lat]] of [A, B].entries()) {
    const { error: e } = await c.rpc('place_marker', {
      p_world: id, p_lat: lat, p_lng: lng, p_status: 'published',
      p_content: { bg: { title: `Спирка ${i + 1}` } },
    });
    if (e) throw e;
  }

  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage();
  await p.addInitScript(TRAP);
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => { errs.push('native dialog: ' + d.message()); d.accept().catch(() => {}); });
  await signIn(p, u);
  await p.click('[data-cookie-ok]', { timeout: 3000 }).catch(() => {});
  await p.goto(`${BASE}/trail/?id=${id}`);
  await p.waitForSelector('[data-guarded]:not([hidden])', { timeout: 20000 });
  await p.waitForSelector('[data-map] canvas', { timeout: 20000 });
  await p.waitForFunction(() => window.__maps?.[0]?.getSource('stop-rings'), null, { timeout: 20000 });

  const rings = () => p.evaluate(async () => {
    const m = window.__maps[0];
    const data = await m.getSource('stop-rings').getData();
    return {
      layers: ['stop-rings-fill', 'stop-rings-line'].every((l) => m.getLayer(l)),
      list: data.features.map((f) => ({ on: f.properties.on, radius: f.properties.radius, ring: f.geometry.coordinates[0] })),
    };
  });
  const centre = (ring) => {
    const pts = ring.slice(0, -1);
    return [pts.reduce((s, x) => s + x[0], 0) / pts.length, pts.reduce((s, x) => s + x[1], 0) / pts.length];
  };
  const close = (got, want) => Math.abs(got - want) / want < 0.03;

  let r = await rings();
  check('ring layers exist', r.layers);
  check('a faint ring for every stop before any is chosen', r.list.length === 2 && r.list.every((x) => !x.on), JSON.stringify(r.list.map((x) => [x.on, x.radius])));

  // Pick stop 1: its ring turns strong; the others stay faint.
  await p.click('[data-pick]');
  await p.waitForSelector('[data-marker-form]:not(.hidden)', { timeout: 15000 });
  await p.waitForTimeout(800);
  const input = p.locator('[name=radius]');
  check('input is a 5-200 number field', await input.evaluate((e) => e.type === 'number' && e.min === '5' && e.max === '200' && e.getAttribute('inputmode') === 'numeric'));
  r = await rings();
  const on = r.list.find((x) => x.on);
  check('selected ring is the strong one', r.list.length === 2 && r.list.filter((x) => x.on).length === 1);
  const d0 = metres(A, on.ring[0]), d16 = metres(A, on.ring[16]);
  check('ring drawn to scale (100 m)', on.radius === 100 && close(d0, 100) && close(d16, 100), `${d0.toFixed(1)} / ${d16.toFixed(1)} m`);
  check('ring is a 64-point polygon', on.ring.length === 65);

  // Live: the radius field.
  await input.fill('150');
  await p.waitForTimeout(200);
  r = await rings();
  const on150 = r.list.find((x) => x.on);
  check('ring follows the radius field', on150?.radius === 150 && close(metres(A, on150.ring[0]), 150), String(on150 && metres(A, on150.ring[0])));

  // Live: the latitude field.
  await p.fill('[name=lat]', String(A[1] + 0.001));
  await p.waitForTimeout(200);
  r = await rings();
  const moved = centre(r.list.find((x) => x.on).ring);
  check('ring follows the lat field', Math.abs(moved[1] - (A[1] + 0.001)) < 1e-5, JSON.stringify(moved));
  await p.fill('[name=lat]', String(A[1]));

  // Out of range: no ring, and the save is refused with the inline error.
  const err = p.locator('[data-marker-error]');
  for (const bad of ['250', '2']) {
    await input.fill(bad);
    await p.waitForTimeout(200);
    r = await rings();
    check(`${bad}: no ring for the chosen stop`, r.list.length === 1 && !r.list[0].on);
    await p.click('[data-marker-save]');
    await p.waitForTimeout(1500);
    const msg = (await err.isVisible()) ? await err.textContent() : '';
    check(`${bad}: refused with the radius message`, /от 5 до 200/.test(msg ?? ''), msg);
    check(`${bad}: still on Place`, await p.isVisible('[data-panel=place]'));
    const [row] = await sql(`select radius_m from markers where world_id = $1 and content->'bg'->>'title' = 'Спирка 1'`, [id]);
    check(`${bad}: database untouched`, row.radius_m === 100, String(row.radius_m));
  }

  // A good value saves, and the ring is back.
  await input.fill('180');
  await p.click('[data-marker-save]');
  await p.waitForTimeout(2500);
  const [saved] = await sql(`select radius_m from markers where world_id = $1 and content->'bg'->>'title' = 'Спирка 1'`, [id]);
  check('180 saved', saved.radius_m === 180, String(saved.radius_m));
  r = await rings();
  check('ring back after a good value', r.list.length === 2);

  // The CSV import: 250 is refused for its row, 150 goes in.
  await p.evaluate(() => { document.querySelector('[data-import]').open = true; });
  await p.fill('[data-imp-text]', [
    'name_bg\tlat\tlng\tradius_m',
    `Твърде широка\t42.4860\t26.5070\t250`,
    `Средна\t42.4870\t26.5090\t150`,
  ].join('\n'));
  await p.click('[data-imp-check]');
  await p.waitForTimeout(400);
  const rep = (await p.textContent('[data-imp-report]')) ?? '';
  check('import: 250 row refused with the radius problem', /radius_m/.test(rep) && /200/.test(rep), rep);
  await p.click('[data-imp-go]');
  await p.waitForFunction(() => !/…|\.\.\./.test(document.querySelector('[data-imp-status]')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(3000);
  const rows = await sql(`select content->'bg'->>'title' as t, radius_m from markers where world_id = $1 order by step`, [id]);
  check('import: 150 row in with its radius, 250 row not', rows.some((x) => x.t === 'Средна' && x.radius_m === 150) && !rows.some((x) => x.t === 'Твърде широка'), JSON.stringify(rows));
  check('no stop over 200 m', rows.every((x) => x.radius_m <= 200));
  r = await rings();
  check('a ring per stop after the import', r.list.length === rows.length, `${r.list.length} / ${rows.length}`);
  await ctx.close();
} finally {
  await cleanUsers();
  await b.close();
}
check('no page errors or native dialogs', errs.length === 0, errs.slice(0, 3).join(' | '));
done();
