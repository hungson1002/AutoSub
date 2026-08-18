import { strict as assert } from 'node:assert';
import test from 'node:test';
import Fastify from 'fastify';
import { douyinRoutes } from './douyin';

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
        text: 'Xem clip này nè https://v.douyin.com/iAbc123/ hay lắm và https://v.douyin.com/iXyz789/',
      },
    });

    assert.equal(parseRes.statusCode, 200);
    const parseData = parseRes.json() as { urls: string[]; count: number };
    assert.equal(parseData.count, 2);

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
    assert.equal(batchData.totalItems, 2);

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
