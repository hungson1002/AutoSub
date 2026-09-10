import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { run, workdir } from './ffmpeg';
import { enqueueAnimationRender, getAnimationRenderJob, initializeAnimationRenderJobs, transcodeAnimationRecording, validateAnimationOutput } from './animationRender';

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

test('persists and completes a queued render job', async () => {
  const source = path.join(workdir, 'animation-render-test-source.webm'); const recording = await readFile(source);
  await initializeAnimationRenderJobs(); const queued = await enqueueAnimationRender(randomUUID(), recording, 'b'.repeat(64));
  let status = getAnimationRenderJob(queued.id); for (let index = 0; index < 100 && status.status !== 'completed' && status.status !== 'failed'; index += 1) { await new Promise((resolve) => setTimeout(resolve, 25)); status = getAnimationRenderJob(queued.id); }
  assert.equal(status.status, 'completed'); assert.ok(status.result?.size);
  const saved = JSON.parse(await readFile(path.join(workdir, 'animation-render-jobs', queued.id, 'job.json'), 'utf8')) as { status: string }; assert.equal(saved.status, 'completed');
});
