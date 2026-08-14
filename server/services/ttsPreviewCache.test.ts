import assert from 'node:assert/strict';
import test from 'node:test';
import { cachedTtsPreview, clearTtsPreviewCache, ttsPreviewCacheStats } from './ttsPreviewCache';

test('reuses completed previews and shares an in-flight synthesis', async () => {
  clearTtsPreviewCache();
  let calls = 0;
  const create = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return Buffer.from('preview-audio');
  };

  const [first, shared] = await Promise.all([
    cachedTtsPreview('same-voice', create),
    cachedTtsPreview('same-voice', create),
  ]);
  const cached = await cachedTtsPreview('same-voice', create);

  assert.equal(calls, 1);
  assert.equal(first.cache, 'miss');
  assert.equal(shared.cache, 'shared');
  assert.equal(cached.cache, 'hit');
  assert.deepEqual(cached.audio, Buffer.from('preview-audio'));
});

test('keeps preview memory bounded by entry count', async () => {
  clearTtsPreviewCache();
  for (let index = 0; index < 70; index += 1) await cachedTtsPreview(`voice-${index}`, async () => Buffer.from([index]));
  assert.equal(ttsPreviewCacheStats().entries, 64);
});
