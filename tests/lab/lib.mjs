// Lab test harness: Playwright against the local preview, and throwaway
// confirmed accounts written straight into auth.users and deleted afterwards.
// Run from anywhere: node tests/lab/<suite>.mjs  (preview on :4399, see build.sh)
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../web/package.json'));
const { chromium } = require('playwright');
export const { createClient } = require('@supabase/supabase-js');
export const BASE = process.env.LAB_BASE || 'http://localhost:4399';
export const SHOTS = path.join(here, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

export async function browser() {
  return chromium.launch({ executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell` });
}
let pass = 0, fail = 0;
export function check(name, ok, extra = '') { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`); }
export function done() { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }

const cfg = fs.readFileSync(path.join(here, '../../web/config.local.js'), 'utf8');
export const URL = cfg.match(/https:\/\/[a-z0-9]+\.supabase\.co/)[0];
export const ANON = cfg.match(/eyJ[A-Za-z0-9._-]+/)[0];

const pg = require('pg');
const DBURL = fs.readFileSync(`${process.env.HOME}/keys/supabase-db-url.txt`, 'utf8').trim();
export async function sql(text, params = []) {
  const c = new pg.Client({ connectionString: DBURL }); await c.connect();
  try { return (await c.query(text, params)).rows; } finally { await c.end(); }
}
export const PW = 'Lab-test-password-1';
export async function makeUser(tag) {
  const email = `lab-test-${tag}-${Date.now()}@example.com`;
  const [{ id }] = await sql(`insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
    values (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $1,
      extensions.crypt($2, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Lab tester"}',
      now(), now(), '', '', '', '') returning id`, [email, PW]);
  await sql(`insert into auth.identities (id, user_id, provider_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
    values (gen_random_uuid(), $1::uuid, $1::text, jsonb_build_object('sub', $1::text, 'email', $2::text), 'email', now(), now(), now())`, [id, email]);
  await sql(`update public.profiles set terms_version = '2026-09-29', terms_accepted_at = now(), age_band = '14+', display_name = 'Lab tester' where id = $1`, [id]);
  return { id, email };
}
export async function cleanUsers() {
  await sql(`delete from public.worlds where owner_id in (select id from auth.users where email like 'lab-test-%@example.com')`);
  const r = await sql(`delete from auth.users where email like 'lab-test-%@example.com' returning email`);
  console.log(`cleaned ${r.length} test accounts`);
}
export async function signIn(page, user, lang = '') {
  await page.goto(`${BASE}${lang}/signin/`);
  await page.fill('#email', user.email); await page.fill('#password', PW);
  await page.click('[data-auth-submit]');
  await page.waitForURL((u) => !u.pathname.includes('signin'), { timeout: 20000 });
}
export async function api(user) {
  const c = createClient(URL, ANON, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email: user.email, password: PW });
  if (error) throw error;
  return c;
}
