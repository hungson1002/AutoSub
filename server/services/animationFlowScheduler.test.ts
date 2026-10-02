import assert from 'node:assert/strict';
import test from 'node:test';
import { createStoryboardSceneGate, flowWorkerRecoveryKind, flowWorkerRetryDelayMs, interleaveStoryboardFlowWork, isolatedFlowPipelineWorkerCount } from './animationFlowScheduler';

test('sibling images start together after their scene anchor is saved, without waiting for sibling QC', async () => {
  const claim = createStoryboardSceneGate();
  const anchor = claim(0);
  await anchor.ready;
  const siblings = Array.from({ length: 18 }, () => claim(0));
  let started = 0;
  const pending = siblings.map(async (sibling) => { await sibling.ready; started++; });
  await Promise.resolve();
  assert.equal(started, 0, 'all shots need the first scene reference');
  anchor.release();
  await Promise.all(pending);
  assert.equal(started, 18, 'no sibling must wait for another sibling to finish or pass QC');
});

test('resume uses an existing scene reference immediately and independent scenes never block each other', async () => {
  const claim = createStoryboardSceneGate([0]);
  await claim(0).ready;
  await claim(0).ready;
  const unresolved = claim(1);
  await claim(2).ready;
  unresolved.release();
  await claim(1).ready;
});

test('first Flow scheduler wave spans independent scenes instead of blocking behind same-scene continuity', () => {
  const items = Array.from({ length: 20 }, (_, sceneIndex) =>
    Array.from({ length: 4 }, (_, beatIndex) => ({
      taskIndex: sceneIndex * 4 + beatIndex,
      task: { sceneIndex, beatIndex },
    }))
  ).flat();

  const ordered = interleaveStoryboardFlowWork(items);
  const firstWave = ordered.slice(0, 14);
  assert.equal(new Set(firstWave.map((item) => item.task.sceneIndex)).size, 14);
  assert.ok(firstWave.every((item) => item.task.beatIndex === 0));
});

test('isolated Flow keeps extra pipeline workers ready while the real image pool remains capped separately', () => {
  assert.equal(isolatedFlowPipelineWorkerCount(14, 72), 28);
  assert.equal(isolatedFlowPipelineWorkerCount(14, 20), 20);
  assert.equal(isolatedFlowPipelineWorkerCount(14, 8), 8);
});

test('Flow worker task recovery distinguishes safe handoff from uncertain reconciliation and Google throttling', () => {
  assert.equal(flowWorkerRecoveryKind({ code: 'FLOW_EXTENSION_NOT_CONNECTED' }), 'reroute');
  assert.equal(flowWorkerRecoveryKind({ code: 'FLOW_NO_AUTHENTICATED_WORKERS' }), 'reroute');
  assert.equal(flowWorkerRecoveryKind(new Error('FLOW_NO_HEALTHY_ALTERNATE_WORKER')), 'reroute');
  assert.equal(flowWorkerRecoveryKind(new Error('Flow worker account-test không mở được port 8118.')), 'reroute');
  assert.equal(flowWorkerRecoveryKind({ code: 'FLOW_LOCAL_WORKER_UNAVAILABLE' }), 'reroute');
  assert.equal(flowWorkerRecoveryKind({ code: 'FLOW_GENERATION_OUTCOME_UNKNOWN' }), 'reconcile');
  assert.equal(flowWorkerRecoveryKind({ code: 'FLOW_FETCH_FAILED' }), 'reconcile');
  assert.equal(flowWorkerRecoveryKind({ code: 'FLOW_GENERATION_OUTCOME_UNKNOWN' }, 1), undefined);
  assert.equal(flowWorkerRecoveryKind({ code: 'FLOW_FETCH_FAILED' }, 1), undefined);
  assert.equal(flowWorkerRecoveryKind({ code: 'FLOW_RECONCILIATION_EXHAUSTED', message: 'FLOW_GENERATION_OUTCOME_UNKNOWN' }), undefined);
  assert.equal(flowWorkerRecoveryKind({ code: 'FLOW_EXTENSION_NOT_CONNECTED' }, 10), 'reroute');
  assert.equal(flowWorkerRecoveryKind({ code: 'FLOW_IMAGE_TRAFFIC_THROTTLED' }), undefined);
  assert.equal(flowWorkerRecoveryKind({ code: 'FLOW_IMAGE_RECAPTCHA_BLOCKED' }), undefined);
  assert.equal(flowWorkerRecoveryKind({ code: 'FLOW_ACCOUNT_SESSION_UNVERIFIED' }), undefined);
});

test('Flow task retry backoff grows per task and stays bounded', () => {
  assert.equal(flowWorkerRetryDelayMs(1), 1_000);
  assert.equal(flowWorkerRetryDelayMs(2), 2_000);
  assert.equal(flowWorkerRetryDelayMs(20), 30_000);
});
