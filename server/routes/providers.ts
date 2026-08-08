import type { FastifyInstance } from 'fastify';
import type { AIProvider, Capability } from '../types';
import { listModels, listVoices, ProviderError, testConnection, testModel } from '../adapters';

export async function providerRoutes(app: FastifyInstance) {
  app.post('/api/providers/models', async (request, reply) => {
    try {
      const provider = (request.body as { provider?: AIProvider }).provider;
      if (!provider?.baseUrl) return reply.code(400).send({ error: 'Base URL là bắt buộc.' });
      try {
        return { models: await listModels(provider) };
      } catch (error) {
        if (error instanceof ProviderError && [404, 405, 501].includes(error.status)) {
          return { models: [], warning: 'Provider không hỗ trợ tự động lấy model. Bạn vẫn có thể nhập Model ID thủ công.' };
        }
        throw error;
      }
    } catch (error) {
      const message = error instanceof ProviderError ? error.message : 'Không thể lấy models từ provider.';
      return reply.code(error instanceof ProviderError ? error.status : 502).send({ error: message, detail: error instanceof ProviderError ? error.detail : undefined });
    }
  });

  app.post('/api/providers/test', async (request, reply) => {
    try {
      const provider = (request.body as { provider?: AIProvider }).provider;
      if (!provider?.baseUrl) return reply.code(400).send({ error: 'Base URL là bắt buộc.' });
      return await testConnection(provider);
    } catch (error) {
      const message = error instanceof ProviderError ? error.message : 'Test connection thất bại.';
      return reply.code(error instanceof ProviderError ? error.status : 502).send({ error: message, detail: error instanceof ProviderError ? error.detail : undefined });
    }
  });

  app.post('/api/providers/voices', async (request, reply) => {
    try {
      const provider = (request.body as { provider?: AIProvider }).provider;
      if (!provider?.baseUrl) return reply.code(400).send({ error: 'Base URL là bắt buộc.' });
      return { voices: await listVoices(provider) };
    } catch (error) {
      const message = error instanceof ProviderError ? error.message : 'Không thể lấy voices từ provider.';
      return reply.code(error instanceof ProviderError ? error.status : 502).send({ error: message, detail: error instanceof ProviderError ? error.detail : undefined });
    }
  });

  app.post('/api/providers/test-model', async (request, reply) => {
    try {
      const body = request.body as { provider?: AIProvider; model?: string; capability?: Capability };
      if (!body.provider?.baseUrl || !body.model?.trim()) return reply.code(400).send({ error: 'Cần provider và Model ID để test.' });
      return await testModel(body.provider, body.model.trim(), body.capability || 'translation');
    } catch (error) {
      const message = error instanceof ProviderError ? error.message : 'Test model thất bại.';
      return reply.code(error instanceof ProviderError ? error.status : 502).send({ error: message, detail: error instanceof ProviderError ? error.detail : undefined });
    }
  });
}
