import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import type { AIProvider } from '../types';
import { ProviderError, synthesize } from '../adapters';
import { resolveProviderType } from '../providers/base';
import { cachedTtsPreview } from '../services/ttsPreviewCache';
import { DUB_MASTERING_VERSION, masterDubBuffer } from '../services/audioMastering';
import {
  cancelDubbingJob,
  createDubbingJob,
  findLatestDubbingJobByVideoId,
  getDubbingJobStatus,
  getDubbingResult,
  initializeDubbingJobs,
  legacyTrackJob,
  openDubbingAudio,
  pauseDubbingJob,
  rebuildDubbingJobResult,
  resumeDubbingJob,
  regenerateDubbingCue,
  retryFailedDubbingJob,
  startDubbingJob,
  type DubbingCueInput,
} from '../services/dubbingJobs';

const errorPayload = (error: unknown, fallback: string) => ({
  error: error instanceof ProviderError ? error.message : error instanceof Error ? error.message : fallback,
  ...(error instanceof ProviderError && error.detail ? { detail: error.detail } : {}),
});

const idFrom = (request: { params: unknown }) => (request.params as { id?: string }).id || '';

async function sendRouteError(reply: { code: (status: number) => { type: (value: string) => { send: (value: unknown) => unknown } } }, error: unknown, fallback = 'Không thể xử lý yêu cầu dubbing.') {
  const status = error instanceof ProviderError ? error.status : error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 400;
  return reply.code(status).type('application/json').send(errorPayload(error, fallback));
}

export async function dubbingRoutes(app: FastifyInstance) {
  await initializeDubbingJobs();

  app.post('/api/dubbing/test', async (request, reply) => {
    const body = request.body as { provider?: AIProvider; model?: string; voice?: string; speed?: number; text?: string };
    if (!body.provider?.baseUrl || !body.model) return reply.code(400).type('application/json').send({ error: 'Test voice cần Provider và Model ID.' });
    if (!body.voice && resolveProviderType(body.provider) !== 'hiiu-tts') return reply.code(400).type('application/json').send({ error: 'Model TTS này yêu cầu Voice ID.' });
    try {
      const text = body.text?.trim() || 'This is an AutoSub voice test.';
      const speed = Math.round((Number(body.speed) || 1) * 100) / 100;
      const key = createHash('sha256').update(JSON.stringify({ masteringVersion: DUB_MASTERING_VERSION, providerId: body.provider.id, providerType: resolveProviderType(body.provider), baseUrl: body.provider.baseUrl, apiKey: body.provider.apiKey || '', model: body.model, voice: body.voice || '', speed, text })).digest('hex');
      const result = await cachedTtsPreview(key, async () => masterDubBuffer(await synthesize(body.provider!, body.model!, body.voice || '', text, { speed, format: 'wav' })));
      reply.header('Content-Type', 'audio/wav');
      reply.header('X-AutoSub-Preview-Cache', result.cache);
      return reply.send(result.audio);
    } catch (error) {
      return reply.code(error instanceof ProviderError ? error.status : 502).type('application/json').send(errorPayload(error, 'Không thể test voice.'));
    }
  });

  app.post('/api/dubbing/jobs', async (request, reply) => {
    try {
      const job = await createDubbingJob(request.body as Parameters<typeof createDubbingJob>[0]);
      return reply.code(201).send({ jobId: job.id, status: job.status, totalCues: job.totalCues });
    } catch (error) { return sendRouteError(reply, error, 'Không thể tạo dubbing job.'); }
  });

  app.get('/api/dubbing/jobs/latest-for-video', async (request, reply) => {
    const videoId = String((request.query as { videoId?: string }).videoId || '').trim();
    if (!videoId) return reply.code(400).send({ error: 'Thiếu uploadId của video cần khôi phục bản lồng tiếng.' });
    try { return reply.send({ job: await findLatestDubbingJobByVideoId(videoId) }); }
    catch (error) { return sendRouteError(reply, error, 'Không thể tìm bản lồng tiếng mới nhất của video.'); }
  });

  app.post('/api/dubbing/jobs/:id/start', async (request, reply) => {
    try { return reply.send(await startDubbingJob(idFrom(request))); }
    catch (error) { return sendRouteError(reply, error, 'Không thể bắt đầu dubbing job.'); }
  });

  app.get('/api/dubbing/jobs/:id/status', async (request, reply) => {
    try { return reply.send(await getDubbingJobStatus(idFrom(request))); }
    catch (error) { return sendRouteError(reply, error, 'Không thể đọc trạng thái dubbing job.'); }
  });

  app.post('/api/dubbing/jobs/:id/pause', async (request, reply) => {
    try { return reply.send(await pauseDubbingJob(idFrom(request))); }
    catch (error) { return sendRouteError(reply, error, 'Không thể tạm dừng dubbing job.'); }
  });

  app.post('/api/dubbing/jobs/:id/resume', async (request, reply) => {
    try { return reply.send(await resumeDubbingJob(idFrom(request))); }
    catch (error) { return sendRouteError(reply, error, 'Không thể tiếp tục dubbing job.'); }
  });

  app.post('/api/dubbing/jobs/:id/cancel', async (request, reply) => {
    try { return reply.send(await cancelDubbingJob(idFrom(request))); }
    catch (error) { return sendRouteError(reply, error, 'Không thể hủy dubbing job.'); }
  });

  app.post('/api/dubbing/jobs/:id/retry-failed', async (request, reply) => {
    const body = (request.body as { cues?: Parameters<typeof retryFailedDubbingJob>[1] } | undefined) || {};
    try { return reply.send(await retryFailedDubbingJob(idFrom(request), Array.isArray(body.cues) ? body.cues : [])); }
    catch (error) { return sendRouteError(reply, error, 'Không thể chạy lại các cue lỗi.'); }
  });

  app.post('/api/dubbing/jobs/:id/rebuild', async (request, reply) => {
    try { return reply.send(await rebuildDubbingJobResult(idFrom(request))); }
    catch (error) { return sendRouteError(reply, error, 'KhĂ´ng thá»ƒ dá»±ng láº¡i dub track tá»« cache.'); }
  });

  app.post('/api/dubbing/jobs/:id/cues/:cueId/regenerate', async (request, reply) => {
    const cueId = String((request.params as { cueId?: string }).cueId || '');
    try { return reply.send(await regenerateDubbingCue(idFrom(request), cueId, request.body as Parameters<typeof regenerateDubbingCue>[2])); }
    catch (error) { return sendRouteError(reply, error, 'Không thể tạo lại voice cho cue này.'); }
  });

  app.get('/api/dubbing/jobs/:id/result', async (request, reply) => {
    try {
      const result = await getDubbingResult(idFrom(request));
      return reply.send({ job: result.job, metadata: result.metadata, audioUrl: `/api/dubbing/jobs/${encodeURIComponent(result.job.id)}/result/audio` });
    } catch (error) { return sendRouteError(reply, error, 'Bản kết quả dubbing chưa sẵn sàng.'); }
  });

  app.get('/api/dubbing/jobs/:id/result/audio', async (request, reply) => {
    try {
      const rangeHeader = request.headers.range;
      let range: { start: number; end: number } | undefined;
      if (rangeHeader) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
        if (!match) return reply.code(416).header('Content-Range', 'bytes */0').send();
        const start = match[1] ? Number(match[1]) : undefined;
        const requestedEnd = match[2] ? Number(match[2]) : undefined;
        const result = await getDubbingResult(idFrom(request));
        const total = (await stat(result.audioFile)).size;
        const actualStart = start ?? Math.max(0, total - (requestedEnd || 0));
        const actualEnd = Math.min(total - 1, requestedEnd ?? total - 1);
        if (!Number.isFinite(actualStart) || !Number.isFinite(actualEnd) || actualStart < 0 || actualStart > actualEnd || actualStart >= total) return reply.code(416).header('Content-Range', `bytes */${total}`).send();
        range = { start: actualStart, end: actualEnd };
      }
      const audio = await openDubbingAudio(idFrom(request), range);
      reply.code(range ? 206 : 200);
      reply.header('Content-Type', 'audio/wav');
      reply.header('Content-Length', String(audio.size));
      reply.header('Accept-Ranges', 'bytes');
      if (range) reply.header('Content-Range', `bytes ${audio.start}-${audio.end}/${audio.totalSize}`);
      reply.header('Content-Disposition', 'attachment; filename="autosub-dub-track.wav"');
      return reply.send(audio.stream);
    } catch (error) { return sendRouteError(reply, error, 'Audio dubbing chưa sẵn sàng.'); }
  });

  // Compatibility entry point. It now creates and starts a job, but never
  // blocks the request while TTS/FFmpeg processes the entire track.
  app.post('/api/dubbing/track', async (request, reply) => {
    try {
      const status = await legacyTrackJob(request.body as Parameters<typeof legacyTrackJob>[0]);
      return reply.code(202).send({ jobId: status.id, status });
    } catch (error) { return sendRouteError(reply, error, 'Không thể tạo dubbing job.'); }
  });
}
