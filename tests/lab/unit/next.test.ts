import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameSitePath } from '../../../web/src/lib/next.ts';

const O = 'https://artrail.example';

test('a same-site path is kept, with its query and hash', () => {
  assert.equal(sameSitePath('/trails/', O), '/trails/');
  assert.equal(sameSitePath('/view/?id=1#map', O), '/view/?id=1#map');
  assert.equal(sameSitePath('/choose-role/?next=%2Ftrails%2F', O), '/choose-role/?next=%2Ftrails%2F');
  assert.equal(sameSitePath(`${O}/my-trails/`, O), '/my-trails/');
});

test('anything that leaves the site is refused', () => {
  for (const bad of [
    '/\t/evil.com',          // tab: browsers strip it, leaving //evil.com
    '/\\evil.com',           // backslash: read as //evil.com
    '\\\\evil.com',
    '//evil.com',
    '/.//evil.com',          // resolves to the path //evil.com
    '/a/..//evil.com',
    '/./\\evil.com',
    '//evil.com/trails/',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'https://evil.com/trails/',
    'http://artrail.example.evil.com/',
    'data:text/html,hi',
  ]) {
    assert.equal(sameSitePath(bad, O), null, JSON.stringify(bad));
  }
});

test('nothing given is nothing', () => {
  assert.equal(sameSitePath(null, O), null);
  assert.equal(sameSitePath(undefined, O), null);
  assert.equal(sameSitePath('', O), null);
});
