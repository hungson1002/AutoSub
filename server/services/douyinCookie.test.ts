import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDouyinCookieStore } from './douyinCookie';
import { protectTunnelKey } from './mcpTunnel';

test('Windows DPAPI encrypts and restores a test cookie', { skip: process.platform !== 'win32' }, async () => {
  const encrypted = await protectTunnelKey('test-cookie-only');
  assert.notEqual(encrypted, 'test-cookie-only');
  assert.equal(await protectTunnelKey(encrypted, true), 'test-cookie-only');
});

test('cookie store persists encrypted value, reloads and deletes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'autosub-cookie-test-'));
  const protect = async (value: string, decrypt = false) => decrypt ? Buffer.from(value, 'base64').toString() : Buffer.from(value).toString('base64');
  try {
    const store = createDouyinCookieStore(dir, protect);
    assert.equal(await store.has(), false);
    await store.save('fixture-session');
    assert.notEqual(await readFile(path.join(dir, 'douyin-cookie'), 'utf8'), 'fixture-session');
    assert.equal(await createDouyinCookieStore(dir, protect).read(), 'fixture-session');
    await store.save('');
    assert.equal(await store.has(), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
