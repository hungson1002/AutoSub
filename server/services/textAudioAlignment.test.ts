import { strict as assert } from 'node:assert';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  alignTranscriptToAudio,
  type AlignmentCue,
} from './textAudioAlignment';
import { DEFAULT_TIMESTAMP_REFINEMENT } from './timestampRefinement';
import { cleanupUploadSession, createUploadSession } from './uploads';

function cue(startMs: number, endMs: number, text: string, extra: Partial<AlignmentCue> = {}): AlignmentCue {
  return { id: text, index: 1, startMs, endMs, originalText: text, translatedText: '', voiceGroup: 'G1', enabled: true, ...extra };
}

test('aligns the real regression shape with a long silence gap', async () => {
  const result = await alignTranscriptToAudio({
    audioPath: 'missing-regression-audio.wav',
    cues: [cue(0, 2500, '好'), cue(2500, 10860, '奈德去找朋友玩')],
    language: 'zh',
    speechRegions: [{ startMs: 0, endMs: 2440 }, { startMs: 9480, endMs: 10900 }],
    speechConfidence: 'high',
  });

  assert.deepEqual(result.cues.map(({ startMs, endMs }) => ({ startMs, endMs })), [
    { startMs: 0, endMs: 2440 },
    { startMs: 9480, endMs: 10900 },
  ]);
  assert.equal(result.entries[1].text, '奈德去找朋友玩');
  assert.equal(result.entries[1].timestampSource, 'aligned');
  assert.equal(result.entries[1].alignmentMethod, 'speech-region-sequence');
  assert.equal(result.cues[1].startMs - result.cues[0].endMs, 7040);
});

test('prefers provider word timestamps for CJK, English and Vietnamese', async () => {
  const result = await alignTranscriptToAudio({
    audioPath: 'missing-word-audio.wav',
    language: 'mixed',
    cues: [
      cue(0, 2500, '好朋友', { words: [{ word: '好朋友', start: 0.12, end: 1.04 }] }),
      cue(2500, 5000, 'find a friend', { words: [{ word: 'find', start: 2.72, end: 3.02 }, { word: 'a', start: 3.08, end: 3.18 }, { word: 'friend', start: 3.22, end: 3.92 }] }),
      cue(5000, 7500, 'Tìm một người bạn', { words: [{ word: 'Tìm', start: 5.3, end: 5.55 }, { word: 'một', start: 5.62, end: 5.9 }, { word: 'người', start: 5.95, end: 6.2 }, { word: 'bạn', start: 6.25, end: 6.55 }] }),
    ],
  });

  assert.deepEqual(result.cues.map(({ startMs, endMs }) => ({ startMs, endMs })), [
    { startMs: 120, endMs: 1040 },
    { startMs: 2720, endMs: 3920 },
    { startMs: 5300, endMs: 6550 },
  ]);
  assert.ok(result.entries.every((entry) => entry.timestampSource === 'provider-word'));
  assert.equal(result.metadata.alignmentMethod, 'provider-word');
});

test('falls back to provider segment timestamps when alignment confidence is low', async () => {
  const result = await alignTranscriptToAudio({
    audioPath: 'missing-fallback-audio.wav',
    cues: [cue(2500, 10860, 'no word timestamps')],
    speechRegions: [{ startMs: 2140, endMs: 17878 }],
    speechConfidence: 'low',
    refinementConfig: { ...DEFAULT_TIMESTAMP_REFINEMENT, searchPaddingBeforeMs: 750, searchPaddingAfterMs: 750 },
  });

  assert.deepEqual(result.cues.map(({ startMs, endMs }) => ({ startMs, endMs })), [{ startMs: 2500, endMs: 10860 }]);
  assert.equal(result.entries[0].timestampSource, 'fallback');
  assert.equal(result.metadata.fallbackCount, 1);
});

test('alignment handles 3000 cues without text tokenization assumptions', async () => {
  const regions = Array.from({ length: 3000 }, (_, index) => ({ startMs: index * 3000, endMs: index * 3000 + 1200 }));
  const cues = regions.map((region, index) => cue(region.startMs - 200, region.endMs + 200, index % 2 ? 'hello world' : '你好朋友'));
  const startedAt = Date.now();
  const result = await alignTranscriptToAudio({ audioPath: 'missing-scale-audio.wav', cues, speechRegions: regions, speechConfidence: 'high' });

  assert.equal(result.cues.length, 3000);
  assert.equal(result.metadata.refinedCount, 3000);
  assert.ok(Date.now() - startedAt < 1000);
});

test('alignment cache reuses the same transcript/audio fingerprint', async () => {
  const directory = await createUploadSession();
  const audioPath = path.join(directory, 'cache-input.wav');
  await writeFile(audioPath, Buffer.from('cache fingerprint input'));
  try {
    const input = { audioPath, cues: [cue(0, 1000, 'cached', { words: [{ word: 'cached', start: 0.1, end: 0.8 }] })] };
    const result1 = await alignTranscriptToAudio(input);
    const result2 = await alignTranscriptToAudio(input);

    assert.equal(result1.metadata.cacheHit, undefined);
    assert.equal(result2.metadata.cacheHit, true);
    assert.deepEqual(result2.cues.map(({ startMs, endMs }) => ({ startMs, endMs })), [{ startMs: 100, endMs: 800 }]);
  } finally {
    await cleanupUploadSession(directory);
  }
});
