import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AnimationDirectorJobStore } from './animationDirectorJobs';
import type { DirectAnimationInput } from './animationDirector';

function input(): DirectAnimationInput {
  return { brief: 'Một chủ đề animation thử nghiệm', targetDurationSeconds: 30, model: 'mock', provider: { providerType: 'openai-compatible', id: 'mock', name: 'Mock', baseUrl: 'https://example.invalid', apiKey: 'secret-test-key', enabled: true, models: [], capabilities: {}, authType: 'bearer' }, project: { id: randomUUID(), schemaVersion: 1, name: 'Test', width: 1280, height: 720, fps: 30, createdAt: '', updatedAt: '', assets: [], scenes: [] } };
}
async function terminal(store: AnimationDirectorJobStore, id: string) {
  for (let i = 0; i < 200; i++) {
    const job = store.get(id);
    if (!['queued', 'running'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Job did not terminate');
}
test('durable job deduplicates, persists result and never stores provider secrets', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-jobs-'));
  let calls = 0;
  const store = new AnimationDirectorJobStore(root, async (value, stage) => { calls++; await stage('audio 1/2'); return value.project; });
  await store.initialize();
  const value = input();
  const [one, two] = await Promise.all([store.start(value), store.start(value)]);
  assert.equal(one.id, two.id);
  assert.equal((await terminal(store, one.id)).status, 'completed');
  assert.equal(calls, 1);
  const saved = await readFile(path.join(root, one.id, 'input.json'), 'utf8');
  assert.ok(!saved.includes('secret-test-key'));
  const reloaded = new AnimationDirectorJobStore(root);
  await reloaded.initialize();
  assert.equal((await reloaded.result(one.id)).id, value.project.id);
});
test('restart marks interrupted instead of automatically resubmitting generation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-jobs-'));
  const store = new AnimationDirectorJobStore(root, async (value) => value.project);
  await store.initialize();
  const value = input(); const job = await store.start(value); await terminal(store, job.id);
  const file = path.join(root, job.id, 'job.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({ ...saved, status: 'running' }));
  let calls = 0;
  const restarted = new AnimationDirectorJobStore(root, async (value) => { calls++; return value.project; });
  await restarted.initialize();
  assert.equal(restarted.get(job.id).status, 'interrupted'); assert.equal(calls, 0);
  await restarted.start(value, job.id);
  assert.equal((await terminal(restarted, job.id)).status, 'completed'); assert.equal(calls, 1);
});
test('cancel stops scheduling at next stage and retains already returned result', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-jobs-'));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const store = new AnimationDirectorJobStore(root, async (value) => { await gate; return value.project; });
  await store.initialize();
  const value = input(); const job = await store.start(value);
  await store.cancel(job.id); release();
  const done = await terminal(store, job.id);
  assert.equal(done.status, 'cancelled'); assert.equal(done.hasResult, true);
  assert.equal((await store.result(job.id)).id, value.project.id);
});

test('cancel prevents the next external stage from being scheduled', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-jobs-'));
  let release!: () => void; let scheduled = 0;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const store = new AnimationDirectorJobStore(root, async (value, stage) => { await gate; await stage('next external call'); scheduled++; return value.project; });
  await store.initialize(); const job = await store.start(input());
  await store.cancel(job.id); release();
  assert.equal((await terminal(store, job.id)).status, 'cancelled'); assert.equal(scheduled, 0);
});
