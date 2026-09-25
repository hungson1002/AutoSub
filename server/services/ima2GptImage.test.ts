import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { ima2CodexHomePath, ima2ImageSize, ima2ServerSpawnOptions, safeIma2LoopbackUrl } from './ima2GptImage';

test('GPT Image Codex credentials use an AutoSub-owned home directory', () => {
  const configDirectory = 'local/AutoSub/ima2-gen';
  assert.equal(ima2CodexHomePath(configDirectory), path.join(configDirectory, 'codex-home'));
});

test('GPT Image sidecar is detached from the backend lifecycle', () => {
  assert.deepEqual(ima2ServerSpawnOptions(), { detached: true, windowsHide: true, stdio: 'ignore' });
});

test('ima2 integration accepts only local HTTP server URLs', () => {
  assert.equal(safeIma2LoopbackUrl('http://127.0.0.1:3333'), 'http://127.0.0.1:3333');
  assert.equal(safeIma2LoopbackUrl('http://localhost:3333/'), 'http://localhost:3333');
  assert.equal(safeIma2LoopbackUrl('http://[::1]:3333'), 'http://[::1]:3333');
  assert.equal(safeIma2LoopbackUrl('https://127.0.0.1:3333'), undefined);
  assert.equal(safeIma2LoopbackUrl('http://example.com:3333'), undefined);
  assert.equal(safeIma2LoopbackUrl('http://127.0.0.1:3333/api'), undefined);
  assert.equal(safeIma2LoopbackUrl('http://user:pass@127.0.0.1:3333'), undefined);
});

test('GPT image dimensions follow the animation canvas aspect ratio', () => {
  assert.equal(ima2ImageSize(1920, 1080), '1824x1024');
  assert.equal(ima2ImageSize(1080, 1920), '1024x1824');
  assert.equal(ima2ImageSize(1080, 1080), '1024x1024');
  assert.equal(ima2ImageSize(0, 0), '1024x1024');
});
