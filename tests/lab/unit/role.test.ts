import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sealState, roleLabel, isRole, ROLES, GLYPHS, sealMarkup, saveRole, loadRole, stageFor, ICONS } from '../../../web/src/lib/role.ts';

test('roles and labels', () => {
  assert.deepEqual(ROLES, ['creator', 'viewer']);
  assert.equal(roleLabel('creator', 'bg'), 'Създател');
  assert.equal(roleLabel('viewer', 'bg'), 'Зрител');
  assert.equal(roleLabel('creator', 'en'), 'Creator');
  assert.equal(roleLabel('viewer', 'en'), 'Viewer');
  assert.equal(isRole('creator'), true);
  assert.equal(isRole('admin'), false);
  assert.equal(isRole(null), false);
});

test('glyph paths are the agreed ones', () => {
  assert.equal(GLYPHS.teacher, 'M2 9l10-5 10 5-10 5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5M22 9v6');
  assert.equal(GLYPHS.guide, 'M12 21V3M6 5h10l3 2.5L16 10H6zM18 13H8l-3 2.5L8 18h10z');
  assert.equal(GLYPHS.broker, 'M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5');
  assert.equal(GLYPHS.other, 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z');
  assert.equal(GLYPHS.viewer, 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0.01 0z');
  assert.equal(GLYPHS.pencil, 'M4 20l4-1 10-10-3-3L5 16zM14 7l3 3');
  assert.equal(GLYPHS.ask, 'M9 9a3 3 0 1 1 4 2.8c-.7.3-1 .8-1 1.5V14M12 17.5v.01');
});

test('nothing chosen: a dashed question mark', () => {
  const s = sealState(null, null, 'bg');
  assert.equal(s.shape, 'ask');
  assert.equal(s.glyph, 'ask');
  assert.equal(s.pip, false);
  assert.equal(s.title, 'Как ще използвате AR Trail?');
  assert.equal(s.body, 'Изберете отдясно. Знакът тук се сменя с избора ви и после стои до името ви.');
  assert.deepEqual(s.gets, []);
  // A work without a role is still "nothing chosen" here.
  assert.equal(sealState(null, 'guide', 'bg').shape, 'ask');
});

test('viewer: a round seal with an eye, work ignored', () => {
  for (const w of [null, 'teacher', 'broker'] as const) {
    const s = sealState('viewer', w, 'bg');
    assert.equal(s.shape, 'round');
    assert.equal(s.glyph, 'viewer');
    assert.equal(s.pip, false);
    assert.equal(s.title, 'Зрител');
    assert.equal(s.body, 'Разглеждате обществената библиотека и се включвате в маршрути с код.');
    assert.deepEqual(s.gets, ['Обществени маршрути наблизо', 'Влизане с код', 'Без настройки']);
  }
});

test('creator without a work: square, pencil, no list', () => {
  const s = sealState('creator', null, 'bg');
  assert.equal(s.shape, 'square');
  assert.equal(s.glyph, 'pencil');
  assert.equal(s.pip, false);
  assert.equal(s.title, 'Създател');
  assert.equal(s.body, 'Изберете с какво се занимавате — ще ви показваме само нужното.');
  assert.deepEqual(s.gets, []);
});

test('creator states: square, job glyph, pencil pip', () => {
  const cases = {
    teacher: ['Образование · създател', 'Уроци на открито: отбори, въпроси за точки, подсказки и класиране на живо.',
      ['Отбори и класиране', 'Въпроси за точки и подсказки', 'По ред или свободно']],
    guide: ['Туризъм · създател', 'Разходки с истории: въпроси и подсказки без точки, по ред или свободно.',
      ['Въпроси и подсказки, без точки', 'По ред или свободно', '3D, снимки, видео и звук']],
    broker: ['Недвижими имоти · създател', 'Покажете сградата на мястото ѝ: 3D модел на парцела, без отбори и въпроси.',
      ['3D модел на място', 'Модел от снимка с AI', 'Само нужното — без въпроси']],
    other: ['Създател', 'Всички възможности, без ограничения.',
      ['Всичко от останалите три', 'Сменяте по всяко време']],
  } as const;
  for (const [w, [title, body, gets]] of Object.entries(cases)) {
    const s = sealState('creator', w as any, 'bg');
    assert.equal(s.shape, 'square', w);
    assert.equal(s.glyph, w, w);
    assert.equal(s.pip, true, w);
    assert.equal(s.title, title, w);
    assert.equal(s.body, body, w);
    assert.deepEqual(s.gets, gets, w);
  }
});

test('English: every state has its own words', () => {
  assert.equal(sealState(null, null, 'en').title, 'How will you use AR Trail?');
  assert.equal(sealState('viewer', null, 'en').title, 'Viewer');
  assert.equal(sealState('creator', null, 'en').title, 'Creator');
  assert.equal(sealState('creator', 'teacher', 'en').title, 'Education · creator');
  assert.equal(sealState('creator', 'guide', 'en').title, 'Tourism · creator');
  assert.equal(sealState('creator', 'broker', 'en').title, 'Real estate · creator');
  assert.equal(sealState('creator', 'other', 'en').title, 'Creator');
  for (const r of [null, 'viewer', 'creator'] as const) {
    for (const w of [null, 'teacher', 'guide', 'broker', 'other'] as const) {
      const bg = sealState(r, w, 'bg'), en = sealState(r, w, 'en');
      assert.equal(en.gets.length, bg.gets.length);
      assert.equal(en.shape, bg.shape);
      assert.ok(!/[а-я]/i.test(en.title + en.body + en.gets.join('')), `${r}/${w} EN has Cyrillic`);
    }
  }
});

test('the state is a fresh object, not shared', () => {
  const a = sealState('viewer', null, 'bg');
  a.gets.push('x');
  assert.equal(sealState('viewer', null, 'bg').gets.length, 3);
});

test('seal markup carries the data attributes and no outside text', () => {
  const html = sealMarkup(sealState('creator', 'guide', 'bg'), { selected: true });
  assert.match(html, /data-seal-shape="square"/);
  assert.match(html, /data-seal-glyph="guide"/);
  assert.match(html, /data-seal-pip="true"/);
  assert.ok(html.includes(GLYPHS.guide));
  assert.ok(html.includes(GLYPHS.pencil));
  const ask = sealMarkup(sealState(null, null, 'bg'));
  assert.match(ask, /data-seal-shape="ask"/);
  assert.match(ask, /data-seal-pip="false"/);
});

// A fake client that records the one update it is asked for.
function fake(read: { data: any; error: any }, session = true) {
  const calls: any[] = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: session ? { user: { id: 'u1' } } : null } }) },
    from: (_t: string) => ({
      select: (_c: string) => ({ eq: () => ({ maybeSingle: async () => read }) }),
      update: (patch: any) => ({ eq: async (col: string, val: string) => { calls.push({ patch, col, val }); return { error: null }; } }),
    }),
  };
  return { client, calls };
}

test('saveRole: a creator writes role and work in one update', async () => {
  const { client, calls } = fake({ data: null, error: null });
  assert.equal(await saveRole(client as any, 'creator', 'broker'), null);
  assert.deepEqual(calls, [{ patch: { role: 'creator', work: 'broker' }, col: 'id', val: 'u1' }]);
});

test('saveRole: a viewer writes the role only, never work', async () => {
  const { client, calls } = fake({ data: null, error: null });
  assert.equal(await saveRole(client as any, 'viewer', 'teacher'), null);
  assert.deepEqual(calls, [{ patch: { role: 'viewer' }, col: 'id', val: 'u1' }]);
});

test('loadRole: null for never asked, undefined for a failed read', async () => {
  assert.equal(await loadRole(fake({ data: { role: null }, error: null }).client as any), null);
  assert.equal(await loadRole(fake({ data: { role: 'viewer' }, error: null }).client as any), 'viewer');
  assert.equal(await loadRole(fake({ data: { role: 'admin' }, error: null }).client as any), null);
  assert.equal(await loadRole(fake({ data: null, error: { message: 'x' } }).client as any), undefined);
  assert.equal(await loadRole(fake({ data: null, error: null }, false).client as any), undefined);
});

test('stageFor: the skies are the A5 day and night colours', () => {
  const sky = (r: any, w: any) => stageFor(r, w, 'bg').sky;
  assert.deepEqual(sky('creator', 'teacher'), { day: '#d3ecd6', night: '#0f2a22' });
  assert.deepEqual(sky('creator', 'guide'), { day: '#f9e2bd', night: '#2b2114' });
  assert.deepEqual(sky('creator', 'broker'), { day: '#cfe5f8', night: '#0d2238' });
  assert.deepEqual(sky('creator', 'other'), { day: '#e3e8f0', night: '#1b2130' });
  assert.deepEqual(sky('viewer', null), { day: '#d0ece2', night: '#0f2a24' });
  assert.deepEqual(sky(null, null), { day: '#ecedf0', night: '#17191c' });
});

test('stageFor: keys, a viewer ignores work, a creator without work is none', () => {
  assert.equal(stageFor('creator', 'teacher', 'bg').key, 'teacher');
  assert.equal(stageFor('creator', 'other', 'bg').key, 'other');
  assert.equal(stageFor('viewer', 'broker', 'bg').key, 'viewer');
  assert.equal(stageFor('creator', null, 'bg').key, 'none');
  assert.equal(stageFor(null, 'guide', 'bg').key, 'none');
  assert.equal(stageFor(null, null, 'bg').key, 'none');
});

test('stageFor BG: the A5 copy, with the label swap on the tag', () => {
  const t = stageFor('creator', 'teacher', 'bg');
  assert.equal(t.tag, 'Образование · създател');
  assert.equal(t.head, 'Уроците излизат навън.');
  assert.equal(t.sub, 'Класът тръгва на отбори, въпросите изскачат на място, класирането се движи на живо.');
  assert.deepEqual(t.signs, [
    { glyph: 'book', label: 'Уроци на открито' }, { glyph: 'team', label: 'Отбори' }, { glyph: 'chart', label: 'Класиране на живо' }]);
  assert.deepEqual(t.card, { title: 'Урок в парка', meta: '4 спирки · ~30 мин · отбори', stops: 4 });
  assert.deepEqual(t.moment, { glyph: 'plus', text: 'Отбор Север · +10 т.' });
  const g = stageFor('creator', 'guide', 'bg');
  assert.equal(g.tag, 'Туризъм · създател');
  assert.equal(g.head, 'Историята — там, където се е случила.');
  assert.deepEqual(g.card, { title: 'Разходка из стария град', meta: '6 спирки · 1,4 км · ~40 мин', stops: 4 });
  assert.deepEqual(g.moment, { glyph: 'pin', text: 'Наблизо · Източната порта' });
  const b = stageFor('creator', 'broker', 'bg');
  assert.equal(b.tag, 'Недвижими имоти · създател');
  assert.equal(b.head, 'Сградата — на парцела, преди да е построена.');
  assert.deepEqual(b.signs.map((x) => x.glyph), ['house', 'ar', 'camera']);
  assert.deepEqual(b.card, { title: 'Оглед на парцела', meta: '1 спирка · 3D модел · за клиент', stops: 1 });
  assert.deepEqual(b.moment, { glyph: 'check', text: 'Клиентът е на парцела' });
  const o = stageFor('creator', 'other', 'bg');
  assert.equal(o.tag, 'Друго · създател');
  assert.equal(stageFor('creator', 'other', 'en').tag, 'Other · creator');
  assert.equal(o.head, 'Каквото поставите, хората го виждат на място.');
  assert.deepEqual(o.signs.map((x) => x.glyph), ['sliders', 'route', 'swap']);
  assert.deepEqual(o.card, { title: 'Моят маршрут', meta: '5 спирки · свободен ред', stops: 3 });
  assert.deepEqual(o.moment, { glyph: 'pin', text: 'Спирка 2 от 5' });
  const v = stageFor('viewer', null, 'bg');
  assert.equal(v.tag, 'Зрител');
  assert.equal(v.head, 'Тръгнете. Телефонът ще ви покаже останалото.');
  assert.deepEqual(v.signs.map((x) => x.glyph), ['map', 'key', 'camera']);
  assert.deepEqual(v.card, { title: 'Ямбол през вековете', meta: 'наблизо · 350 м до началото', stops: 4 });
  assert.deepEqual(v.moment, { glyph: 'arrow', text: 'Следваща · 180 м' });
});

test('stageFor: nothing chosen and creator without work', () => {
  const n = stageFor(null, null, 'bg');
  assert.equal(n.tag, 'Нов профил');
  assert.equal(n.head, 'Едно място. Една история. Вашият телефон.');
  assert.equal(n.sub, 'Изберете вдясно как ще ползвате AR Trail — и вижте какво ви чака.');
  assert.deepEqual(n.signs, []);
  assert.equal(n.card, null);
  assert.equal(n.moment, null);
  const c = stageFor('creator', null, 'bg');
  assert.equal(c.tag, 'Създател');
  assert.equal(c.head, n.head);
  assert.equal(stageFor(null, null, 'en').tag, 'New profile');
});

test('stageFor: every icon is drawn, EN is plain English, same shape as BG', () => {
  for (const r of [null, 'viewer', 'creator'] as const) {
    for (const w of [null, 'teacher', 'guide', 'broker', 'other'] as const) {
      const bg = stageFor(r, w, 'bg'), en = stageFor(r, w, 'en');
      assert.equal(en.key, bg.key);
      assert.equal(en.signs.length, bg.signs.length);
      assert.equal(en.card?.stops, bg.card?.stops);
      const words = [en.tag, en.head, en.sub, ...en.signs.map((x) => x.label), en.card?.title ?? '', en.card?.meta ?? '', en.moment?.text ?? ''].join(' ');
      assert.ok(!/[а-я]/i.test(words), `${r}/${w} EN has Cyrillic`);
      for (const s of en.signs) assert.ok(ICONS[s.glyph], `${r}/${w} icon ${s.glyph}`);
      if (en.moment) assert.ok(ICONS[en.moment.glyph], `${r}/${w} moment icon`);
    }
  }
  assert.equal(stageFor('creator', 'teacher', 'en').tag, 'Education · creator');
  assert.equal(stageFor('creator', 'other', 'en').tag, 'Other · creator');
  assert.equal(stageFor('viewer', null, 'en').tag, 'Viewer');
});

test('stageFor is a fresh object, not shared', () => {
  const a = stageFor('creator', 'teacher', 'bg');
  a.signs.push({ glyph: 'book', label: 'x' });
  a.card!.stops = 99;
  assert.equal(stageFor('creator', 'teacher', 'bg').signs.length, 3);
  assert.equal(stageFor('creator', 'teacher', 'bg').card!.stops, 4);
});
