import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featuresFor, defaultCategory, WORKS, CATEGORIES, fold, matches, categoryLabel, workLabel } from '../../../web/src/lib/work.ts';
import { trailLine, modeLine } from '../../../web/src/lib/modes.ts';
import { ui } from '../../../web/src/i18n/ui.ts';

test('broker sees only the AI-first start', () => {
  assert.deepEqual(featuresFor('broker'), {
    teams: false, order: false, questions: false, results: false,
    teamSettings: false, oneAtATime: false, aiFirst: true,
  });
});

test('guide: order and questions, no teams or results', () => {
  const f = featuresFor('guide');
  assert.equal(f.questions, true);
  assert.equal(f.teams, false);
  assert.equal(f.order, true);
  assert.equal(f.results, false);
  assert.equal(f.teamSettings, false);
  assert.equal(f.oneAtATime, true);
});

test('teacher and other get everything', () => {
  for (const w of ['teacher', 'other'] as const) {
    const f = featuresFor(w);
    assert.equal(f.teams && f.order && f.questions && f.results && f.teamSettings && f.oneAtATime, true);
  }
});

test('null (not asked yet) behaves as other', () => {
  assert.deepEqual(featuresFor(null), featuresFor('other'));
  assert.equal(defaultCategory(null), 'other');
});

test('featuresFor returns a copy: callers cannot change the shared table', () => {
  const a = featuresFor('broker');
  assert.throws(() => { (a as any).teams = true; });
  assert.equal(featuresFor('broker').teams, false);
});

test('default category follows the line of work', () => {
  assert.equal(defaultCategory('broker'), 'estate');
  assert.equal(defaultCategory('teacher'), 'education');
  assert.equal(defaultCategory('guide'), 'tourism');
  assert.equal(defaultCategory('other'), 'other');
});

test('lists', () => {
  assert.deepEqual([...WORKS], ['broker', 'teacher', 'guide', 'other']);
  assert.deepEqual([...CATEGORIES], ['education', 'tourism', 'estate', 'other']);
});

test('fold: case, accents, Cyrillic', () => {
  assert.equal(fold('Ямбол'), 'yambol');
  assert.equal(fold('  Щастие   ЖЪЛТО\tЦЪРКВА '), 'shtastie zhalto tsarkva');
  assert.equal(fold('Café Münchën'), 'cafe munchen');
  assert.equal(fold('Йордан Юли Ячо Чудо Хляб'), 'yordan yuli yacho chudo hlyab');
  assert.equal(fold(''), '');
});

test('matches: city in either language', () => {
  const trail = { name: 'Безистен', city: { bg: 'Ямбол', en: 'Yambol' } };
  assert.equal(matches('yambol', trail), true);
  assert.equal(matches('ямбол', trail), true);
  assert.equal(matches('YAMBOL безистен', trail), true);
});

test('matches: every word counts, partial words are fine', () => {
  assert.equal(matches('ески джам', { name: 'Ески джамия' }), true);
  assert.equal(matches('ески мост', { name: 'Ески джамия' }), false);
});

test('matches: no match, empty query, missing city', () => {
  assert.equal(matches('sofia', { name: 'Безистен', city: { bg: 'Ямбол' } }), false);
  assert.equal(matches('', { name: 'Безистен' }), true);
  assert.equal(matches('безистен', { name: 'Безистен', city: null }), true);
});

const yambol = { key: 'yambol', bg: 'Ямбол', en: 'Yambol', lat: 42.48, lng: 26.5 };

test('labels: every work and category in both languages', () => {
  assert.deepEqual(WORKS.map((w) => workLabel(w, 'bg')), ['Брокер на недвижими имоти', 'Учител', 'Екскурзовод', 'Друго']);
  assert.deepEqual(WORKS.map((w) => workLabel(w, 'en')), ['Estate broker', 'Teacher', 'Tour guide', 'Other']);
  assert.deepEqual(CATEGORIES.map((c) => categoryLabel(c, 'bg')), ['Образование', 'Туризъм', 'Недвижими имоти', 'Друго']);
  assert.deepEqual(CATEGORIES.map((c) => categoryLabel(c, 'en')), ['Education', 'Tourism', 'Real estate', 'Other']);
});

test('trailLine: estate shows category and city, never the mode', () => {
  assert.equal(trailLine('educational', 'estate', yambol, 'bg'), 'Недвижими имоти · Ямбол');
  assert.equal(trailLine('ctf', 'estate', yambol, 'en'), 'Real estate · Yambol');
});

test('trailLine: estate without a city is just the category', () => {
  assert.equal(trailLine('educational', 'estate', null, 'bg'), 'Недвижими имоти');
});

test('trailLine: other categories lead with the mode line', () => {
  assert.ok(trailLine('ctf', 'education', null, 'bg').startsWith('Отбори и класиране'));
  assert.equal(trailLine('ctf', 'education', null, 'bg'), `${modeLine('ctf', 'bg')} · Образование`);
  assert.equal(
    trailLine('educational', 'tourism', yambol, 'en'),
    'No teams · Any order · Tourism · Yambol',
  );
});

test('trailLine: empty parts are dropped, no stray separators', () => {
  const noName = { ...yambol, en: '', bg: '' };
  assert.equal(trailLine('guide', 'other', noName, 'bg'), `${modeLine('guide', 'bg')} · Друго`);
  assert.equal(trailLine('guide', 'estate', noName, 'en'), 'Real estate');
});

test('strings: new keys exist in both languages and the labels match work.ts', () => {
  const keys = [
    'work.title', 'work.broker', 'work.teacher', 'work.guide', 'work.other', 'work.otherHint', 'work.ask', 'work.change',
    'cat.education', 'cat.tourism', 'cat.estate', 'cat.other', 'cat.all', 'cat.label',
    'city.label', 'city.none', 'city.auto',
    'find.search', 'find.allCities', 'find.nothing', 'find.nothingFiltered', 'find.clear',
    'ed.hiddenQuestions', 'err.work',
  ] as const;
  for (const lang of ['bg', 'en'] as const) {
    const t = ui[lang] as Record<string, string>;
    for (const k of keys) assert.ok(t[k] && t[k].length > 0, `${lang} ${k}`);
    for (const w of WORKS) assert.equal(t[`work.${w}`], workLabel(w, lang));
    for (const c of CATEGORIES) assert.equal(t[`cat.${c}`], categoryLabel(c, lang));
    assert.ok(t['find.nothing'].includes('{0}'), `${lang} find.nothing takes the search`);
  }
});

test('strings: find.clear and find.nothingFiltered', () => {
  assert.equal(ui.bg['find.clear'], 'Изчисти филтрите');
  assert.equal(ui.en['find.clear'], 'Clear filters');
  assert.equal(ui.bg['find.nothingFiltered'], 'Няма маршрути с тези филтри.');
  assert.equal(ui.en['find.nothingFiltered'], 'No trails match these filters.');
  assert.ok(!ui.bg['find.nothingFiltered'].includes('{0}'));
});

test('strings: verbatim texts', () => {
  assert.equal(ui.bg['err.work'], 'Изберете с какво се занимавате.');
  assert.equal(ui.en['err.work'], 'Choose your line of work.');
  assert.equal(ui.bg['work.otherHint'], 'Всички възможности — и ако само ще вървите по маршрути.');
  assert.equal(ui.en['work.otherHint'], 'Every option — and for people who only walk trails.');
  assert.equal(ui.bg['ed.hiddenQuestions'], 'Този маршрут има въпроси. Сменете заниманието си на Учител или Друго, за да ги редактирате.');
  assert.equal(ui.en['ed.hiddenQuestions'], 'This trail has questions. Switch your line of work to Teacher or Other to edit them.');
});

import { loadWork, saveWork } from '../../../web/src/lib/work.ts';

// A client double that records the update and answers like PostgREST.
function fakeClient(row: any, updateError: any = null, selectError: any = null) {
  const seen: any = {};
  return {
    seen,
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: (table: string) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: selectError ? null : row, error: selectError }) }) }),
      update: (patch: any) => ({ eq: async (col: string, val: string) => { Object.assign(seen, { table, patch, col, val }); return { error: updateError }; } }),
    }),
  };
}

test('loadWork reads profiles.work, null when never asked', async () => {
  assert.equal(await loadWork(fakeClient({ work: 'guide' })), 'guide');
  assert.equal(await loadWork(fakeClient({ work: null })), null);
  assert.equal(await loadWork(fakeClient(null)), null);
  assert.equal(await loadWork(fakeClient({ work: 'pilot' })), null);
});

test('saveWork updates the own row and returns null on success', async () => {
  const c = fakeClient(null);
  assert.equal(await saveWork(c, 'broker'), null);
  assert.deepEqual(c.seen, { table: 'profiles', patch: { work: 'broker' }, col: 'id', val: 'u1' });
});

test('saveWork returns the error message on failure', async () => {
  assert.equal(await saveWork(fakeClient(null, { message: 'nope' }), 'broker'), 'nope');
});

test('loadWork: a failed read is undefined, never "never asked"', async () => {
  assert.equal(await loadWork(fakeClient(null, null, { message: 'boom' })), undefined);
  const signedOut = { ...fakeClient(null), auth: { getSession: async () => ({ data: { session: null } }) } };
  assert.equal(await loadWork(signedOut), undefined);
});

test('trailLine with withMode=false is only Category · City', () => {
  const city = { key: 'yambol', bg: 'Ямбол', en: 'Yambol', lat: 0, lng: 0 };
  assert.equal(trailLine('ctf', 'other', city, 'bg', false), 'Друго · Ямбол');
  assert.equal(trailLine('ctf', 'tourism', null, 'en', false), 'Tourism');
  assert.equal(trailLine('ctf', 'other', city, 'bg'), 'Отбори и класиране · По ред · Друго · Ямбол');
});
