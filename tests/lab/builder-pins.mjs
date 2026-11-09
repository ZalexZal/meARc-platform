// The builder's map shows every stop as a pin (9 Nov 2026: "the markers are
// missing from the map"). Light and dark, desktop and phone.
import { browser, BASE, SHOTS, check, done, makeUser, cleanUsers, signIn, api, sql } from './lib.mjs';
const b = await browser();
const errs = [];
try {
  const u = await makeUser('pins');
  const c = await api(u);
  const { data: w } = await c.rpc('create_world', { p_name: 'Лаб пинове', p_mode: 'guide', p_language: 'bg' });
  const id = typeof w === 'string' ? w : w.id;
  for (const [i, t] of ['Безистен', 'Ески джамия', 'Театър'].entries()) {
    await sql(`insert into public.markers (world_id, location, style_key, colour_hex, content, status, step, radius_m, created_by)
      values ($1, extensions.st_makepoint($2, $3)::extensions.geography, 'pin', '#0066cc', $4, 'published', $5, 30, $6)`,
      [id, 26.5035 + i * 0.0012, 42.4842 + i * 0.0006, JSON.stringify({ bg: { title: t } }), i + 1, u.id]);
  }
  for (const [w0, h0, tag] of [[1280, 900, 'desk'], [390, 844, 'phone']]) {
    for (const scheme of ['light', 'dark']) {
      const ctx = await b.newContext({ viewport: { width: w0, height: h0 }, colorScheme: scheme });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errs.push(`${tag}/${scheme}: ${e.message}`));
      await signIn(p, u);
      await p.goto(`${BASE}/trail/?id=${id}`);
      await p.waitForSelector('[data-pick]', { timeout: 20000 });
      await p.waitForTimeout(4000);
      const pins = await p.$$eval('[data-map] .maplibregl-marker', (m) => m.length);
      const visible = await p.$$eval('[data-map] .maplibregl-marker', (m) => m.filter((x) => {
        const r = x.getBoundingClientRect(); const s = getComputedStyle(x);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.opacity !== '0';
      }).length);
      check(`${tag}/${scheme}: 3 pins on the builder map`, pins >= 3 && visible >= 3, `${pins} markers, ${visible} visible`);
      await (await p.$('[data-map]')).screenshot({ path: `${SHOTS}/builder-pins-${tag}-${scheme}.png` });
      await ctx.close();
    }
  }
} finally { await cleanUsers(); await b.close(); }
check('no page errors', errs.length === 0, errs.slice(0, 3).join(' | '));
done();
