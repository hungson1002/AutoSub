import assert from 'node:assert/strict';
import test from 'node:test';
import type { SubtitleCue } from '../types';
import { buildActiveCueIndex, findActiveCue } from './activeCue';

const cue = (id: string, index: number, startMs: number, endMs: number, enabled = true): SubtitleCue => ({
  id,
  index,
  startMs,
  endMs,
  originalText: id,
  translatedText: id,
  voiceGroup: 'G1',
  enabled,
});

test('active cue index finds cues and preserves gaps', () => {
  const index = buildActiveCueIndex([
    cue('second', 2, 2_000, 3_000),
    cue('first', 1, 0, 1_000),
  ]);

  assert.equal(findActiveCue(index, 500)?.id, 'first');
  assert.equal(findActiveCue(index, 1_500), undefined);
  assert.equal(findActiveCue(index, 2_500)?.id, 'second');
  assert.equal(findActiveCue(index, 3_000), undefined);
});

test('active cue index ignores disabled and invalid cues', () => {
  const index = buildActiveCueIndex([
    cue('disabled', 1, 0, 2_000, false),
    cue('invalid', 2, 1_000, 1_000),
  ]);

  assert.equal(findActiveCue(index, 1_000), undefined);
});

test('active cue index returns the latest overlapping cue', () => {
  const index = buildActiveCueIndex([
    cue('long', 1, 0, 10_000),
    cue('ended', 2, 4_000, 5_000),
    cue('latest', 3, 6_000, 8_000),
  ]);

  assert.equal(findActiveCue(index, 6_500)?.id, 'latest');
  assert.equal(findActiveCue(index, 8_500)?.id, 'long');
});
