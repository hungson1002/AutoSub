import type { FastifyInstance } from 'fastify';
import { ima2GptImageStatus, pollIma2GptLogin, startIma2GptLogin } from '../services/ima2GptImage';

const message = (error: unknown) => error instanceof Error ? error.message : 'ima2-gen gặp lỗi không xác định.';

export async function ima2GptImageRoutes(app: FastifyInstance) {
  app.get('/api/gpt-image/status', async (_request, reply) => {
    try { return await ima2GptImageStatus(); }
    catch (error) { return reply.code(503).send({ error: message(error) }); }
  });

  app.post('/api/gpt-image/connect', async (_request, reply) => {
    try { return await startIma2GptLogin(); }
    catch (error) { return reply.code(503).send({ error: message(error) }); }
  });

  app.get('/api/gpt-image/connect/:sessionId', async (request, reply) => {
    try { return await pollIma2GptLogin(String((request.params as { sessionId?: string }).sessionId || '')); }
    catch (error) { return reply.code(502).send({ error: message(error) }); }
  });
}
