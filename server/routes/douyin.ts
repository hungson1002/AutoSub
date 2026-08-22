import type { FastifyInstance } from 'fastify';
import { Readable } from 'node:stream';
import {
  extractDouyinUrls,
  resolveSupportedVideoUrl,
  createBatchJob,
  getBatchJob,
  cancelBatchJob,
} from '../services/douyinDownloader';
import { closeDouyinExtractor } from '../services/douyinExtractor';

const THUMBNAIL_HOST_SUFFIXES = [
  '.hdslb.com',
  '.biliimg.com',
  '.douyinpic.com',
  '.byteimg.com',
  '.pstatp.com',
];

function isSupportedThumbnailUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    return (url.protocol === 'https:' || url.protocol === 'http:')
      && THUMBNAIL_HOST_SUFFIXES.some((suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

export async function douyinRoutes(app: FastifyInstance) {
  app.addHook('onClose', closeDouyinExtractor);

  app.get('/api/douyin/thumbnail', async (request, reply) => {
    const query = request.query as { url?: string; filename?: string };
    const imageUrl = String(query.url || '');
    if (!isSupportedThumbnailUrl(imageUrl)) {
      return reply.code(400).send({ error: 'Đường dẫn thumbnail không được hỗ trợ.' });
    }

    let response: Response;
    try {
      const isBilibili = /(?:hdslb|biliimg)\.com$/i.test(new URL(imageUrl).hostname);
      response = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
          'Referer': isBilibili ? 'https://www.bilibili.com/' : 'https://www.douyin.com/',
        },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      return reply.code(502).send({ error: error instanceof Error ? error.message : 'Không thể tải thumbnail.' });
    }

    const contentType = response.headers.get('content-type')?.split(';')[0].toLowerCase() || '';
    if (!response.ok || !response.body || !contentType.startsWith('image/')) {
      return reply.code(502).send({ error: 'Máy chủ nguồn không trả về thumbnail hợp lệ.' });
    }

    const extension = contentType === 'image/png' ? 'png'
      : contentType === 'image/webp' ? 'webp'
        : 'jpg';
    const baseName = String(query.filename || 'thumbnail')
      .replace(/\.[A-Za-z0-9]+$/, '')
      .replace(/[\\/:*?"<>|\r\n]/g, '_')
      .slice(0, 80)
      .trim() || 'thumbnail';
    const fallbackName = baseName.replace(/[^\x20-\x7E]/g, '_');
    const encodedName = encodeURIComponent(`${baseName}.${extension}`);

    reply.header('Content-Type', contentType);
    reply.header('Content-Disposition', `attachment; filename="${fallbackName}.${extension}"; filename*=UTF-8''${encodedName}`);
    const length = response.headers.get('content-length');
    if (length) reply.header('Content-Length', length);
    return reply.send(Readable.fromWeb(response.body as any));
  });

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
      return reply.code(400).send({ error: 'Không tìm thấy đường dẫn Douyin hoặc Bilibili hợp lệ.' });
    }

    if (!body.resolve) {
      return reply.send({ urls, count: urls.length });
    }

    // Resolve details for each link concurrently
    const results = await Promise.allSettled(urls.map((url) => resolveSupportedVideoUrl(url)));
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
    const body = (request.body as { urls?: string[]; text?: string; bilibiliQuality?: number } | undefined) || {};
    let urls: string[] = [];

    if (Array.isArray(body.urls) && body.urls.length > 0) {
      urls = body.urls.flatMap((u) => extractDouyinUrls(u));
    } else if (body.text) {
      urls = extractDouyinUrls(body.text);
    }

    if (urls.length === 0) {
      return reply.code(400).send({ error: 'Danh sách link Douyin/Bilibili trống hoặc không hợp lệ.' });
    }

    const job = createBatchJob(urls, { bilibiliQuality: body.bilibiliQuality === 16 ? 16 : 64 });
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
