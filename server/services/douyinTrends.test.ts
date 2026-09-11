import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDouyinTrends } from './douyinTrends';
test('normalizes topic rankings without inventing view counts', () => {
  const items = normalizeDouyinTrends({ status_code: 0, data: { word_list: [{ word: '动画', position: 3, hot_value: 1234 }, { word: '动画' }, null, { word: '旅游', hot_value: 'bad' }] } });
  assert.deepEqual(items, [{ topic: '动画', rank: 3, heat: 1234 }, { topic: '旅游', rank: 2, heat: null }]);
});
test('rejects non-chart responses and caps output', () => {
  assert.throws(() => normalizeDouyinTrends({ status_code: 1 }));
  assert.throws(() => normalizeDouyinTrends({ status_code: 0, data: {} }));
  assert.equal(normalizeDouyinTrends({ status_code: 0, data: { word_list: Array.from({ length: 80 }, (_, i) => ({ word: `topic${i}` })) } }).length, 50);
});
