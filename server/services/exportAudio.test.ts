import { strict as assert } from 'node:assert';
import test from 'node:test';
import { buildExportAudioFilter, buildRetimedSourceAudioFilter } from './exportAudio';

test('an already mixed dubbing job is the only audio source during export', () => {
  const filter = buildExportAudioFilter({
    hasDub: true,
    dubInputIndex: 2,
    keepAudio: true,
    originalVolume: 0.25,
    jobDubIncludesBackground: true,
  });

  assert.match(filter, /^\[2:a\]/);
  assert.doesNotMatch(filter, /\[0:a\]/);
  assert.doesNotMatch(filter, /amix=/);
  assert.match(filter, /alimiter=limit=0\.891:level=false/);
  assert.doesNotMatch(filter, /loudnorm=/);
  assert.match(filter, /aresample=48000/);
  assert.match(filter, /apad\[audioout\]$/);
});

test('retimed original audio slows only long cue segments and concatenates the full source', () => {
  const filter = buildRetimedSourceAudioFilter([
    { originalDurationMs: 1_000, ttsDurationMs: 1_500, timelineStartMs: 1_000, timelineShiftMs: 0 },
    { originalDurationMs: 1_000, ttsDurationMs: 800, timelineStartMs: 3_500, timelineShiftMs: 500 },
  ]);
  assert.match(filter, /asegment=timestamps=1\.000000\|2\.000000/);
  assert.doesNotMatch(filter, /asplit|atrim/);
  assert.match(filter, /atempo=0\.666667/);
  assert.match(filter, /concat=n=3:v=0:a=1\[retimedOriginal\]$/);
});

test('retimed original audio is unchanged when all speech fits', () => {
  assert.equal(buildRetimedSourceAudioFilter([
    { originalDurationMs: 1_000, ttsDurationMs: 900, timelineStartMs: 0, timelineShiftMs: 0 },
  ]), '[0:a]anull[retimedOriginal]');
});

test('a voice-only dub can still be mixed with original audio once', () => {
  const filter = buildExportAudioFilter({
    hasDub: true,
    dubInputIndex: 1,
    keepAudio: true,
    originalVolume: 0.25,
  });

  assert.match(filter, /\[0:a\]volume=0\.250\[original\]/);
  assert.match(filter, /amix=inputs=2:duration=longest/);
  assert.match(filter, /alimiter=limit=0\.891:level=false/);
  assert.doesNotMatch(filter, /loudnorm=/);
});
