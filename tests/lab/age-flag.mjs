// The age question is behind ASK_AGE (web/src/lib/config.ts). The lab site is
// built with it off; this builds a second copy with ARTRAIL_ASK_AGE=1 into a
// scratch folder and checks that the "true" path still renders and still
// validates. The sign-up request is stubbed, so no account is made. It serves
// its own copy on :4398 and needs no other server.
import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { browser, URL as SB, check, done } from './lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.join(here, '../../web');
const out = path.join(web, 'dist-age');   // inside web/: astro cannot move its assets across devices
const PORT = 4398;
const cfg = fs.readFileSync(path.join(web, 'config.local.js'), 'utf8');
const env = {
  ...process.env, ARTRAIL_ASK_AGE: '1',
  PUBLIC_SUPABASE_URL: cfg.match(/https:\/\/[a-z0-9]+\.supabase\.co/)[0],
  PUBLIC_SUPABASE_ANON_KEY: cfg.match(/eyJ[A-Za-z0-9._-]+/)[0],
};
execSync(`npx astro build --outDir ${out}`, { cwd: web, env, stdio: 'ignore' });
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--directory', out], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));
const BASE = `http://localhost:${PORT}`;

const b = await browser();
try {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('artrail-cookies-ok', '1'); } catch {} });
  const page = await ctx.newPage();
  const signups = [];
  await page.route(`${SB}/auth/v1/signup*`, async (route) => {
    signups.push(route.request().postDataJSON());
    await route.fulfill({ status: 422, contentType: 'application/json',
      body: JSON.stringify({ code: 422, error_code: 'user_already_exists', msg: 'User already registered' }) });
  });
  const err = async () => (await page.textContent('[data-auth-error]')).trim();

  await page.goto(`${BASE}/signup/`);
  check('true: the age fieldset renders with three radios', (await page.$$('[data-age] input[name="age"]')).length === 3);
  check('true: the parent fields render (hidden until under 14)', (await page.$$('#parent, #pcode')).length === 2 && !(await page.isVisible('[data-parent]')));
  check('true: the form says it asks', (await page.getAttribute('[data-auth-form]', 'data-ask-age')) === 'true');
  check('true: the "at 13 a parent must agree" note shows', (await page.textContent('[data-auth-form]')).includes('родител или настойник трябва да се съгласи'));
  // The accept-terms gate is behind a sign-in, so its built page is checked as a file.
  const gate = fs.readFileSync(path.join(out, 'accept-terms/index.html'), 'utf8');
  check('true: accept-terms still has the age radios and parent fields',
    (gate.match(/name="age"/g) ?? []).length === 3 && gate.includes('data-parent-email') && gate.includes('"askAge":true'));
  await page.fill('#email', 'lab-test-age@example.com');
  await page.fill('#password', 'Lab-test-password-1');
  await page.check('[data-auth-agree]');
  await page.check('input[name="role"][value="viewer"]');

  await page.click('[data-auth-submit]');
  await page.waitForTimeout(500);
  check('true: no age answer -> err.age, no request', (await err()).includes('Кажи ни на колко години си.') && signups.length === 0, await err());

  await page.check('input[name="age"][value="under14"]');
  check('true: under 14 reveals the parent fields', await page.isVisible('[data-parent]'));
  await page.click('[data-auth-submit]');
  await page.waitForTimeout(500);
  check('true: under 14 without a parent -> err.parentEither, no request', (await err()).includes('имейла на родител') && signups.length === 0, await err());

  await page.fill('#parent', 'lab-test-parent@example.com');
  await page.click('[data-auth-submit]');
  await page.waitForTimeout(1500);
  const young = signups[0]?.data ?? {};
  check("true: under 14 sends age_band 'under14' + parent_email", young.age_band === 'under14' && young.parent_email === 'lab-test-parent@example.com', JSON.stringify(young));

  await page.check('input[name="age"][value="14+"]');
  await page.click('[data-auth-submit]');
  await page.waitForTimeout(1500);
  const adult = signups[1]?.data ?? {};
  check("true: 14+ sends age_band '14+' and no parent", adult.age_band === '14+' && !('parent_email' in adult) && !('parent_code' in adult), JSON.stringify(adult));

  await page.check('input[name="age"][value="under13"]');
  const before = signups.length;
  await page.click('[data-auth-submit]');
  await page.waitForTimeout(500);
  check('true: 12 or younger -> err.tooYoung, no request', (await err()).includes('13 и повече') && signups.length === before, await err());
} finally {
  await b.close();
  server.kill();
  fs.rmSync(out, { recursive: true, force: true });
}
done();
