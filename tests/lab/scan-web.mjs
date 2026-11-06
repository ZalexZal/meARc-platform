// Design scan: every page, desktop + phone, light + dark, signed out and (for
// the creator pages) signed in with a throwaway account that owns a sample
// trail. Screenshots land in tests/lab/shots/scan/. Changes nothing but its own
// throwaway rows, which it deletes.
import fs from 'fs';
import { browser, BASE, SHOTS, makeUser, cleanUsers, signIn, api, sql } from './lib.mjs';
const OUT = `${SHOTS}/scan`; fs.mkdirSync(OUT, { recursive: true });
const CTF = '9232aef6-ae8b-48cd-9636-e1b85a2b1f4e';
const open = ['/', '/trails/', `/view/?id=${CTF}`, '/play/', `/board/?id=${CTF}`, '/signin/', '/signup/', '/terms/', '/privacy/', '/parent/', '/feedback/', '/404'];
const b = await browser();
const shot = async (p, name) => { await p.waitForTimeout(1800); await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true }); };
try {
  const u = await makeUser('scan');
  const c = await api(u);
  const { data: w } = await c.rpc('create_world', { p_name: 'Разходка из стария град', p_mode: 'guide', p_language: 'bg' });
  const id = typeof w === 'string' ? w : w.id;
  for (const [i, t] of ['Безистен', 'Ески джамия', 'Театър'].entries()) {
    await sql(`insert into public.markers (world_id, location, style_key, colour_hex, content, status, step, radius_m, created_by)
      values ($1, extensions.st_makepoint($2, $3)::extensions.geography, 'pin', '#0066cc', $4, 'published', $5, 30, $6)`,
      [id, 26.5035 + i * 0.0012, 42.4842 + i * 0.0006, JSON.stringify({ bg: { title: t, body: 'Кратка история за мястото.' } }), i + 1, u.id]);
  }
  for (const [w0, h0, dev] of [[1440, 900, 'desk'], [390, 844, 'phone']]) {
    for (const scheme of ['light', 'dark']) {
      const ctx = await b.newContext({ viewport: { width: w0, height: h0 }, colorScheme: scheme });
      const p = await ctx.newPage();
      for (const path of open) {
        await p.goto(BASE + path);
        await shot(p, `${dev}-${scheme}-${path.replace(/[/?=]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'home'}`.slice(0, 80));
      }
      await signIn(p, u);
      for (const [path, name] of [['/account/', 'account'], ['/my-trails/', 'my-trails'], [`/trail/?id=${id}`, 'builder']]) {
        await p.goto(BASE + path);
        await shot(p, `${dev}-${scheme}-in-${name}`);
      }
      // the builder with a stop open
      await p.click('[data-stops] li >> nth=0').catch(() => {});
      await shot(p, `${dev}-${scheme}-in-builder-stop`);
      await ctx.close();
    }
  }
} finally { await cleanUsers(); await b.close(); }
console.log(fs.readdirSync(OUT).length, 'shots');
