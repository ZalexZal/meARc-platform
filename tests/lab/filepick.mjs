// Website copy sweep (12 Nov 2026): the translated file pickers and the copy
// buttons' fallback when the clipboard refuses.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { browser, BASE, check, done, makeUser, cleanUsers, signIn } from './lib.mjs';

const b = await browser();
const errs = [];
const tmp = path.join(os.tmpdir(), 'filepick-lab.csv');
fs.writeFileSync(tmp, 'name_bg,name_en\nТест,Test\n');

async function open(u, lang) {
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: lang === '/en' ? 'en-GB' : 'bg-BG' });
  // The clipboard refuses, as on a page served without https.
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no')) }, configurable: true });
    document.execCommand = () => false;
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  await signIn(p, u, lang);
  await p.click('[data-cookie-ok]', { timeout: 3000 }).catch(() => {});
  return p;
}

try {
  const u = await makeUser('filepick');
  const p = await open(u, '');
  await p.goto(`${BASE}/my-trails/?new=1`);
  await p.waitForSelector('[data-create]:not([hidden])', { timeout: 15000 });
  await p.fill('[data-new-name]', 'Лаб файлове');
  await p.click('[data-create-submit]');
  await p.waitForURL(/trail/, { timeout: 20000 });
  await p.waitForSelector('[data-trail-mode]', { timeout: 15000 });
  await p.waitForTimeout(2500);

  const texts = await p.$$eval('[data-filepick]', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  check('five translated pickers', texts.length === 5, String(texts.length));
  check('BG: no English picker text', texts.every((x) => /Избери (файл|снимки)/.test(x) && x.includes('Няма избран файл')), JSON.stringify(texts));
  check('AI picker says photos', texts.some((x) => x.startsWith('Избери снимки')));
  const hidden = await p.$eval('[data-imp-file]', (e) => { const r = e.getBoundingClientRect(); return r.width <= 1 && r.height <= 1; });
  check('native input is visually hidden but in the page', hidden);
  await p.setInputFiles('[data-imp-file]', tmp);
  await p.waitForTimeout(300);
  const name = await p.$eval('[data-imp-file]', (e) => e.closest('[data-filepick]').querySelector('[data-filepick-name]').textContent);
  check('name shown after choosing', name === 'filepick-lab.csv', name);
  check('existing change handler still ran', (await p.inputValue('[data-imp-text]')).includes('Тест'));
  await p.$eval('[data-imp-file]', (e) => { e.value = ''; });
  const reset = await p.$eval('[data-imp-file]', (e) => e.closest('[data-filepick]').querySelector('[data-filepick-name]').textContent);
  check('clearing the input restores the empty text', reset === 'Няма избран файл', reset);
  await p.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  await p.keyboard.press('Tab');
  await p.focus('[data-imp-file]');
  check('input is focusable', await p.$eval('[data-imp-file]', (e) => document.activeElement === e), await p.$eval('[data-imp-file]', (e) => `${e.offsetParent === null ? 'no offsetParent' : 'laid out'}`));

  // Copy in the editor when the clipboard refuses.
  await p.click('[data-copy-code]');
  await p.waitForTimeout(150);
  const lab = (await p.textContent('[data-copy-code]')).trim();
  const sel = await p.evaluate(() => String(window.getSelection()));
  const code = (await p.textContent('[data-trail-code]')).trim();
  check('editor copy: "Копирай ръчно"', lab === 'Копирай ръчно', lab);
  check('editor copy: code selected', sel.trim().toUpperCase() === code.toUpperCase() && code.length > 0, sel);
  await p.waitForTimeout(1600);
  check('editor copy: label returns', (await p.textContent('[data-copy-code]')).trim() === 'Копирай');
  await p.click('[data-ed-tab=share]');
  await p.waitForSelector('[data-share-copy-code]', { state: 'visible', timeout: 8000 }).catch(() => {});
  if (await p.isVisible('[data-share-copy-code]')) {
    await p.click('[data-share-copy-code]');
    await p.waitForTimeout(150);
    check('sharing card: copy code falls back', (await p.textContent('[data-share-copy-code]')).trim() === 'Копирай ръчно');
    await p.click('[data-share-copy-link]');
    await p.waitForTimeout(150);
    check('sharing card: copy link falls back', (await p.textContent('[data-share-copy-link]')).trim() === 'Копирай ръчно');
  } else console.log('NOTE sharing card not visible (trail not shared yet)');

  // My trails.
  await p.goto(`${BASE}/my-trails/`);
  await p.waitForSelector('[data-copy]', { timeout: 15000 }).catch(() => {});
  if (await p.$('[data-copy]')) {
    await p.waitForTimeout(1500);
    await p.click('[data-copy]');
    await p.waitForTimeout(150);
    const l2 = (await p.textContent('[data-copy-label]')).trim();
    const s2 = await p.evaluate(() => String(window.getSelection()));
    check('my trails: "Копирай ръчно"', l2 === 'Копирай ръчно', l2);
    check('my trails: code selected', s2.trim().length > 3, s2);
    await p.waitForTimeout(1600);
    check('my trails: label returns', (await p.textContent('[data-copy-label]')).trim() === 'Копирай кода');
  } else console.log('NOTE no code on my trails');

  const e = await open(u, '/en');
  await e.goto(`${BASE}/en/my-trails/`);
  await e.waitForSelector('[data-copy]', { timeout: 15000 }).catch(() => {});
  if (await e.$('[data-copy]')) {
    await e.click('[data-copy]');
    await e.waitForTimeout(150);
    check('EN my trails: "Copy it by hand"', (await e.textContent('[data-copy-label]')).trim() === 'Copy it by hand');
  }
  const en = await open(u, '/en');
  await en.goto(`${BASE}/en/my-trails/?new=1`);
  await en.waitForSelector('[data-create]:not([hidden])', { timeout: 15000 });
  await en.fill('[data-new-name]', 'Lab files');
  await en.click('[data-create-submit]');
  await en.waitForURL(/trail/, { timeout: 20000 });
  await en.waitForSelector('[data-trail-mode]', { timeout: 15000 });
  await en.waitForTimeout(2000);
  const et = await en.$$eval('[data-filepick]', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  check('EN: Choose file / No file chosen', et.every((x) => /Choose (file|photos)/.test(x) && x.includes('No file chosen')), JSON.stringify(et));
  check('no page errors', errs.length === 0, errs.join(' | '));
} catch (e) {
  check('test ran to the end', false, e.message);
} finally {
  await cleanUsers();
  await b.close();
  done();
}
