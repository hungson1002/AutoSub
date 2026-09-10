import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createTunnelStore, protectTunnelKey, recentTunnelPoll, tunnelConfigSchema } from './mcpTunnel';

test('tunnel validation and readiness require a recent successful OpenAI poll', () => {
  assert.equal(tunnelConfigSchema.safeParse({ tunnelId: 'wrong', apiKey: 'secret' }).success, false);
  assert.equal(tunnelConfigSchema.safeParse({ tunnelId: `tunnel_${'a'.repeat(32)}`, apiKey: '' }).success, true);
  assert.equal(recentTunnelPoll(''), false);
  assert.equal(recentTunnelPoll('commands_poll_last_successful_timestamp_seconds 0'), false);
  assert.equal(recentTunnelPoll('commands_poll_last_successful_timestamp_seconds 1000', 1030_000), true);
  assert.equal(recentTunnelPoll('commands_poll_last_successful_timestamp_seconds 1000', 1100_000), false);
});

test('Windows DPAPI: key survives reload, blank preserves key, disk never contains plaintext', { skip: process.platform !== 'win32' }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'autosub-tunnel-test-'));
  try {
    const secret = 'sk-test-only-not-a-real-api-key';
    const store = createTunnelStore(directory);
    await store.save({ tunnelId: `tunnel_${'a'.repeat(32)}`, apiKey: secret });
    assert.equal((await readFile(path.join(directory, 'tunnel.json'), 'utf8')).includes(secret), false);
    const reloaded = createTunnelStore(directory);
    assert.equal(await reloaded.key(), secret);
    await reloaded.save({ tunnelId: `tunnel_${'b'.repeat(32)}`, apiKey: '' });
    assert.equal(await reloaded.key(), secret);
    await assert.rejects(() => protectTunnelKey('invalid-ciphertext', true));
  } finally {
    assert.equal(path.dirname(directory), os.tmpdir());
    assert.ok(path.basename(directory).startsWith('autosub-tunnel-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});
