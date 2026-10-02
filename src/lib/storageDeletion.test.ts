import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteStorageInBatches } from './storageDeletion';

const items = Array.from({ length: 410 }, (_, index) => ({ categoryId: 'uploads', name: String(index) }));

test('410 selected storage items are sent sequentially as 200, 200, 10', async () => {
  const sizes: number[] = [];
  const progress: number[] = [];
  const sent: typeof items = [];
  const result = await deleteStorageInBatches(items, async batch => {
    sizes.push(batch.length); sent.push(...batch);
    return { deletedCount: batch.length, freedBytes: batch.length * 10, errors: [] };
  }, processed => progress.push(processed));
  assert.deepEqual(sizes, [200, 200, 10]);
  assert.deepEqual(sent, items);
  assert.deepEqual(progress, [200, 400, 410]);
  assert.deepEqual(result, { deletedCount: 410, freedBytes: 4100, errors: [] });
});

test('a later request failure retains earlier progress and all remaining items', async () => {
  let calls = 0;
  const result = await deleteStorageInBatches(items, async batch => {
    if (++calls === 2) throw new Error('Connection lost');
    return { deletedCount: batch.length, freedBytes: 100, errors: [] };
  });
  assert.equal(calls, 2);
  assert.equal(result.deletedCount, 200);
  assert.equal(result.freedBytes, 100);
  assert.deepEqual(result.errors.map(({ categoryId, name }) => ({ categoryId, name })), items.slice(200));
});

test('blocked items do not prevent subsequent batches from being deleted', async () => {
  const result = await deleteStorageInBatches(items, async batch => ({
    deletedCount: batch.length - 1, freedBytes: 10,
    errors: [{ ...batch[0]!, error: 'Active job' }],
  }));
  assert.equal(result.deletedCount, 407);
  assert.equal(result.errors.length, 3);
});
