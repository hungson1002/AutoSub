import { strict as assert } from 'node:assert';
import test from 'node:test';
import { isReadyIsolatedFlowWorker } from './flowWorkerSupervisor';

test('only token-ready workers with a live extension connection enter the active pool', () => {
  assert.equal(isReadyIsolatedFlowWorker({ tokenReady: true, extensionConnected: false }), false);
  assert.equal(isReadyIsolatedFlowWorker({ tokenReady: false, extensionConnected: true }), false);
  assert.equal(isReadyIsolatedFlowWorker({ tokenReady: true, extensionConnected: true }), true);
});
