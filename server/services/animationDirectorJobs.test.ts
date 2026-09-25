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
test('job exposes completed-image progress instead of treating a retry task number as percent done', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-jobs-'));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const store = new AnimationDirectorJobStore(root, async (value, stage) => {
    await stage('Đang tạo 100 ảnh · Turbo 4/6 luồng');
    await stage('Ảnh 25/100 · Turbo đang dùng 4/6 luồng');
    await stage('Đang xử lý ảnh 60/100 · cảnh 20, nhịp 3 · thử lại lần 9');
    await gate;
    return value.project;
  });
  await store.initialize();
  const job = await store.start(input());
  for (let i = 0; i < 100 && (store.get(job.id).progressCurrent || 0) < 25; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  const running = store.get(job.id);
  assert.equal(running.progressCurrent, 25);
  assert.equal(running.progressTotal, 100);
  assert.equal(running.progressLabel, '25/100 ảnh đã xong');
  assert.ok((running.progressPercent || 0) > 20 && (running.progressPercent || 0) < 60);
  release();
  assert.equal((await terminal(store, job.id)).progressPercent, 100);
});

test('job reports scene-level narration progress after TTS is grouped by scene', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-jobs-'));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const store = new AnimationDirectorJobStore(root, async (value, stage) => {
    await stage('Lời đọc Turbo: 2 cảnh · tối đa 2 cảnh song song');
    await stage('Đã tạo 1/2 cảnh lời đọc');
    await stage('Đang chỉnh lời đọc theo timeline cố định (1/3)');
    await gate;
    return value.project;
  });
  await store.initialize();
  const job = await store.start(input());
  for (let i = 0; i < 200 && store.get(job.id).progressLabel !== 'Đang căn thời lượng lời đọc (1/3)'; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(store.get(job.id).progressLabel, 'Đang căn thời lượng lời đọc (1/3)');
  assert.ok((store.get(job.id).progressPercent || 0) <= 20);
  release();
  assert.equal((await terminal(store, job.id)).status, 'completed');
});

test('restart marks interrupted instead of automatically resubmitting generation', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-jobs-'));
  const store = new AnimationDirectorJobStore(root, async (value) => value.project);
  await store.initialize();
  const value = input(); const job = await store.start(value); await terminal(store, job.id);
  const file = path.join(root, job.id, 'job.json');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({ ...saved, status: 'running', progressPercent: 99, progressLabel: '28/28 cảnh lời đọc' }));
  let calls = 0;
  let releaseResume!: () => void;
  const resumeGate = new Promise<void>((resolve) => { releaseResume = resolve; });
  const restarted = new AnimationDirectorJobStore(root, async (value) => { calls++; await resumeGate; return value.project; });
  await restarted.initialize();
  assert.equal(restarted.get(job.id).status, 'interrupted'); assert.equal(calls, 0);
  const resumed = await restarted.start(value, job.id);
  assert.equal(resumed.progressPercent, 15);
  assert.equal(resumed.progressLabel, 'Đang tiếp tục từ checkpoint');
  releaseResume();
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
