import { createReadStream } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { CreateReviewJobInput } from '../services/reviewJobs';
import { cancelReviewJob, createReviewJob, getReviewJob, getReviewResult } from '../services/reviewJobs';
import { beginYouTubeConnection, disconnectYouTube, finishYouTubeConnection, markReviewYouTubeDecision, refreshReviewYouTubeStatus, startReviewYouTubeUpload, youtubeConnectionStatus } from '../services/youtubeReview';

const errorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;

function sendRouteError(reply: { code: (status: number) => { send: (value: unknown) => unknown } }, error: unknown, fallback: string, status = 400) {
  return reply.code(status).send({ error: errorMessage(error, fallback) });
}

export async function reviewRoutes(app: FastifyInstance) {
  app.post('/api/review/jobs', async (request, reply) => {
    try {
      const job = await createReviewJob(request.body as CreateReviewJobInput);
      return reply.code(202).send(job);
    } catch (error) {
      return sendRouteError(reply, error, 'Không thể tạo review job.');
    }
  });

  app.get('/api/review/jobs/:id', async (request, reply) => {
    try {
      return await getReviewJob(String((request.params as { id?: string }).id || ''));
    } catch (error) {
      return sendRouteError(reply, error, 'Không tìm thấy review job.', 404);
    }
  });

  app.post('/api/review/jobs/:id/cancel', async (request, reply) => {
    try {
      return await cancelReviewJob(String((request.params as { id?: string }).id || ''));
    } catch (error) {
      return sendRouteError(reply, error, 'Không thể hủy review job.');
    }
  });

  app.get('/api/review/jobs/:id/video', async (request, reply) => {
    try {
      const result = await getReviewResult(String((request.params as { id?: string }).id || ''));
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
      reply.header('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="autosub-review.mp4"`);
      return reply.send(createReadStream(result.path, { start, end }));
    } catch (error) {
      return sendRouteError(reply, error, 'Video review chưa sẵn sàng.', 404);
    }
  });

  app.get('/api/review/youtube/status', async (_request, reply) => {
    try { return await youtubeConnectionStatus(); }
    catch (error) { return sendRouteError(reply, error, 'Không thể kiểm tra kết nối YouTube.', 500); }
  });

  app.post('/api/review/youtube/connect', async (request, reply) => {
    try {
      const body = request.body as { clientId?: string; clientSecret?: string } | undefined;
      const port = Number(process.env.AUTOSUB_PORT || 8787);
      const redirectUri = `http://127.0.0.1:${port}/api/review/youtube/oauth/callback`;
      return { authUrl: beginYouTubeConnection(String(body?.clientId || ''), String(body?.clientSecret || ''), redirectUri) };
    } catch (error) {
      return sendRouteError(reply, error, 'Không thể bắt đầu kết nối YouTube.');
    }
  });

  app.get('/api/review/youtube/oauth/callback', async (request, reply) => {
    const query = request.query as { code?: string; state?: string; error?: string };
    try {
      if (query.error) throw new Error(`Google OAuth: ${query.error}`);
      if (!query.code || !query.state) throw new Error('Google OAuth callback thiếu code/state.');
      await finishYouTubeConnection(query.code, query.state);
      return reply.type('text/html; charset=utf-8').send('<!doctype html><html lang="vi"><meta charset="utf-8"><title>AutoSub</title><body style="font-family:system-ui;background:#10151d;color:#edf1f6;padding:40px"><h2>Đã kết nối YouTube</h2><p>Bạn có thể đóng cửa sổ này và quay lại AutoSub.</p><script>setTimeout(()=>window.close(),1200)</script></body></html>');
    } catch (error) {
      return reply.code(400).type('text/html; charset=utf-8').send(`<!doctype html><html lang="vi"><meta charset="utf-8"><title>AutoSub</title><body style="font-family:system-ui;background:#10151d;color:#edf1f6;padding:40px"><h2>Kết nối thất bại</h2><p>${escapeHtml(errorMessage(error, 'OAuth lỗi.'))}</p></body></html>`);
    }
  });

  app.delete('/api/review/youtube/connection', async (_request, reply) => {
    await disconnectYouTube();
    return reply.code(204).send();
  });

  app.post('/api/review/jobs/:id/youtube-upload', async (request, reply) => {
    try { return reply.code(202).send(await startReviewYouTubeUpload(String((request.params as { id?: string }).id || ''))); }
    catch (error) { return sendRouteError(reply, error, 'Không thể tải video riêng tư lên YouTube.'); }
  });

  app.post('/api/review/jobs/:id/youtube-refresh', async (request, reply) => {
    try { return await refreshReviewYouTubeStatus(String((request.params as { id?: string }).id || '')); }
    catch (error) { return sendRouteError(reply, error, 'Không thể làm mới trạng thái YouTube.'); }
  });

  app.post('/api/review/jobs/:id/youtube-decision', async (request, reply) => {
    try {
      const decision = (request.body as { decision?: string } | undefined)?.decision;
      if (decision !== 'passed' && decision !== 'claimed') return reply.code(400).send({ error: 'Kết quả xác nhận không hợp lệ.' });
      return await markReviewYouTubeDecision(String((request.params as { id?: string }).id || ''), decision);
    } catch (error) {
      return sendRouteError(reply, error, 'Không thể lưu kết quả kiểm tra YouTube.');
    }
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character] || character);
}
