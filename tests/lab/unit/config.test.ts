import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ASK_AGE } from '../../../web/src/lib/config.ts';

test('the age question is off for the competition build', () => {
  assert.equal(ASK_AGE, false);
});
