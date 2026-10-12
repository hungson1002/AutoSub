import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {readFile, access} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

process.env.AUTOSUB_WORKDIR=mkdtempSync(path.join(os.tmpdir(),'AutoSub-render-cancel-'));
process.env.AUTOSUB_RENDER_MIN_FREE_MB='999999999';
const {enqueueAnimationRender,cancelAnimationRenderJob,getAnimationRenderJob,initializeAnimationRenderJobs}=await import('./animationRender');
const {workdir}=await import('./ffmpeg');

test('a job waiting for RAM is visible, cancellable, persisted and never resumed',async()=>{
  const job=await enqueueAnimationRender(randomUUID(),Buffer.from('retained-source'));
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal(getAnimationRenderJob(job.id).status,'queued');
  assert.match(getAnimationRenderJob(job.id).stage!,/RAM/);
  await cancelAnimationRenderJob(job.id);
  await new Promise(resolve=>setTimeout(resolve,2200));
  assert.equal(getAnimationRenderJob(job.id).status,'cancelled');
  const saved=JSON.parse(await readFile(path.join(workdir,'animation-render-jobs',job.id,'job.json'),'utf8'));
  assert.equal(saved.status,'cancelled');
  await access(path.join(workdir,'animation-render-jobs',job.id,'recording.webm'));
  await initializeAnimationRenderJobs();
  assert.equal(getAnimationRenderJob(job.id).status,'cancelled');
  assert.equal((await cancelAnimationRenderJob(job.id)).status,'cancelled');
});
