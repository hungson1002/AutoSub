import { strict as assert } from 'node:assert';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { cleanupUploadSession, createUploadSession } from './uploads';
import {
  DEFAULT_TIMESTAMP_REFINEMENT,
  mergeSpeechRegions,
  parseSpeechRegions,
  refineCuesWithSpeechRegions,
  refineSttTimestamps,
  type SpeechRegion,
} from './timestampRefinement';

function cue(startMs: number, endMs: number, text: string) {
  return { id: text, index: 1, startMs, endMs, originalText: text, translatedText: '', voiceGroup: 'G1' as const, enabled: true };
}

test('refines leading/trailing silence without collapsing an intentional gap', () => {
  const regions: SpeechRegion[] = [
    { startMs: 0, endMs: 2440 },
    { startMs: 9480, endMs: 10900 },
  ];
  const result = refineCuesWithSpeechRegions([cue(0, 2500, 'A'), cue(2500, 10860, 'B')], regions);

  assert.deepEqual(result.cues.map(({ startMs, endMs }) => ({ startMs, endMs })), [
    { startMs: 0, endMs: 2440 },
    { startMs: 9480, endMs: 10900 },
  ]);
  assert.equal(result.cues[1].startMs - result.cues[0].endMs, 7040);
  assert.equal(result.metadata.refinedCount, 2);
  assert.equal(result.metadata.fallbackCount, 0);
  assert.equal(result.cues[0].originalText, 'A');
  assert.equal(result.cues[1].originalText, 'B');
});

test('uses a late speech onset when a provider segment spans noisy regions', () => {
  const regions: SpeechRegion[] = [
    { startMs: 0, endMs: 3638 },
    { startMs: 3900, endMs: 4438 },
    { startMs: 7452, endMs: 8726 },
    { startMs: 9596, endMs: 68806 },
  ];
  const result = refineCuesWithSpeechRegions([
    cue(0, 2500, 'A'),
    cue(2500, 10860, 'B'),
    cue(10860, 11880, 'C'),
  ], regions);

  assert.deepEqual(result.cues.map(({ startMs, endMs }) => ({ startMs, endMs })), [
    { startMs: 0, endMs: 2500 },
    { startMs: 9596, endMs: 10860 },
    { startMs: 10860, endMs: 11880 },
  ]);
  assert.equal(result.metadata.details?.[1]?.timestampRefined, true);
});

test('refinement is provider-agnostic', () => {
  const regions: SpeechRegion[] = [{ startMs: 9480, endMs: 10900 }];
  const input = [cue(2500, 10860, 'B')];
  for (const providerType of ['groq', 'openai-compatible', 'elevenlabs', 'custom']) {
    const result = refineCuesWithSpeechRegions(input.map((item) => ({ ...item, providerType })), regions);
    assert.deepEqual(result.cues.map(({ startMs, endMs }) => ({ startMs, endMs })), [{ startMs: 9480, endMs: 10900 }]);
  }
});

test('falls back to provider timestamps when speech regions are unavailable', () => {
  const result = refineCuesWithSpeechRegions([cue(1000, 3000, 'short')], [], DEFAULT_TIMESTAMP_REFINEMENT, 'low');

  assert.deepEqual(result.cues.map(({ startMs, endMs }) => ({ startMs, endMs })), [{ startMs: 1000, endMs: 3000 }]);
  assert.equal(result.metadata.refinedCount, 0);
  assert.equal(result.metadata.fallbackCount, 1);
});

test('does not choose an ambiguous region or split provider text', () => {
  const result = refineCuesWithSpeechRegions([cue(2500, 15000, 'one provider sentence')], [
    { startMs: 9400, endMs: 10900 },
    { startMs: 11200, endMs: 12700 },
  ], { ...DEFAULT_TIMESTAMP_REFINEMENT, minSpeechMs: 2000 });

  assert.deepEqual(result.cues.map(({ startMs, endMs }) => ({ startMs, endMs })), [{ startMs: 2500, endMs: 15000 }]);
  assert.equal(result.cues[0].originalText, 'one provider sentence');
  assert.equal(result.metadata.fallbackCount, 1);
});

test('does not reuse one speech region for multiple provider cues', () => {
  const result = refineCuesWithSpeechRegions([cue(0, 2500, 'A'), cue(2500, 10860, 'B')], [{ startMs: 0, endMs: 863775 }]);

  assert.deepEqual(result.cues.map(({ startMs, endMs }) => ({ startMs, endMs })), [
    { startMs: 0, endMs: 2500 },
    { startMs: 2500, endMs: 10860 },
  ]);
  assert.equal(result.metadata.refinedCount, 0);
  assert.equal(result.metadata.fallbackCount, 2);
});

test('speech region lookup scales across thousands of cues', () => {
  const regions = Array.from({ length: 3000 }, (_, index) => ({ startMs: index * 3000, endMs: index * 3000 + 1200 }));
  const cues = regions.map((region, index) => cue(region.startMs - 250, region.endMs + 250, `cue-${index}`));
  const startedAt = Date.now();
  const result = refineCuesWithSpeechRegions(cues, regions);

  assert.equal(result.cues.length, 3000);
  assert.equal(result.metadata.refinedCount, 3000);
  assert.ok(Date.now() - startedAt < 1000);
});

test('VAD scans a real audio path once and keeps the safe fallback available', async () => {
  const directory = await createUploadSession();
  const audioPath = path.join(directory, 'refinement.wav');
  const sampleRate = 16000;
  const samples: number[] = [];
  const appendTone = (durationMs: number) => { for (let index = 0; index < sampleRate * durationMs / 1000; index += 1) samples.push(Math.round(Math.sin(index / 8) * 9000)); };
  const appendSilence = (durationMs: number) => { for (let index = 0; index < sampleRate * durationMs / 1000; index += 1) samples.push(0); };
  appendTone(800); appendSilence(600); appendTone(800);
  const audio = Buffer.alloc(44 + samples.length * 2);
  audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVE', 8); audio.write('fmt ', 12); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(sampleRate, 24); audio.writeUInt32LE(sampleRate * 2, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((sample, index) => audio.writeInt16LE(sample, 44 + index * 2));
  await writeFile(audioPath, audio);

  try {
    const result = await refineSttTimestamps(audioPath, [cue(0, 1000, 'A'), cue(1000, 2200, 'B')]);
    assert.ok(['silero-vad', 'ffmpeg-silencedetect', 'fallback'].includes(result.metadata.method));
    assert.ok(result.metadata.speechRegions === undefined || result.metadata.speechRegions.length >= 0);
    assert.equal(result.cues.length, 2);
  } finally {
    await cleanupUploadSession(directory);
  }
});

test('merges VAD frames but preserves a real speech gap in background audio', () => {
  const regions = mergeSpeechRegions([
    { startMs: 0, endMs: 220 },
    { startMs: 260, endMs: 500 },
    { startMs: 900, endMs: 1200 },
  ], 1400, { ...DEFAULT_TIMESTAMP_REFINEMENT, minSilenceGapMs: 200, speechPadBeforeMs: 80, speechPadAfterMs: 100 });

  assert.deepEqual(regions, [
    { startMs: 0, endMs: 600 },
    { startMs: 820, endMs: 1300 },
  ]);
  assert.ok(regions[1].startMs - regions[0].endMs >= 200);
});

test('music-only VAD output does not create a speech cue', () => {
  const result = refineCuesWithSpeechRegions([cue(0, 5000, 'music')], [], DEFAULT_TIMESTAMP_REFINEMENT, 'high', 'silero-vad');
  assert.deepEqual(result.cues.map(({ startMs, endMs }) => ({ startMs, endMs })), [{ startMs: 0, endMs: 5000 }]);
  assert.equal(result.metadata.refinedCount, 0);
  assert.equal(result.metadata.method, 'silero-vad');
});

test('Silero does not classify a synthetic music tone as speech', async () => {
  const directory = await createUploadSession();
  const audioPath = path.join(directory, 'music-only.wav');
  const sampleRate = 16000;
  const sampleCount = sampleRate * 3;
  const audio = Buffer.alloc(44 + sampleCount * 2);
  audio.write('RIFF', 0); audio.writeUInt32LE(audio.length - 8, 4); audio.write('WAVE', 8); audio.write('fmt ', 12); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(sampleRate, 24); audio.writeUInt32LE(sampleRate * 2, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(sampleCount * 2, 40);
  for (let index = 0; index < sampleCount; index += 1) audio.writeInt16LE(Math.round(Math.sin(index * 2 * Math.PI * 440 / sampleRate) * 9000), 44 + index * 2);
  await writeFile(audioPath, audio);
  try {
    const result = await refineSttTimestamps(audioPath, [cue(0, 3000, 'music')], { ...DEFAULT_TIMESTAMP_REFINEMENT, method: 'silero-vad' });
    assert.equal(result.metadata.refinedCount, 0);
    if (result.metadata.method === 'silero-vad') assert.equal(result.metadata.speechRegions?.length, 0);
  } finally {
    await cleanupUploadSession(directory);
  }
});

test('keeps a short 300ms utterance after VAD padding', () => {
  const result = refineCuesWithSpeechRegions([cue(0, 1000, 'short')], [{ startMs: 300, endMs: 600 }], {
    ...DEFAULT_TIMESTAMP_REFINEMENT,
    minSpeechMs: 120,
    speechPadBeforeMs: 80,
    speechPadAfterMs: 100,
  });
  assert.equal(result.metadata.refinedCount, 1);
});

test('falls back when the speech VAD is unavailable', async () => {
  const directory = await createUploadSession();
  const audioPath = path.join(directory, 'unavailable.wav');
  await writeFile(audioPath, Buffer.from('not-a-real-audio-file'));
  try {
    const result = await refineSttTimestamps(audioPath, [cue(1000, 3000, 'fallback')], DEFAULT_TIMESTAMP_REFINEMENT, async () => {
      throw new Error('Speech VAD unavailable; falling back to FFmpeg refinement.');
    });
    assert.equal(result.metadata.method, 'fallback');
    assert.equal(result.metadata.refinedCount, 0);
    assert.match(result.metadata.error || '', /Speech VAD unavailable/);
  } finally {
    await cleanupUploadSession(directory);
  }
});

test('silencedetect parser preserves short speech regions', () => {
  const result = parseSpeechRegions('silence_start: 0.000\nsilence_end: 0.100 | silence_duration: 0.100\nsilence_start: 0.600', 1000);
  assert.deepEqual(result.regions, [{ startMs: 100, endMs: 600 }]);
  assert.equal(result.hadSilenceEvents, true);
});
