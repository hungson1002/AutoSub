import { strict as assert } from 'node:assert';
import test from 'node:test';
import Fastify from 'fastify';
import { douyinRoutes } from './douyin';

test('douyinRoutes downloads thumbnails from supported image CDNs', async () => {
  const app = Fastify();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from([1, 2, 3, 4]), {
    status: 200,
    headers: { 'content-type': 'image/jpeg', 'content-length': '4' },
  });
  await app.register(douyinRoutes);

  try {
    const response = await app.inject({
      method: 'GET',
      url: `/api/douyin/thumbnail?url=${encodeURIComponent('https://i0.hdslb.com/bfs/archive/cover.jpg')}&filename=${encodeURIComponent('Ảnh bìa')}`,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'image/jpeg');
    assert.equal(response.headers['content-disposition'], 'inline');
    assert.equal(response.headers['cache-control'], 'public, max-age=3600');
    assert.equal(response.rawPayload.length, 4);

    const download = await app.inject({
      method: 'GET',
      url: `/api/douyin/thumbnail?url=${encodeURIComponent('https://i0.hdslb.com/bfs/archive/cover.jpg')}&filename=${encodeURIComponent('Ảnh bìa')}&download=1`,
    });
    assert.equal(download.statusCode, 200);
    assert.match(download.headers['content-disposition'] || '', /attachment;.*\.jpg/);

    const blocked = await app.inject({
      method: 'GET',
      url: `/api/douyin/thumbnail?url=${encodeURIComponent('http://127.0.0.1/private')}`,
    });
    assert.equal(blocked.statusCode, 400);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});

test('douyinRoutes handles parsing and batch job lifecycle', async () => {
  const app = Fastify();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 404 });
  await app.register(douyinRoutes);

  try {
    // Test parsing
    const parseRes = await app.inject({
      method: 'POST',
      url: '/api/douyin/parse',
      payload: {
        text: 'Xem clip này nè https://v.douyin.com/iAbc123/ hay lắm, https://v.douyin.com/iXyz789/ và https://www.bilibili.com/video/BV1xx411c7mD',
      },
    });

    assert.equal(parseRes.statusCode, 200);
    const parseData = parseRes.json() as { urls: string[]; count: number };
    assert.equal(parseData.count, 3);

    // Test creating batch job
    const batchRes = await app.inject({
      method: 'POST',
      url: '/api/douyin/batch',
      payload: {
        urls: parseData.urls,
      },
    });

    assert.equal(batchRes.statusCode, 202);
    const batchData = batchRes.json() as { id: string; status: string; totalItems: number };
    assert.ok(batchData.id);
    assert.equal(batchData.totalItems, 3);

    // Test getting batch status
    const statusRes = await app.inject({
      method: 'GET',
      url: `/api/douyin/batch/${batchData.id}`,
    });
    assert.equal(statusRes.statusCode, 200);
    const statusData = statusRes.json() as { id: string; items: unknown[] };
    assert.equal(statusData.id, batchData.id);

    // Test cancelling batch
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/api/douyin/batch/${batchData.id}/cancel`,
    });
    assert.equal(cancelRes.statusCode, 200);
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});
