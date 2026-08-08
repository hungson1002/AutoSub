import { strict as assert } from 'node:assert';
import test from 'node:test';
import { normalizeCueTimeline, offsetSubtitleSegments, segmentsToCues } from './subtitles';

test('STT cue conversion preserves provider timestamps and silence gaps', () => {
  const cues = segmentsToCues([
    { start: 0, end: 2.44, text: 'A' },
    { start: 9.48, end: 10.9, text: 'B' },
  ]);

  assert.deepEqual(cues.map(({ startMs, endMs }) => ({ startMs, endMs })), [
    { startMs: 0, endMs: 2440 },
    { startMs: 9480, endMs: 10900 },
  ]);
  assert.equal(cues[1].startMs - cues[0].endMs, 7040);
});

test('chunk offset is added to each absolute segment timestamp', () => {
  const shifted = offsetSubtitleSegments([{ start: 3.2, end: 5.1, text: 'chunk 2' }], 600);

  assert.deepEqual(shifted, [{ start: 603.2, end: 605.1, text: 'chunk 2' }]);
  const cues = segmentsToCues(shifted);
  assert.deepEqual(cues.map(({ startMs, endMs }) => ({ startMs, endMs })), [{ startMs: 603200, endMs: 605100 }]);
});

test('chunk offset preserves provider word timestamps', () => {
  const shifted = offsetSubtitleSegments([{ start: 3.2, end: 5.1, text: 'worded', words: [{ word: 'worded', start: 3.4, end: 4.2 }] }], 600);
  assert.deepEqual(shifted[0].words, [{ word: 'worded', start: 603.4, end: 604.2 }]);
  assert.deepEqual(segmentsToCues(shifted)[0].words, [{ word: 'worded', start: 603.4, end: 604.2 }]);
});

test('timeline normalization repairs overlap only and keeps a real gap', () => {
  const normalized = normalizeCueTimeline([
    { id: 'overlap', startMs: 0, endMs: 3000 },
    { id: 'overlap-2', startMs: 2900, endMs: 5000 },
    { id: 'gap', startMs: 9480, endMs: 10900 },
  ]);

  assert.deepEqual(normalized.map(({ startMs, endMs }) => ({ startMs, endMs })), [
    { startMs: 0, endMs: 3000 },
    { startMs: 3000, endMs: 5000 },
    { startMs: 9480, endMs: 10900 },
  ]);
  assert.equal(normalized[2].startMs - normalized[1].endMs, 4480);
});

test('timeline normalization clips a nested cue instead of hiding it behind the previous cue', () => {
  const normalized = normalizeCueTimeline([
    { id: 'outer', startMs: 2140, endMs: 5750 },
    { id: 'nested', startMs: 2520, endMs: 3920 },
  ]);

  assert.deepEqual(normalized.map(({ startMs, endMs }) => ({ startMs, endMs })), [
    { startMs: 2140, endMs: 2520 },
    { startMs: 2520, endMs: 3920 },
  ]);
});
