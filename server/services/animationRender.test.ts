import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { run, workdir } from './ffmpeg';
import { enqueueAnimationRender, getAnimationRenderJob, initializeAnimationRenderJobs, transcodeAnimationRecording } from './animationRender';

test('transcodes WebM and reuses cache by project fingerprint', async () => {
  const source = path.join(workdir, 'animation-render-test-source.webm');
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x284:d=0.25', '-c:v', 'libvpx-vp9', source]);
  const recording = await readFile(source); const key = 'a'.repeat(64); const projectId = randomUUID();
  const first = await transcodeAnimationRecording(projectId, recording, key); const second = await transcodeAnimationRecording(projectId, recording, key);
  assert.ok(first.size > 0); assert.equal(second.path, first.path); assert.equal(second.cached, true);
});

test('persists and completes a queued render job', async () => {
  const source = path.join(workdir, 'animation-render-test-source.webm'); const recording = await readFile(source);
  await initializeAnimationRenderJobs(); const queued = await enqueueAnimationRender(randomUUID(), recording, 'b'.repeat(64));
  let status = getAnimationRenderJob(queued.id); for (let index = 0; index < 100 && status.status !== 'completed' && status.status !== 'failed'; index += 1) { await new Promise((resolve) => setTimeout(resolve, 25)); status = getAnimationRenderJob(queued.id); }
  assert.equal(status.status, 'completed'); assert.ok(status.result?.size);
  const saved = JSON.parse(await readFile(path.join(workdir, 'animation-render-jobs', queued.id, 'job.json'), 'utf8')) as { status: string }; assert.equal(saved.status, 'completed');
});
