import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { CreateProductAdJobInput } from '../services/productAdJobs';
import { cancelProductAdJob, createProductAdFlowPreview, createProductAdJob, getProductAdJob, getProductAdResult } from '../services/productAdJobs';

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

function sendRouteError(reply: { code: (status: number) => { send: (value: unknown) => unknown } }, error: unknown, fallback: string, status = 400) {
  return reply.code(status).send({ error: errorMessage(error, fallback) });
}

export async function productAdRoutes(app: FastifyInstance) {
  app.post('/api/product-ads/jobs', async (request, reply) => {
    try { return reply.code(202).send(await createProductAdJob(request.body as CreateProductAdJobInput)); }
    catch (error) { return sendRouteError(reply, error, 'Không thể tạo product ad job.'); }
  });

  app.get('/api/product-ads/jobs/:id', async (request, reply) => {
    try { return await getProductAdJob(String((request.params as { id?: string }).id || '')); }
    catch (error) { return sendRouteError(reply, error, 'Không tìm thấy product ad job.', 404); }
  });

  app.post('/api/product-ads/jobs/:id/cancel', async (request, reply) => {
    try { return await cancelProductAdJob(String((request.params as { id?: string }).id || '')); }
    catch (error) { return sendRouteError(reply, error, 'Không thể hủy product ad job.'); }
  });

  app.post('/api/product-ads/jobs/:id/flow-preview', async (request, reply) => {
    try { return reply.code(202).send(await createProductAdFlowPreview(String((request.params as { id?: string }).id || ''))); }
    catch (error) { return sendRouteError(reply, error, 'Không thể tạo video Google Flow.'); }
  });

  app.get('/api/product-ads/jobs/:id/video', async (request, reply) => {
    try {
      const result = await getProductAdResult(String((request.params as { id?: string }).id || ''));
      const rangeHeader = request.headers.range;
      let start = 0;
      let end = result.size - 1;
      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
        if (!match) return reply.code(416).header('Content-Range', `bytes */${result.size}`).send();
        const requestedStart = match[1] ? Number(match[1]) : undefined;
        const requestedEnd = match[2] ? Number(match[2]) : undefined;
        start = requestedStart ?? Math.max(0, result.size - (requestedEnd || 0));
        end = Math.min(result.size - 1, requestedEnd ?? result.size - 1);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || start >= result.size) return reply.code(416).header('Content-Range', `bytes */${result.size}`).send();
        reply.code(206).header('Content-Range', `bytes ${start}-${end}/${result.size}`);
      }
      const download = (request.query as { download?: string } | undefined)?.download === '1';
      reply.header('Content-Type', 'video/mp4');
      reply.header('Content-Length', String(end - start + 1));
      reply.header('Accept-Ranges', 'bytes');
      reply.header('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="autosub-product-ad.mp4"`);
      return reply.send(createReadStream(result.path, { start, end }));
    } catch (error) {
      return sendRouteError(reply, error, 'Video quảng cáo chưa sẵn sàng.', 404);
    }
  });
}
