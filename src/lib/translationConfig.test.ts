import assert from 'node:assert/strict';
import test from 'node:test';
import { translationBatchSize } from './translationConfig';

test('translation batches reduce provider round trips while keeping bounded context', () => {
  assert.equal(translationBatchSize('quality'), 20);
  assert.equal(translationBatchSize('fast'), 32);
});
