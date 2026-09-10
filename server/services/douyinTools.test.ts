import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { validateDouyinTool, redactDouyinData } from './douyinTools';
import { douyinRoutes } from '../routes/douyin';

test('tool input accepts only known actions, canonical IDs and explicit write confirmation', () => {
  assert.equal(validateDouyinTool({ operation: 'detail', params: { video: 'https://www.douyin.com/video/123456' } }).params.video, '123456');
  for (const body of [{ operation: '__proto__' }, { operation: 'detail', params: { video: 'https://evil.example/video/123456' } }, { operation: 'like', params: { video: '123456' } }, { operation: 'profile', params: { user: '../../secret' } }, { operation: 'users', params: { query: 'x' }, cursor: '-1' }]) assert.throws(() => validateDouyinTool(body));
  assert.equal(validateDouyinTool({ operation: 'like', params: { video: '123456' }, confirmed: true, requestId: '12345678-1234-1234-1234-123456789012' }).operation, 'like');
});
test('tool response removes nested credentials', () => {
  assert.deepEqual(redactDouyinData({ nickname: 'test', ticket: 'hidden', nested: [{ sessionid: 'hidden', text: 'hello' }] }), { nickname: 'test', nested: [{ text: 'hello' }] });
});
test('tool route refuses remote origins and writes lacking confirmation before execution', async () => {
  const app = Fastify(); await app.register(douyinRoutes);
  try {
    const response = await app.inject({ method: 'POST', url: '/api/douyin/tools', headers: { origin: 'https://evil.example' }, payload: { operation: 'like', params: { video: '123456' } } });
    assert.equal(response.statusCode, 403);
    const invalid = await app.inject({ method: 'POST', url: '/api/douyin/tools', payload: { operation: 'like', params: { video: '123456' } } });
    assert.equal(invalid.statusCode, 400);
    assert.equal(invalid.headers['cache-control'], 'no-store');
  } finally { await app.close(); }
});
