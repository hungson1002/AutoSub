import { strict as assert } from 'node:assert';
import test from 'node:test';
import { isReadyIsolatedFlowWorker, shouldSpawnIsolatedFlowWorker } from './flowWorkerSupervisor';

test('cookie-authenticated Flow image workers need a live extension connection, not a bearer token', () => {
  assert.equal(isReadyIsolatedFlowWorker({ tokenReady: true, extensionConnected: false }), false);
  assert.equal(isReadyIsolatedFlowWorker({ tokenReady: false, extensionConnected: true }), true);
  assert.equal(isReadyIsolatedFlowWorker({ tokenReady: true, extensionConnected: true }), true);
});

test('a slow health endpoint never starts a competing worker when the registered port is listening', () => {
  assert.equal(shouldSpawnIsolatedFlowWorker(true, true), false);
  assert.equal(shouldSpawnIsolatedFlowWorker(false, true), false);
  assert.equal(shouldSpawnIsolatedFlowWorker(false, false), true);
});
