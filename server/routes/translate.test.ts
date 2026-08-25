import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { AIProvider } from '../types';
import { translationRoutes } from './translate';

test('returns and preserves valid cue translations when other cues remain unresolved', async () => {
  const originalFetch = globalThis.fetch;
  const provider: AIProvider = {
    id: 'translation-provider', name: 'Translation provider', baseUrl: 'http://provider.test/v1', enabled: true,
    models: [], providerType: 'openai-compatible', authType: 'none', capabilities: { chat: true },
  };
  globalThis.fetch = (async (_input: string | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { messages?: Array<{ role: string; content: string }> };
    const payload = JSON.parse(request.messages?.[1]?.content || '{}') as { items?: Array<{ id: string }> };
    const items = (payload.items || []).map((item) => item.id === 'a'
      ? { id: item.id, translation: 'Bản dịch hợp lệ' }
      : { id: item.id, translation: '[Không rõ]' });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const app = Fastify();
  await app.register(translationRoutes);
  try {
    const response = await app.inject({
      method: 'POST', url: '/api/translate',
      payload: {
        provider, model: 'model', sourceLanguage: 'Chinese', targetLanguage: 'Vietnamese', style: 'Review phim',
        items: [
          { id: 'a', text: '第一句', targetDurationMs: 1000 },
          { id: 'b', text: '第二句', targetDurationMs: 1000 },
        ],
      },
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      items: [{ id: 'a', translation: 'Bản dịch hợp lệ' }],
      pendingCueIds: ['b'],
      warning: 'Provider trả về placeholder “không rõ/bỏ qua” thay vì bản dịch. AutoSub sẽ retry riêng các cue đó. Còn 1 cue chưa dịch sau 3 lần retry.',
    });
  } finally {
    globalThis.fetch = originalFetch;
    await app.close();
  }
});
