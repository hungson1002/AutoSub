import assert from 'node:assert/strict';
import test from 'node:test';
import { mapTranslationBatches, translationBatchSize, translationConcurrency } from './translationConfig';

test('translation batches reduce provider round trips while keeping bounded context', () => {
  assert.equal(translationBatchSize('quality'), 20);
  assert.equal(translationBatchSize('fast'), 32);
});

test('parallel translation preserves batch order', async () => {
  const active = { value: 0, peak: 0 };
  const result = await mapTranslationBatches([1, 2, 3, 4], 2, async (value) => {
    active.value++; active.peak = Math.max(active.peak, active.value);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active.value--;
    return value * 2;
  });
  assert.deepEqual(result, [2, 4, 6, 8]);
  assert.equal(active.peak, 2);
});

test('translation concurrency remains bounded by mode', () => {
  assert.equal(translationConcurrency('quality'), 2);
  assert.equal(translationConcurrency('fast'), 3);
});
