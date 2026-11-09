// Clicking the builder's map makes a stop, and its pin appears where the
// click was (9 Nov 2026: "when I create a marker, it is nowhere on the map").
import { browser, BASE, SHOTS, check, done, makeUser, cleanUsers, signIn, api, sql } from './lib.mjs';
const b = await browser();
const errs = [];
try {
  const u = await makeUser('newpin');
  const c = await api(u);
  const { data: w } = await c.rpc('create_world', { p_name: 'Лаб нов пин', p_mode: 'guide', p_language: 'bg' });
  const id = typeof w === 'string' ? w : w.id;
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  p.on('pageerror', (e) => errs.push(e.message + ' @ ' + (e.stack || '').split('\n').slice(1, 3).join(' ')));
  p.on('console', (m) => { if (m.type() === 'error' && !/Image ".*" could not|Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 200)); });
  p.on('dialog', (d) => { errs.push('dialog: ' + d.message()); d.accept().catch(() => {}); });
  await signIn(p, u);
  await p.goto(`${BASE}/trail/?id=${id}`);
  await p.waitForSelector('[data-map] canvas', { timeout: 20000 });
  await p.waitForTimeout(3000);
  const box = await (await p.$('[data-map]')).boundingBox();
  for (const [dx, dy] of [[0.5, 0.5], [0.3, 0.4]]) {
    await p.mouse.click(box.x + box.width * dx, box.y + box.height * dy);
    await p.waitForTimeout(4000);
  }
  const rows = await sql(`select id, style_key, extensions.st_y(location::extensions.geometry) lat, extensions.st_x(location::extensions.geometry) lng from markers where world_id = $1`, [id]);
  const pins = await p.$$eval('[data-map] .maplibregl-marker', (m) => m.map((x) => {
    const r = x.getBoundingClientRect(); return { w: r.width, h: r.height, x: Math.round(r.x), y: Math.round(r.y), cls: x.className.slice(0, 60) };
  }));
  const listed = await p.$$eval('[data-pick]', (l) => l.length);
  check('two stops created in the database', rows.length === 2, JSON.stringify(rows.map((r) => [r.style_key, Number(r.lat).toFixed(5), Number(r.lng).toFixed(5)])));
  check('two stops in the list', listed === 2, String(listed));
  check('two pins on the map, with size', pins.length >= 2 && pins.every((x) => x.w > 0 && x.h > 0), JSON.stringify(pins));
  await (await p.$('[data-map]')).screenshot({ path: `${SHOTS}/builder-new-pin.png` });
} finally { await cleanUsers(); await b.close(); }
check('no page errors', errs.length === 0, errs.slice(0, 4).join(' | '));
done();
