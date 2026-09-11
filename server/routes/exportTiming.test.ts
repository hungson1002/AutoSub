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

test('long-form slow video maps timestamps continuously without segment boundary drift', () => {
  const filter = buildSlowVideoFilter('source', [
    { originalDurationMs: 1_000, ttsDurationMs: 1_500, timelineStartMs: 1_000, timelineShiftMs: 0 },
    { originalDurationMs: 1_000, ttsDurationMs: 800, timelineStartMs: 3_500, timelineShiftMs: 500 },
    { originalDurationMs: 2_000, ttsDurationMs: 2_500, timelineStartMs: 5_500, timelineShiftMs: 500 },
  ]);
  assert.match(filter, /clip\(\(PTS-STARTPTS\)\*TB-1\.000000,0,1\.000000\)\*0\.500000000/);
  assert.match(filter, /clip\(\(PTS-STARTPTS\)\*TB-5\.000000,0,2\.000000\)\*0\.250000000/);
  assert.match(filter, /\[slowDubVideo\]$/);
  assert.doesNotMatch(filter, /segment=|concat=/);
  assert.doesNotMatch(filter, /between\(|if\(/);
});

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from '../services/ffmpeg';
import { retimedDurationMs } from '../services/exportAudio';

test('FFmpeg preserves duration across 3000 sub-frame cue boundaries', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'autosub-retime-test-'));
  try {
    const metadata = Array.from({ length: 3000 }, (_, i) => ({
      originalDurationMs: 3, ttsDurationMs: 4.5, timelineStartMs: i * 3, timelineShiftMs: 0,
    }));
    // A reused dub can extend beyond a shorter source video. Only the
    // overlapping portion may contribute to the expected export duration.
    metadata.push(
      { originalDurationMs: 2000, ttsDurationMs: 3000, timelineStartMs: 9500, timelineShiftMs: 0 },
      { originalDurationMs: 1000, ttsDurationMs: 2000, timelineStartMs: 15000, timelineShiftMs: 0 },
    );
    const graph = path.join(dir, 'graph.txt');
    const output = path.join(dir, 'result.mp4');
    await writeFile(graph, buildSlowVideoFilter('0:v', metadata));
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:r=25:d=10',
      '-/filter_complex', graph, '-map', '[slowDubVideo]', '-c:v', 'libx264', '-preset', 'ultrafast', output]);
    const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output]);
    const actual = Number(probe.stdout.trim());
    const expected = retimedDurationMs(10000, metadata) / 1000;
    assert.ok(Math.abs(actual - expected) < 0.12, `${actual}s instead of ${expected}s`);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
