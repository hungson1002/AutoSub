import { strict as assert } from 'node:assert';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { createDubbingJob, startDubbingJob, getDubbingJobStatus, rebuildDubbingJobResult, planContinuousSpeechGroups } from './dubbingJobs';
import { fixtureWav } from './dubbingPcm.test';
import { workdir } from './ffmpeg';

const provider = { id: 'one-pass-fixture', name: 'Fixture VieNeu', baseUrl: 'local://vieneu', enabled: true, models: [], providerType: 'vieneu-local' as const, authType: 'none' as const, capabilities: { tts: true } };
const texts = ['Lan ơi, trời tối rồi.', 'Mình về nhà thôi nhé.'];
const cues = texts.map((text, index) => ({ id: `cue-${index}`, index, startMs: index * 3000, endMs: (index + 1) * 3000, text, originalText: text, translatedText: text, model: 'fixture-model', voice: 'fixture-voice', provider, speed: 1, volume: 1 }));
const version = /const TTS_CACHE_VERSION = '([^']+)'/.exec(await readFile(new URL('./dubbingJobs.ts', import.meta.url), 'utf8'))![1];
const hash = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
async function seed(id: string, groupDurationMs: number) {
  const dir = path.join(workdir, 'jobs', id, 'cache');
  const continuous = path.join(dir, 'continuous-speech');
  await mkdir(continuous, { recursive: true });
  const group = planContinuousSpeechGroups(cues.map((cue) => ({ ...cue, cueId: cue.id, providerRef: provider.id })))[0]!;
  const key = hash([1, version, provider.id, provider.baseUrl, group.model, group.voice, group.speed, group.text]);
  await writeFile(path.join(continuous, `${key}.raw.wav`), fixtureWav(groupDurationMs));
}
async function terminal(id: string) {
  for (let i = 0; i < 240; i++) {
    const status = await getDubbingJobStatus(id);
    if (['completed', 'failed', 'completed_with_errors', 'cancelled'].includes(status.status)) return status;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out');
}
test('group-first export needs no individual TTS and rebuild preserves full audio', async () => {
  const job = await createDubbingJob({ cues, speechMode: 'continuous-first', maxRetries: 0 });
  const dir = path.join(workdir, 'jobs', job.id);
  try {
    await seed(job.id, 2000);
    await startDubbingJob(job.id);
    const done = await terminal(job.id);
    assert.equal(done.status, 'completed', JSON.stringify(done.warnings));
    assert.equal(done.doneCues, 2);
    const before = await readFile(path.join(dir, done.result!.audioFile));
    assert.equal((await readdir(path.join(dir, 'cache/tts'))).length, 0);
    // A crash after persisting only one cue must reuse the existing group.
    const files = (await readdir(path.join(dir, 'cues'))).filter((f) => f.endsWith('.json'));
    const interruptedCuePath = path.join(dir, 'cues', files[1]!);
    const interruptedCue = JSON.parse(await readFile(interruptedCuePath, 'utf8'));
    interruptedCue.status = 'pending';
    delete interruptedCue.audioFile; delete interruptedCue.metadata;
    await writeFile(interruptedCuePath, JSON.stringify(interruptedCue));
    const jobPath = path.join(dir, 'job.json');
    const interruptedJob = JSON.parse(await readFile(jobPath, 'utf8'));
    interruptedJob.status = 'queued'; interruptedJob.doneCues = 1;
    await writeFile(jobPath, JSON.stringify(interruptedJob));
    await startDubbingJob(job.id);
    const resumed = await terminal(job.id);
    assert.equal(resumed.status, 'completed', JSON.stringify(resumed.warnings));
    assert.equal(resumed.doneCues, 2);
    assert.equal((await readdir(path.join(dir, 'cache/tts'))).length, 0);
    assert.deepEqual(await readFile(path.join(dir, resumed.result!.audioFile)), before);
    const stored = await Promise.all((await readdir(path.join(dir, 'cues'))).filter((f) => f.endsWith('.json')).map(async (f) => JSON.parse(await readFile(path.join(dir, 'cues', f), 'utf8'))));
    assert.ok(stored.every((cue) => cue.continuousGroupFile));
    await rebuildDubbingJobResult(job.id);
    const rebuilt = await terminal(job.id);
    assert.equal(rebuilt.status, 'completed');
    assert.deepEqual(await readFile(path.join(dir, rebuilt.result!.audioFile)), before);
    assert.equal((await readdir(path.join(dir, 'cache/tts'))).length, 0);
    const legacy = await createDubbingJob({ cues, speechMode: 'cue-first', maxRetries: 0 });
    const legacyDir = path.join(workdir, 'jobs', legacy.id);
    try {
      await seed(legacy.id, 2000);
      for (const cue of cues) {
        const key = hash([version, provider.id, provider.baseUrl, cue.model, cue.voice, cue.text, cue.speed, 'wav']);
        await writeFile(path.join(legacyDir, 'cache/tts', `${key}.wav`), fixtureWav(1500));
      }
      await startDubbingJob(legacy.id);
      const old = await terminal(legacy.id);
      assert.equal(old.status, 'completed');
      assert.deepEqual(await readFile(path.join(legacyDir, old.result!.audioFile)), before);
    } finally { await rm(legacyDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
test('overflow falls back to per-cue cache without retrying the group at export', async () => {
  const job = await createDubbingJob({ cues, speechMode: 'continuous-first', maxRetries: 0 });
  const dir = path.join(workdir, 'jobs', job.id);
  try {
    await seed(job.id, 10000);
    for (const cue of cues) {
      const key = hash([version, provider.id, provider.baseUrl, cue.model, cue.voice, cue.text, cue.speed, 'wav']);
      await writeFile(path.join(dir, 'cache/tts', `${key}.wav`), fixtureWav(1500));
    }
    await startDubbingJob(job.id);
    const done = await terminal(job.id);
    assert.equal(done.status, 'completed', JSON.stringify(done.warnings));
    const cache = await readdir(path.join(dir, 'cache/continuous-speech'));
    assert.equal(cache.filter((file) => file.endsWith('.raw.wav')).length, 1);
    assert.equal(cache.filter((file) => file.endsWith('.group.json')).length, 0);
  } finally { await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
});
