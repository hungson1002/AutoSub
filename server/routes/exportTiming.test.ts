import { strict as assert } from 'node:assert';
import test from 'node:test';
import { buildSlowVideoFilter, buildSlowVideoSetpts } from './export';

test('slow-video setpts stretches only long cue windows and preserves accumulated offsets', () => {
  const filter = buildSlowVideoSetpts([
    { originalDurationMs: 1_000, ttsDurationMs: 1_500, timelineStartMs: 1_000, timelineShiftMs: 0 },
    { originalDurationMs: 1_000, ttsDurationMs: 800, timelineStartMs: 3_500, timelineShiftMs: 500 },
    { originalDurationMs: 2_000, ttsDurationMs: 2_500, timelineStartMs: 5_500, timelineShiftMs: 500 },
  ]);
  assert.match(filter, /^setpts='PTS-STARTPTS\+/);
  assert.match(filter, /between\(PTS\*TB,1\.000000,2\.000000\)/);
  assert.match(filter, /between\(PTS\*TB,5\.000000,7\.000000\)/);
  assert.doesNotMatch(filter, /3\.000000,4\.000000/);
});

test('slow-video setpts is neutral when every cue already fits', () => {
  assert.equal(buildSlowVideoSetpts([
    { originalDurationMs: 1_000, ttsDurationMs: 900, timelineStartMs: 0, timelineShiftMs: 0 },
  ]), 'setpts=PTS-STARTPTS');
});

test('long-form slow video segments the source once instead of nesting one expression per cue', () => {
  const filter = buildSlowVideoFilter('source', [
    { originalDurationMs: 1_000, ttsDurationMs: 1_500, timelineStartMs: 1_000, timelineShiftMs: 0 },
    { originalDurationMs: 1_000, ttsDurationMs: 800, timelineStartMs: 3_500, timelineShiftMs: 500 },
    { originalDurationMs: 2_000, ttsDurationMs: 2_500, timelineStartMs: 5_500, timelineShiftMs: 500 },
  ]);
  assert.match(filter, /^\[source\]segment=timestamps=1\.000000\|2\.000000\|5\.000000\|7\.000000/);
  assert.match(filter, /setpts=\(PTS-STARTPTS\)\*1\.500000000/);
  assert.match(filter, /setpts=\(PTS-STARTPTS\)\*1\.250000000/);
  assert.match(filter, /concat=n=5:v=1:a=0\[slowDubVideo\]$/);
  assert.doesNotMatch(filter, /between\(|if\(/);
});
