// Migration 0070: profiles.role (creator | viewer; null = not asked yet).
import { check, done, makeUser, cleanUsers, api, sql } from './lib.mjs';
try {
  // check constraint
  const u = await makeUser('role-a', { role: null });
  let code = null;
  try { await sql(`update public.profiles set role = 'admin' where id = $1`, [u.id]); } catch (e) { code = e.code; }
  check("role='admin' is refused (23514)", code === '23514', `code ${code}`);

  // handle_new_user copies a valid role only
  const v = await makeUser('role-v', { role: 'viewer' });
  const [pv] = await sql(`select role from public.profiles where id = $1`, [v.id]);
  check("meta role='viewer' gives profiles.role='viewer'", pv.role === 'viewer', String(pv.role));
  const bad = await makeUser('role-bad', { role: 'admin' });
  const [pb] = await sql(`select role from public.profiles where id = $1`, [bad.id]);
  check("meta role='admin' gives null", pb.role === null, String(pb.role));
  const nul = await makeUser('role-null', { role: null });
  const [pn] = await sql(`select role from public.profiles where id = $1`, [nul.id]);
  check('JSON-null role gives null', pn.role === null, String(pn.role));
  const abs = await makeUser('role-abs', { role: undefined });
  const [pa] = await sql(`select p.role, (x.raw_user_meta_data ? 'role') as has from public.profiles p join auth.users x on x.id = p.id where p.id = $1`, [abs.id]);
  check('absent role key gives null', pa.has === false && pa.role === null, JSON.stringify(pa));

  // makeUser default
  const d = await makeUser('role-default');
  const [pd] = await sql(`select role from public.profiles where id = $1`, [d.id]);
  check("makeUser defaults to role='creator'", pd.role === 'creator', String(pd.role));

  // the owner can change their own role through the API client, and only their own
  const c = await api(d);
  const { error: e1 } = await c.from('profiles').update({ role: 'viewer' }).eq('id', d.id);
  const [p1] = await sql(`select role from public.profiles where id = $1`, [d.id]);
  check('owner can update own role through the API', !e1 && p1.role === 'viewer', e1?.message || String(p1.role));
  const { error: e2 } = await c.from('profiles').update({ role: 'nobody' }).eq('id', d.id);
  check("API update to role='nobody' is refused (23514)", e2?.code === '23514', String(e2?.code));
  const { data: other } = await c.from('profiles').update({ role: 'creator' }).eq('id', v.id).select();
  const [pv2] = await sql(`select role from public.profiles where id = $1`, [v.id]);
  check("another user's role cannot be changed", (other?.length ?? 0) === 0 && pv2.role === 'viewer', String(pv2.role));

  // the rest of handle_new_user still works (work is still copied)
  const w = await makeUser('role-work', { work: 'guide', role: 'creator' });
  const [pw] = await sql(`select work, role from public.profiles where id = $1`, [w.id]);
  check('work and role are both copied', pw.work === 'guide' && pw.role === 'creator', JSON.stringify(pw));
} finally {
  await cleanUsers();
}
done();
