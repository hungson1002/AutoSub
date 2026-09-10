import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from './ffmpeg';
import { mergeManualClips } from './manualFilmMerge';

test('merge real clips: mixed sizes and missing audio produce a playable ordered MP4', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'manual-merge-test-'));
  try {
    const a = path.join(dir, 'a.mp4'); const b = path.join(dir, 'b.mp4'); const output = path.join(dir, 'out.mp4');
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x180:r=24:d=0.5', '-c:v', 'libx264', a]);
    await run('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=180x320:r=30:d=0.5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', b]);
    await mergeManualClips([a, b], output, '16:9');
    const probe = JSON.parse((await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', output])).stdout);
    assert.equal(probe.streams.find((s: { codec_type: string }) => s.codec_type === 'video').width, 1920);
    assert.ok(probe.streams.some((s: { codec_type: string }) => s.codec_type === 'audio'));
    assert.ok(Number(probe.format.duration) >= 1 && Number(probe.format.duration) < 1.3);
    await run('ffmpeg', ['-v', 'error', '-i', output, '-f', 'null', '-']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
