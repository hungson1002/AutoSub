import { strict as assert } from 'node:assert';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import Fastify from 'fastify';
import { uploadRoutes } from './uploads';
import { cleanupUploadSession, storeUpload } from '../services/uploads';

test('stored source video can be restored with HTTP range requests', async () => {
  const stored = await storeUpload(Readable.from(Buffer.from('0123456789')), 'source.mp4', 'video/mp4');
  const app = Fastify();
  await app.register(uploadRoutes);
  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/uploads/${stored.uploadId}/media`,
      headers: { range: 'bytes=2-5' },
    });
    assert.equal(response.statusCode, 206);
    assert.equal(response.headers['content-type'], 'video/mp4');
    assert.equal(response.headers['content-range'], 'bytes 2-5/10');
    assert.equal(response.body, '2345');
  } finally {
    await app.close();
    await cleanupUploadSession(stored.directory);
  }
});

test('local import returns an uploadId without receiving binary and deletion preserves the source', async () => {
  const sourceDirectory = await mkdtemp(path.join(os.tmpdir(), 'autosub-route-linked-'));
  const sourcePath = path.join(sourceDirectory, 'source.mp4');
  await writeFile(sourcePath, Buffer.from('0123456789'));
  const app = Fastify();
  await app.register(uploadRoutes, { pickLocalMediaFile: async () => sourcePath });
  let uploadId = '';
  try {
    const imported = await app.inject({ method: 'POST', url: '/api/uploads/import-local', headers: { origin: 'http://127.0.0.1:5173', 'content-type': 'application/json' }, payload: { kind: 'video' } });
    assert.equal(imported.statusCode, 201);
    const body = imported.json() as { uploadId: string; sourceMode: string; size: number };
    uploadId = body.uploadId;
    assert.equal(body.sourceMode, 'linked');
    assert.equal(body.size, 10);

    const media = await app.inject({ method: 'GET', url: `/api/uploads/${uploadId}/media`, headers: { range: 'bytes=4-7' } });
    assert.equal(media.statusCode, 206);
    assert.equal(media.body, '4567');

    const removed = await app.inject({ method: 'DELETE', url: `/api/uploads/${uploadId}` });
    assert.equal(removed.statusCode, 204);
    assert.equal((await stat(sourcePath)).isFile(), true);
  } finally {
    await app.close();
    await rm(sourceDirectory, { recursive: true, force: true });
  }
});
