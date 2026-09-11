import { strict as assert } from 'node:assert';
import test from 'node:test';
import Fastify from 'fastify';
import { douyinRoutes } from './douyin';
import { normalizeDouyinSearch, validateDouyinSearch } from '../services/douyinSearch';

test('cookie management rejects foreign origins and nonlocal clients', async () => {
  const app = Fastify();
  await app.register(douyinRoutes);
  try {
    const foreign = await app.inject({ method: 'PUT', url: '/api/douyin/search-cookie', headers: { origin: 'https://untrusted.example' }, payload: { cookie: 'fixture' } });
    assert.equal(foreign.statusCode, 403);
    const relevance = await app.inject({ method: 'POST', url: '/api/douyin/relevance', headers: { origin: 'https://untrusted.example' }, payload: {} });
    assert.equal(relevance.statusCode, 403);
    const invalidRelevance = await app.inject({ method: 'POST', url: '/api/douyin/relevance', payload: { provider: { apiKey: 'secret-not-returned' } } });
    assert.equal(invalidRelevance.statusCode, 400);
    assert.ok(!invalidRelevance.body.includes('secret-not-returned'));
    const remote = await app.inject({ method: 'GET', url: '/api/douyin/search-cookie', remoteAddress: '192.0.2.1' });
    assert.equal(remote.statusCode, 403);
    const invalid = await app.inject({ method: 'PUT', url: '/api/douyin/search-cookie', payload: { cookie: '' } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.headers['cache-control'], 'no-store');
  } finally { await app.close(); }
});

test('Douyin search validates filters and never accepts multiline cookies', () => {
  assert.deepEqual(validateDouyinSearch({ keyword: '  动画 ' }), { keyword: '动画', sort: '0', publishTime: '0', cookie: undefined, offset: 0, count: 20, searchId: '', filterDuration: '', searchRange: '0', exactKeyword: false, excludeKeywords: '' });
  assert.equal(validateDouyinSearch({ keyword: '动画', filterDuration: '60+', exactKeyword: true }).filterDuration, '60+');
  for (const extra of [{ exactKeyword: 'true' }, { excludeKeywords: 42 }, { excludeKeywords: 'x'.repeat(301) }]) assert.throws(() => validateDouyinSearch({ keyword: 'x', ...extra }));
  for (const extra of [{ offset: -1 }, { offset: 0.5 }, { count: 999 }, { searchId: 'bad\nvalue' }, { filterDuration: 'bad' }, { searchRange: '4' }]) assert.throws(() => validateDouyinSearch({ keyword: 'x', ...extra }));
  for (const body of [{ keyword: '' }, { keyword: 'x', sort: '99' }, { keyword: 'x', publishTime: '-1' }, { keyword: 'x', cookie: 'a=b\r\nx=y' }]) assert.throws(() => validateDouyinSearch(body));
});

test('Douyin search normalizes video results without trusting URLs or duplicates', () => {
  const video = { aweme_id: '1234567890', desc: '动画', author: { nickname: '作者' }, statistics: { digg_count: 42 }, video: { duration: 12300, cover: { url_list: ['javascript:bad', 'https://p.example.byteimg.com/cover.jpg'] } } };
  const items = normalizeDouyinSearch({ data: [{ aweme_info: video }, { aweme_info: video }, { aweme_info: { ...video, aweme_id: '1234567891', images: [{}] } }, { aweme_info: { ...video, aweme_id: '../bad' } }] });
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://www.douyin.com/video/1234567890');
  assert.equal(items[0].duration, 12.3);
  assert.equal(items[0].likes, 42);
  assert.equal(items[0].views, null);
  assert.equal(normalizeDouyinSearch({ data: [{ ...video, statistics: { play_count: 23456 } }] })[0].views, 23456);
  assert.equal(normalizeDouyinSearch({ data: [{ ...video, statistics: { play_count: 0 } }] })[0].views, null);
  assert.equal(items[0].comments, 0);
  assert.equal(items[0].shares, 0);
  assert.equal(items[0].publishedAt, 0);
  assert.equal(items[0].coverUrl, 'https://p.example.byteimg.com/cover.jpg');
  assert.throws(() => normalizeDouyinSearch({ data: null }));
  const malformed = normalizeDouyinSearch({ data: [{ aweme_info: { ...video, video: { cover: { url_list: 'not-an-array' } } } }] });
  assert.equal(malformed[0].coverUrl, undefined);
  const unsafe = normalizeDouyinSearch({ data: [{ aweme_info: { ...video, video: { cover: { url_list: ['https://p.byteimg.com@localhost/secret', 'https://p.byteimg.com:8443/private'] } } } }] });
  assert.equal(unsafe[0].coverUrl, undefined);
});

test('Douyin search route rejects malformed input without returning secrets', async () => {
  const app = Fastify();
  await app.register(douyinRoutes);
  try {
    const result = await app.inject({ method: 'POST', url: '/api/douyin/search', payload: { keyword: '', cookie: 'secret-value' } });
    assert.equal(result.statusCode, 400);
    assert.equal(result.headers['cache-control'], 'no-store');
    assert.ok(!result.body.includes('secret-value'));
    const foreign = await app.inject({ method: 'POST', url: '/api/douyin/search', headers: { origin: 'https://untrusted.example' }, payload: { keyword: 'test' } });
    assert.equal(foreign.statusCode, 403);
  } finally { await app.close(); }
});

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
