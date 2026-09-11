import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTopicVerdicts, assessDouyinTopic } from './douyinRelevance';

test('missing assessments remain uncertain, not silently rejected', () => {
  const result = parseTopicVerdicts('[{"id":"12345","verdict":"match","reason":"Cùng chủ đề"}]', ['12345', '54321']);
  assert.equal(result[0].verdict, 'match');
  assert.equal(result[1].verdict, 'uncertain');
});
test('rejects invented IDs, duplicated IDs and invalid verdicts', () => {
  for (const raw of ['{}', '[{"id":"99999","verdict":"match","reason":"x"}]', '[{"id":"12345","verdict":"yes","reason":"x"}]', '[{"id":"12345","verdict":"match","reason":"x"},{"id":"12345","verdict":"match","reason":"x"}]']) assert.throws(() => parseTopicVerdicts(raw, ['12345']));
});
test('rejects unbounded requests before calling a provider', async () => {
  await assert.rejects(assessDouyinTopic({}));
  await assert.rejects(assessDouyinTopic({ topic: 'x', model: 'x', provider: { baseUrl: 'https://example.com' }, items: Array(21).fill({ id: '12345', title: 'x' }) }));
});
