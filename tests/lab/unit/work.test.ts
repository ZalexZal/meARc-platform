import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featuresFor, defaultCategory, WORKS, CATEGORIES, fold, matches } from '../../../web/src/lib/work.ts';

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
