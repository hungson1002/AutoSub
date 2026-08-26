import { strict as assert } from 'node:assert';
import test from 'node:test';
import { buildExportAudioFilter } from './exportAudio';

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
