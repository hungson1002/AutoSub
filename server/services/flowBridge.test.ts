import assert from 'node:assert/strict';
import test from 'node:test';
import { completeFlowBridgeVideo, failFlowBridgeCommand, generateViaFlowBridge, updateFlowBridge } from './flowBridge';

test('re-delivers an in-flight browser command after its delivery lease expires', async () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  updateFlowBridge({ url: 'https://labs.google/fx/tools/flow' });
  const pending = generateViaFlowBridge('prompt', 'unused.mp4');
  const first = updateFlowBridge({ url: 'https://labs.google/fx/tools/flow' }).command;
  assert.ok(first?.id);
  assert.equal(updateFlowBridge({ url: 'https://labs.google/fx/tools/flow' }).command, undefined);
  now += 11_000;
  assert.equal(updateFlowBridge({ url: 'https://labs.google/fx/tools/flow' }).command?.id, first.id);
  failFlowBridgeCommand(first.id, 'test cleanup');
  await assert.rejects(pending, /test cleanup/);
  Date.now = originalNow;
});

test('rejects a non-MP4 payload returned as a completed Flow video', async () => {
  updateFlowBridge({ url: 'https://labs.google/fx/tools/flow' });
  const pending = generateViaFlowBridge('prompt', 'unused.mp4');
  const command = updateFlowBridge({ url: 'https://labs.google/fx/tools/flow' }).command;
  assert.ok(command?.id);
  await assert.rejects(() => completeFlowBridgeVideo(command.id, Buffer.alloc(10_000)), /không phải video MP4/i);
  failFlowBridgeCommand(command.id, 'test cleanup');
  await assert.rejects(pending, /test cleanup/);
});
