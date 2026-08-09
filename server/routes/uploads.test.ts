import { strict as assert } from 'node:assert';
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
