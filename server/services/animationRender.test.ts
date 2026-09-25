import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { run, workdir } from './ffmpeg';
import { enqueueAnimationRender, getAnimationRenderJob, initializeAnimationRenderJobs, transcodeAnimationRecording, validateAnimationOutput, wavTrailingSilenceMs } from './animationRender';

test('detects a quiet scene ending without mistaking an internal pause for the ending', () => {
  const sampleRate = 48_000;
  const frames = sampleRate;
  const wav = Buffer.alloc(44 + frames * 2);
  wav.write('RIFF', 0, 'ascii'); wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8, 'ascii'); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii'); wav.writeUInt32LE(frames * 2, 40);
  for (let frame = 0; frame < frames; frame += 1) {
    const second = frame / sampleRate;
    const active = second < .3 || (second >= .48 && second < .82);
    wav.writeInt16LE(active ? Math.round(9000 * Math.sin(2 * Math.PI * 440 * second)) : 0, 44 + frame * 2);
  }
  assert.ok(wavTrailingSilenceMs(wav) >= 170 && wavTrailingSilenceMs(wav) <= 190);
});

test('transcodes WebM and reuses cache by project fingerprint', async () => {
  const source = path.join(workdir, 'animation-render-test-source.webm');
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x284:d=0.25', '-c:v', 'libvpx-vp9', source]);
  const recording = await readFile(source); const key = 'a'.repeat(64); const projectId = randomUUID();
  const first = await transcodeAnimationRecording(projectId, recording, key); const second = await transcodeAnimationRecording(projectId, recording, key);
  assert.ok(first.size > 0); assert.equal(second.path, first.path); assert.equal(second.cached, true);
  await assert.rejects(validateAnimationOutput(first.path, { width: 1920, height: 1080, fps: 30, durationInFrames: 900 }));
  await writeFile(first.path, 'invalid cached output');
  const repaired = await transcodeAnimationRecording(projectId, recording, key);
  assert.equal(repaired.cached, false);
  assert.equal((await validateAnimationOutput(repaired.path)).width, 160);
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=160x284:d=0.25', '-c:v', 'libvpx-vp9', source]);
  const changed = await transcodeAnimationRecording(projectId, await readFile(source), key);
  assert.notEqual(changed.path, first.path, 'client key cannot reuse a different recording');
});

test('retimes browser recording to the project timeline', async () => {
  const source = path.join(workdir, `animation-render-retime-${randomUUID()}.webm`);
  let outputPath = '';
  try {
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x284:d=0.5', '-c:v', 'libvpx-vp9', source]);
    const result = await transcodeAnimationRecording(randomUUID(), await readFile(source), 'c'.repeat(64), { fps: 30, durationMs: 250 });
    outputPath = result.path;
    const output = await validateAnimationOutput(outputPath);
    assert.ok(Math.abs(output.durationSeconds - 0.25) <= 1 / 30);
  } finally {
    await rm(source, { force: true });
    if (outputPath) await rm(outputPath, { force: true });
  }
});

test('persists and completes a queued render job', async () => {
  const source = path.join(workdir, 'animation-render-test-source.webm'); const recording = await readFile(source);
  await initializeAnimationRenderJobs(); const queued = await enqueueAnimationRender(randomUUID(), recording, 'b'.repeat(64));
  let status = getAnimationRenderJob(queued.id); for (let index = 0; index < 100 && status.status !== 'completed' && status.status !== 'failed'; index += 1) { await new Promise((resolve) => setTimeout(resolve, 25)); status = getAnimationRenderJob(queued.id); }
  assert.equal(status.status, 'completed'); assert.ok(status.result?.size);
  const saved = JSON.parse(await readFile(path.join(workdir, 'animation-render-jobs', queued.id, 'job.json'), 'utf8')) as { status: string }; assert.equal(saved.status, 'completed');
});
