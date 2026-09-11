import { strict as assert } from 'node:assert';
import test from 'node:test';
import { filterLowConfidenceWhisperSegments, groupOcrResults, normalizeCueTimeline, offsetSubtitleSegments, segmentsToCues } from './subtitles';

test('Whisper confidence filter removes a low-confidence no-speech hallucination', () => {
  const segments = filterLowConfidenceWhisperSegments([
    { start: 0, end: 2, text: 'real speech', no_speech_prob: 0.08, avg_logprob: -0.2 },
    { start: 5, end: 8, text: 'hallucinated in silence', no_speech_prob: 0.94, avg_logprob: -1.8 },
    { start: 9, end: 10, text: 'provider without metrics' },
  ]);
  assert.deepEqual(segments.map((segment) => segment.text), ['real speech', 'provider without metrics']);
});

test('OCR timing closes a subtitle on the next text or blank frame', () => {
  const cues = groupOcrResults([
    { text: 'Câu đầu', timestampMs: 1000 },
    { text: 'Câu đầu', timestampMs: 1500 },
    { text: '', timestampMs: 2000 },
    { text: 'Câu sau', timestampMs: 3000 },
    { text: '', timestampMs: 4000 },
  ], false, 500);
  assert.deepEqual(cues.map(({ startMs, endMs }) => ({ startMs, endMs })), [
    { startMs: 1000, endMs: 2000 },
    { startMs: 3000, endMs: 4000 },
  ]);
});

test('OCR watermark filtering does not erase subtitles from short clips', () => {
  const cues = groupOcrResults([
    { text: 'Hello world', timestampMs: 0 },
    { text: 'Hello world', timestampMs: 500 },
    { text: '', timestampMs: 1000 },
  ], true, 500);
  assert.equal(cues.length, 1);
  assert.equal(cues[0]?.originalText, 'Hello world');
  assert.equal(cues[0]?.endMs, 1000);
});

test('OCR grouping selects the most stable reading across adjacent frames', () => {
  const cues = groupOcrResults([
    { text: 'I am going hom', timestampMs: 0 },
    { text: 'I am going home', timestampMs: 500 },
    { text: 'I am going home', timestampMs: 1000 },
    { text: '', timestampMs: 1500 },
  ], false, 500);
  assert.equal(cues.length, 1);
  assert.equal(cues[0]?.originalText, 'I am going home');
});

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
