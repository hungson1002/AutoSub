import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { masterDubFile } from './audioMastering';
import { run } from './ffmpeg';

test('masters a quiet dub to the -14 LUFS dialogue target', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'autosub-mastering-'));
  const input = path.join(directory, 'quiet.wav');
  const output = path.join(directory, 'mastered.wav');
  try {
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=4', '-af', 'volume=0.05', '-ar', '48000', input]);
    await masterDubFile(input, output);
    const measured = await run('ffmpeg', ['-hide_banner', '-nostats', '-i', output, '-af', 'loudnorm=I=-14:LRA=7:TP=-1.0:print_format=json', '-f', 'null', '-']);
    const loudness = Number(measured.stderr.match(/"input_i"\s*:\s*"([^"]+)"/)?.[1]);
    const truePeak = Number(measured.stderr.match(/"input_tp"\s*:\s*"([^"]+)"/)?.[1]);
    assert.ok(loudness >= -14.6 && loudness <= -13.4, `unexpected loudness ${loudness} LUFS`);
    assert.ok(truePeak <= -0.8, `unexpected true peak ${truePeak} dBTP`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
