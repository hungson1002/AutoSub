import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AnimationDirectorJobStore } from './animationDirectorJobs';
import type { DirectAnimationInput } from './animationDirector';
import { FlowSessionError } from './googleFlow';

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

test('traffic cooldown keeps progress and resumes the same job automatically', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-traffic-recovery-'));
  let calls = 0;
  const store: AnimationDirectorJobStore = new AnimationDirectorJobStore(root, async (value, stage) => {
    calls += 1;
    if (calls === 1) {
      await stage('Ảnh 35/40');
      throw new FlowSessionError('TOO_MUCH_TRAFFIC', 'FLOW_IMAGE_TRAFFIC_THROTTLED', Date.now() + 100);
    }
    assert.equal(store.list()[0].progressCurrent, 35);
    assert.ok((store.list()[0].progressPercent || 0) >= 85);
    return value.project;
  });
  await store.initialize();
  const job = await store.start(input());
  for (let i = 0; i < 50 && !store.get(job.id).stage.includes('tự tiếp tục'); i++) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(store.get(job.id).status, 'running');
  assert.match(store.get(job.id).stage, /tự tiếp tục/);
  assert.equal((await terminal(store, job.id)).status, 'completed');
  assert.equal(calls, 2);
});

test('temporary Flow bridge disconnect auto-recovers from checkpoint without manual resume', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-flow-bridge-recovery-'));
  let calls = 0;
  const store: AnimationDirectorJobStore = new AnimationDirectorJobStore(root, async (value, stage) => {
    calls += 1;
    if (calls === 1) {
      await stage('Ảnh 12/40');
      throw new FlowSessionError('Worker Google Flow đã mất kết nối trình duyệt.', 'FLOW_EXTENSION_NOT_CONNECTED');
    }
    assert.ok((store.list()[0].progressPercent || 0) >= Math.round(20 + 74 * 12 / 40));
    return value.project;
  });
  await store.initialize();
  const job = await store.start(input());
  const result = await terminal(store, job.id);
  assert.equal(result.status, 'completed');
  assert.equal(calls, 2);
});

test('an unavailable Flow auth pool visibly retries the missing image from checkpoint', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-flow-auth-recovery-'));
  let calls = 0;
  const store: AnimationDirectorJobStore = new AnimationDirectorJobStore(root, async (value, stage) => {
    calls += 1;
    if (calls === 1) {
      await stage('Ảnh 24/25');
      throw new FlowSessionError('No authenticated Flow workers for this image.', 'FLOW_NO_AUTHENTICATED_WORKERS');
    }
    assert.equal(store.list()[0]?.progressCurrent, 24);
    assert.equal(store.list()[0]?.progressTotal, 25);
    return value.project;
  });
  await store.initialize();
  const job = await store.start(input());
  for (let i = 0; i < 150 && !store.get(job.id).stage.includes('đang dò lại pool'); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  const recovering = store.get(job.id);
  assert.equal(recovering.status, 'running');
  assert.match(recovering.stage, /đang dò lại pool Flow/);
  assert.match(recovering.progressLabel || '', /24\/25 ảnh/);
  assert.equal((await terminal(store, job.id)).status, 'completed');
  assert.equal(calls, 2);
});

test('Flow auth recovery keeps the same job active beyond five worker failures', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-flow-unbounded-recovery-'));
  let calls = 0;
  const store: AnimationDirectorJobStore = new AnimationDirectorJobStore(root, async (value, stage) => {
    calls += 1;
    await stage('Ảnh 24/25');
    if (calls <= 6) throw new FlowSessionError('No authenticated Flow workers for this image.', 'FLOW_NO_AUTHENTICATED_WORKERS');
    assert.equal(store.list()[0]?.progressCurrent, 24);
    assert.equal(store.list()[0]?.progressTotal, 25);
    return value.project;
  }, () => 1);
  await store.initialize();
  const job = await store.start(input());
  assert.equal((await terminal(store, job.id)).status, 'completed');
  assert.equal(calls, 7);
});

test('persistent traffic rejection stops after two automatic recovery attempts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-traffic-bounded-'));
  let calls = 0;
  const store = new AnimationDirectorJobStore(root, async () => {
    calls += 1;
    throw new FlowSessionError('TOO_MUCH_TRAFFIC', 'FLOW_IMAGE_TRAFFIC_THROTTLED', Date.now() + 5);
  });
  await store.initialize();
  const job = await store.start(input());
  const result = await terminal(store, job.id);
  assert.equal(result.status, 'failed');
  assert.equal(calls, 3);
  assert.match(result.error || '', /2 lần/);
});

test('cancelling during a traffic cooldown prevents the next provider attempt', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-traffic-cancel-'));
  let calls = 0;
  const store = new AnimationDirectorJobStore(root, async () => {
    calls += 1;
    throw new FlowSessionError('TOO_MUCH_TRAFFIC', 'FLOW_IMAGE_TRAFFIC_THROTTLED', Date.now() + 30_000);
  });
  await store.initialize();
  const job = await store.start(input());
  for (let i = 0; i < 100 && !store.get(job.id).stage.includes('tự tiếp tục'); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.match(store.get(job.id).stage, /tự tiếp tục/);
  await store.cancel(job.id);
  assert.equal((await terminal(store, job.id)).status, 'cancelled');
  assert.equal(calls, 1);
});

for (const code of ['FLOW_IMAGE_RECAPTCHA_BLOCKED', 'FLOW_ACCOUNT_SESSION_UNVERIFIED']) {
  test(`${code} never triggers automatic traffic recovery`, async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'animation-no-unsafe-recovery-'));
    let calls = 0;
    const store = new AnimationDirectorJobStore(root, async () => {
      calls += 1;
      throw new FlowSessionError(code, code, Date.now() + 5);
    });
    await store.initialize();
    const job = await store.start(input());
    assert.equal((await terminal(store, job.id)).status, 'failed');
    assert.equal(calls, 1);
  });
}


test('FLOW_GENERATION_OUTCOME_UNKNOWN auto-reconciles from checkpoint instead of requiring manual resume', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-uncertain-recovery-'));
  let calls = 0;
  const store = new AnimationDirectorJobStore(root, async (value, stage) => {
    calls += 1;
    if (calls === 1) {
      await stage('Ảnh 12/40');
      throw new FlowSessionError('late Flow result still pending', 'FLOW_GENERATION_OUTCOME_UNKNOWN');
    }
    assert.ok((store.list()[0].progressPercent || 0) >= Math.round(20 + 74 * 12 / 40));
    return value.project;
  });
  await store.initialize();
  const job = await store.start(input());
  const result = await terminal(store, job.id);
  assert.equal(result.status, 'completed');
  assert.equal(calls, 2);
});

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

test('job reports the active cast-reference repair attempt instead of stale voice progress', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-jobs-'));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const store: AnimationDirectorJobStore = new AnimationDirectorJobStore(root, async (value, stage) => {
    await stage('Làm sạch ảnh nhận diện CAST_01 · sửa 1/2');
    assert.equal(store.get([...store.list()][0]!.id).progressLabel, 'Đang sửa ảnh nhận diện CAST_01 · lượt 1/2');
    await stage('Làm sạch ảnh nhận diện CAST_01 · sửa 2/2');
    assert.equal(store.get([...store.list()][0]!.id).progressLabel, 'Đang sửa ảnh nhận diện CAST_01 · lượt 2/2');
    await gate;
    return value.project;
  });
  await store.initialize();
  const job = await store.start(input());
  for (let i = 0; i < 100 && store.get(job.id).progressLabel !== 'Đang sửa ảnh nhận diện CAST_01 · lượt 2/2'; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(store.get(job.id).progressLabel, 'Đang sửa ảnh nhận diện CAST_01 · lượt 2/2');
  assert.equal(store.get(job.id).progressPercent, 20);
  release();
  assert.equal((await terminal(store, job.id)).status, 'completed');
});

test('storyboard guard progress reports the current scene and JSON retry instead of a stale generic label', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-jobs-'));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const store: AnimationDirectorJobStore = new AnimationDirectorJobStore(root, async (value, stage) => {
    await stage('Storyboard guard phát hiện 39 lỗi · đang sửa riêng scene 4 · lượt 1/24');
    assert.equal(store.get([...store.list()][0]!.id).progressLabel, 'Đang sửa 39 lỗi storyboard · scene 4');
    await stage('JSON sửa storyboard scene 4 bị cắt · đang tự thử lại riêng scene');
    assert.equal(store.get([...store.list()][0]!.id).progressLabel, 'JSON scene 4 bị cắt · đang tự thử lại');
    await gate;
    return value.project;
  });
  await store.initialize();
  const job = await store.start(input());
  for (let i = 0; i < 100 && store.get(job.id).progressLabel !== 'JSON scene 4 bị cắt · đang tự thử lại'; i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(store.get(job.id).progressLabel, 'JSON scene 4 bị cắt · đang tự thử lại');
  release();
  assert.equal((await terminal(store, job.id)).status, 'completed');
});

test('creative style QC failure auto-recovers from checkpoint without user resume', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-jobs-'));
  let calls = 0;
  const store = new AnimationDirectorJobStore(root, async (value) => {
    calls += 1;
    if (calls === 1) throw new Error('STYLE_GRAMMAR_BLOCK CAST_01: thick anatomical limbs');
    return value.project;
  });
  await store.initialize();
  const job = await store.start(input());
  const done = await terminal(store, job.id);
  assert.equal(done.status, 'completed');
  assert.equal(calls, 2);
});

test('post-narration-fit visual mismatch auto-recovers instead of waiting for manual resume', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-jobs-'));
  let calls = 0;
  const store = new AnimationDirectorJobStore(root, async (value) => {
    calls += 1;
    if (calls === 1) throw new Error('Storyboard sau narration-fit vẫn thiếu visual ở scene: 11.');
    return value.project;
  });
  await store.initialize();
  const job = await store.start(input());
  const done = await terminal(store, job.id);
  assert.equal(done.status, 'completed');
  assert.equal(calls, 2);
});

test('failed job clears an in-progress image or guard label and offers checkpoint resume state', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-jobs-'));
  const store = new AnimationDirectorJobStore(root, async (_value, stage) => {
    await stage('Storyboard guard phát hiện 39 lỗi · đang sửa riêng scene 4 · lượt 1/24');
    throw new Error('JSON từ AI Director bị thiếu phần kết thúc.');
  });
  await store.initialize();
  const job = await store.start(input());
  const failed = await terminal(store, job.id);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.stage, 'Đã dừng, giữ checkpoint và tài nguyên');
  assert.match(failed.progressLabel || '', /checkpoint giữ 14% tiến độ/);
  assert.equal(failed.progressCurrent, undefined);
  assert.equal(failed.progressTotal, undefined);
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
  assert.equal(resumed.progressPercent, 99);
  assert.match(resumed.progressLabel || '', /giữ 99% tiến độ/);
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

test('exhausted reconciliation terminates at 24/25 and preserves progress instead of restarting', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-exhausted-'));
  let calls = 0;
  const store = new AnimationDirectorJobStore(root, async (_value, stage) => {
    calls++;
    await stage('Ảnh 24/25');
    throw new FlowSessionError('Flow result could not be confirmed', 'FLOW_RECONCILIATION_EXHAUSTED');
  }, () => 1);
  await store.initialize();
  const job = await store.start(input());
  const done = await terminal(store, job.id);
  assert.equal(done.status, 'failed');
  assert.equal(done.progressCurrent, 24);
  assert.equal(done.progressTotal, 25);
  assert.equal(calls, 1);
});

test('repeated unknown outcome has a finite job retry budget', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'animation-unknown-budget-'));
  let calls = 0;
  const store = new AnimationDirectorJobStore(root, async () => {
    calls++;
    throw new FlowSessionError('unknown outcome', 'FLOW_GENERATION_OUTCOME_UNKNOWN');
  }, () => 1);
  await store.initialize();
  const job = await store.start(input());
  assert.equal((await terminal(store, job.id)).status, 'failed');
  assert.equal(calls, 2);
});
