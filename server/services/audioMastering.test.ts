import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildLinearLoudnessFilter, masterDubFile } from './audioMastering';
import { run } from './ffmpeg';

test('uses measured two-pass loudness values so mastering stays linear', () => {
  const filter = buildLinearLoudnessFilter({
    input_i: '-21.40',
    input_tp: '-8.70',
    input_lra: '2.10',
    input_thresh: '-31.80',
    target_offset: '0.10',
  });
  assert.match(filter, /measured_I=-21\.40/);
  assert.match(filter, /measured_TP=-8\.70/);
  assert.match(filter, /measured_LRA=2\.10/);
  assert.match(filter, /measured_thresh=-31\.80/);
  assert.match(filter, /offset=0\.10/);
  assert.match(filter, /linear=true/);
});

test('masters dialogue to -16 LUFS with safe true-peak headroom', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'autosub-mastering-'));
  const input = path.join(directory, 'quiet.wav');
  const output = path.join(directory, 'mastered.wav');
  try {
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=4', '-af', 'volume=0.05', '-ar', '48000', input]);
    await masterDubFile(input, output);
    const measured = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', output, '-af', 'loudnorm=I=-16:LRA=11:TP=-2.0:print_format=json', '-f', 'null', '-']);
    const loudness = Number(measured.stderr.match(/"input_i"\s*:\s*"([^"]+)"/)?.[1]);
    const truePeak = Number(measured.stderr.match(/"input_tp"\s*:\s*"([^"]+)"/)?.[1]);
    assert.ok(loudness >= -16.6 && loudness <= -15.4, `unexpected loudness ${loudness} LUFS`);
    assert.ok(truePeak <= -1.8, `unexpected true peak ${truePeak} dBTP`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
