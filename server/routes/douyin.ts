import type { FastifyInstance } from 'fastify';
import {
  extractDouyinUrls,
  resolveDouyinUrl,
  createBatchJob,
  getBatchJob,
  cancelBatchJob,
} from '../services/douyinDownloader';
import { closeDouyinExtractor } from '../services/douyinExtractor';

export async function douyinRoutes(app: FastifyInstance) {
  app.addHook('onClose', closeDouyinExtractor);
  // Parse URLs from raw text or list of strings
  app.post('/api/douyin/parse', async (request, reply) => {
    const body = (request.body as { text?: string; urls?: string[]; resolve?: boolean } | undefined) || {};
    let urls: string[] = [];

    if (body.text) {
      urls = extractDouyinUrls(body.text);
    } else if (Array.isArray(body.urls)) {
      urls = body.urls.flatMap((u) => extractDouyinUrls(u));
    }

    if (urls.length === 0) {
      return reply.code(400).send({ error: 'Không tìm thấy đường dẫn Douyin hợp lệ.' });
    }

    if (!body.resolve) {
      return reply.send({ urls, count: urls.length });
    }

    // Resolve details for each link concurrently
    const results = await Promise.allSettled(urls.map((url) => resolveDouyinUrl(url)));
    const items = results.map((res, index) => {
      if (res.status === 'fulfilled') {
        return { success: true, info: res.value };
      }
      return { success: false, url: urls[index], error: res.reason instanceof Error ? res.reason.message : 'Không thể lấy thông tin.' };
    });

    return reply.send({ urls, count: urls.length, items });
  });

  // Start batch download
  app.post('/api/douyin/batch', async (request, reply) => {
    const body = (request.body as { urls?: string[]; text?: string } | undefined) || {};
    let urls: string[] = [];

    if (Array.isArray(body.urls) && body.urls.length > 0) {
      urls = body.urls.flatMap((u) => extractDouyinUrls(u));
    } else if (body.text) {
      urls = extractDouyinUrls(body.text);
    }

    if (urls.length === 0) {
      return reply.code(400).send({ error: 'Danh sách link Douyin trống hoặc không hợp lệ.' });
    }

    const job = createBatchJob(urls);
    return reply.code(202).send(job);
  });

  // Get batch download status
  app.get('/api/douyin/batch/:id', async (request, reply) => {
    const id = String((request.params as { id?: string }).id || '');
    const job = getBatchJob(id);
    if (!job) {
      return reply.code(404).send({ error: 'Không tìm thấy batch job.' });
    }
    return reply.send(job);
  });

  // Cancel batch download
  app.post('/api/douyin/batch/:id/cancel', async (request, reply) => {
    const id = String((request.params as { id?: string }).id || '');
    const cancelled = cancelBatchJob(id);
    if (!cancelled) {
      return reply.code(404).send({ error: 'Không tìm thấy batch job để hủy.' });
    }
    return reply.send({ ok: true, batchId: id });
  });
}
