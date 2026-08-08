import { strict as assert } from 'node:assert';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import type { AIProvider } from '../types';
import { ProviderError } from '../adapters';
import { workdir } from './ffmpeg';
import { createDubbingJob, getDubbingJobStatus, isRewriteUnavailableError, isTransientDubbingError, isUsefulDubbingRewrite, recoverDubbingJob, retryDubbingOperation, startDubbingJob } from './dubbingJobs';

const jobsPath = path.join(workdir, 'jobs');
const fakeProvider: AIProvider = { id: 'synthetic-provider', name: 'Synthetic Provider', baseUrl: 'http://127.0.0.1:1/v1', enabled: true, models: [], providerType: 'openai-compatible', authType: 'none', capabilities: { chat: true, tts: true } };

function cues(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `synthetic-${index + 1}`, index: index + 1, startMs: index * 2500, endMs: index * 2500 + 1800, originalText: `Original cue ${index + 1}`, translatedText: `Translated cue ${index + 1}`, text: `Translated cue ${index + 1}`, previousText: index ? `Translated cue ${index}` : '', nextText: `Translated cue ${index + 2}`, provider: fakeProvider, model: 'synthetic-model', voice: 'synthetic-voice', speed: 1, volume: 1 }));
}

async function cleanup(id: string) { await rm(path.join(jobsPath, id), { recursive: true, force: true }); }

async function waitForTerminal(id: string) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const status = await getDubbingJobStatus(id);
    if (['completed', 'completed_with_errors', 'failed', 'cancelled'].includes(status.status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Job ${id} did not reach a terminal state in time.`);
}

test('persists synthetic jobs with 100, 1000 and 3000 cues', { timeout: 120_000 }, async () => {
  const ids: string[] = [];
  try {
    for (const count of [100, 1000, 3000]) {
      const job = await createDubbingJob({ cues: cues(count), batchSize: 30 });
      ids.push(job.id);
      const status = await getDubbingJobStatus(job.id);
      assert.equal(status.totalCues, count);
      assert.equal(status.doneCues, 0);
      assert.equal(status.progressPercent, 0);
      assert.equal(status.config.batchSize, 30);
      assert.equal(status.providerInfo.length, 1);
    }
  } finally { await Promise.all(ids.map(cleanup)); }
});

test('crash recovery resets processing cues but keeps done and failed checkpoints', async () => {
  const job = await createDubbingJob({ cues: cues(3) });
  try {
    const first = path.join(jobsPath, job.id, 'cues', 'synthetic-1.json');
    const second = path.join(jobsPath, job.id, 'cues', 'synthetic-2.json');
    const jobFile = path.join(jobsPath, job.id, 'job.json');
    const firstCue = JSON.parse(await readFile(first, 'utf8')) as { status: string };
    const secondCue = JSON.parse(await readFile(second, 'utf8')) as { status: string };
    firstCue.status = 'tts';
    secondCue.status = 'done';
    await writeFile(first, JSON.stringify(firstCue));
    await writeFile(second, JSON.stringify(secondCue));
    const storedJob = JSON.parse(await readFile(jobFile, 'utf8')) as { status: string };
    storedJob.status = 'running';
    await writeFile(jobFile, JSON.stringify(storedJob));
    const recovered = await recoverDubbingJob(job.id);
    assert.equal(recovered.status, 'queued');
    assert.equal(recovered.doneCues, 1);
    const recoveredCue = JSON.parse(await readFile(first, 'utf8')) as { status: string };
    assert.equal(recoveredCue.status, 'pending');
  } finally { await cleanup(job.id); }
});

test('retry classifier retries 429, 5xx and network failures but not auth/client failures', () => {
  assert.equal(isTransientDubbingError(new ProviderError('rate limited', 429)), true);
  assert.equal(isTransientDubbingError(new ProviderError('server', 500)), true);
  assert.equal(isTransientDubbingError(new TypeError('fetch failed')), true);
  assert.equal(isTransientDubbingError(new ProviderError('bad request', 400)), false);
  assert.equal(isTransientDubbingError(new ProviderError('unauthorized', 401)), false);
  assert.equal(isTransientDubbingError(new ProviderError('forbidden', 403)), false);
});

test('unsupported Chat capability is a rewrite fallback, not a failed TTS cue', () => {
  assert.equal(isRewriteUnavailableError(new ProviderError('ElevenLabs does not provide Chat capability.', 400)), true);
  assert.equal(isRewriteUnavailableError(new ProviderError('ElevenLabs không cung cấp capability Chat.', 400)), true);
  assert.equal(isRewriteUnavailableError(new ProviderError('Unauthorized', 401)), false);
  assert.equal(isRewriteUnavailableError(new ProviderError('Provider unavailable', 500)), false);
});

test('an unchanged or longer AI rewrite falls back instead of failing forever', () => {
  assert.equal(isUsefulDubbingRewrite('Một câu khá dài', 'Một câu khá dài'), false);
  assert.equal(isUsefulDubbingRewrite('Một câu khá dài', 'Một câu còn dài hơn nữa'), false);
  assert.equal(isUsefulDubbingRewrite('Một câu khá dài', 'Câu ngắn'), true);
});

test('retry operation recovers from simulated 429 and 500, but stops on 400', { timeout: 10_000 }, async () => {
  const controller = new AbortController();
  let transientAttempts = 0;
  const recovered = await retryDubbingOperation(async () => {
    transientAttempts += 1;
    if (transientAttempts === 1) throw new ProviderError('rate limited', 429);
    if (transientAttempts === 2) throw new ProviderError('provider unavailable', 500);
    return 'ok';
  }, 3, controller.signal);
  assert.equal(recovered, 'ok');
  assert.equal(transientAttempts, 3);

  let clientAttempts = 0;
  await assert.rejects(() => retryDubbingOperation(async () => {
    clientAttempts += 1;
    throw new ProviderError('bad request', 400);
  }, 3, controller.signal));
  assert.equal(clientAttempts, 1);
});

test('one provider failure becomes one failed cue and does not loop forever', { timeout: 30_000 }, async () => {
  const job = await createDubbingJob({ cues: cues(1), maxRetries: 1 });
  try {
    await startDubbingJob(job.id);
    const status = await waitForTerminal(job.id);
    assert.equal(status.status, 'completed_with_errors');
    assert.equal(status.doneCues, 0);
    assert.equal(status.failedCues, 1);
    assert.deepEqual(status.failedCueIds, ['synthetic-1']);
  } finally { await cleanup(job.id); }
});
