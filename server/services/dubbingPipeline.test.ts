import assert from 'node:assert/strict';
import test from 'node:test';
import { dubbingProgressPercent, runContinuousSpeechPipeline } from './dubbingJobs';

test('continuous pipeline overlaps preparation but keeps at most two groups active', async () => {
  let active = 0;
  let peak = 0;
  const completed: number[] = [];
  let release!: () => void;
  const firstPair = new Promise<void>((resolve) => { release = resolve; });
  await runContinuousSpeechPipeline([0, 1, 2, 3], async (id) => {
    peak = Math.max(peak, ++active);
    if (id === 1) release();
    if (id < 2) await firstPair;
    completed.push(id);
    active -= 1;
  }, new AbortController().signal);
  assert.equal(peak, 2);
  assert.equal(active, 0);
  assert.deepEqual(completed.sort(), [0, 1, 2, 3]);
});

test('cancelled pipeline drains started work and never starts queued groups', async () => {
  const controller = new AbortController();
  const started: number[] = [];
  let finished = 0;
  await assert.rejects(runContinuousSpeechPipeline([0, 1, 2, 3], async (id) => {
    started.push(id);
    await Promise.resolve();
    controller.abort();
    finished += 1;
  }, controller.signal), { name: 'AbortError' });
  assert.deepEqual(started, [0, 1]);
  assert.equal(finished, 2);
});

test('pipeline waits for in-flight group cleanup before reporting failure', async () => {
  let cleaned = false;
  await assert.rejects(runContinuousSpeechPipeline([0, 1], async (id) => {
    if (!id) throw new Error('failure');
    await new Promise((resolve) => setTimeout(resolve, 10));
    cleaned = true;
  }, new AbortController().signal), /failure/);
  assert.equal(cleaned, true);
});

test('100 percent is reserved for completed audio, not completed cues', () => {
  const job = { status: 'running' as const, totalCues: 235, doneCues: 235 };
  assert.equal(dubbingProgressPercent(job), 85);
  assert.equal(dubbingProgressPercent({ ...job, finalization: { stage: 'continuous', completed: 38, total: 45 } }), 93);
  assert.equal(dubbingProgressPercent({ ...job, finalization: { stage: 'mixing', completed: 0, total: 1 } }), 96);
  assert.equal(dubbingProgressPercent({ ...job, finalization: { stage: 'mastering', completed: 0, total: 1 } }), 98);
  assert.equal(dubbingProgressPercent({ ...job, status: 'completed' }), 100);
  assert.equal(dubbingProgressPercent({ ...job, doneCues: 0 }), 0);
});
