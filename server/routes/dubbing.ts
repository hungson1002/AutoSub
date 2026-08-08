import type { FastifyInstance } from 'fastify';
import type { AIProvider } from '../types';
import { ProviderError, synthesize } from '../adapters';
import { resolveProviderType } from '../providers/base';
import {
  cancelDubbingJob,
  createDubbingJob,
  getDubbingJobStatus,
  getDubbingResult,
  initializeDubbingJobs,
  legacyTrackJob,
  openDubbingAudio,
  pauseDubbingJob,
  resumeDubbingJob,
  retryFailedDubbingJob,
  startDubbingJob,
  type DubbingCueInput,
} from '../services/dubbingJobs';

const errorPayload = (error: unknown, fallback: string) => ({
  error: error instanceof ProviderError ? error.message : error instanceof Error ? error.message : fallback,
  ...(error instanceof ProviderError && error.detail ? { detail: error.detail } : {}),
});

const idFrom = (request: { params: unknown }) => (request.params as { id?: string }).id || '';

async function sendRouteError(reply: { code: (status: number) => { type: (value: string) => { send: (value: unknown) => unknown } } }, error: unknown, fallback = 'Dubbing job request failed.') {
  const status = error instanceof ProviderError ? error.status : error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 400;
  return reply.code(status).type('application/json').send(errorPayload(error, fallback));
}

export async function dubbingRoutes(app: FastifyInstance) {
  await initializeDubbingJobs();

  app.post('/api/dubbing/test', async (request, reply) => {
    const body = request.body as { provider?: AIProvider; model?: string; voice?: string; speed?: number; text?: string };
    if (!body.provider?.baseUrl || !body.model) return reply.code(400).type('application/json').send({ error: 'Test voice needs a provider and model ID.' });
    if (!body.voice) return reply.code(400).type('application/json').send({ error: 'This TTS model requires a Voice ID.' });
    try {
      const audio = await synthesize(body.provider, body.model, body.voice, body.text || 'This is an AutoSub voice test.', { speed: body.speed || 1, format: 'wav' });
      reply.header('Content-Type', resolveProviderType(body.provider) === 'elevenlabs' ? 'audio/mpeg' : 'audio/wav');
      return reply.send(audio);
    } catch (error) {
      return reply.code(error instanceof ProviderError ? error.status : 502).type('application/json').send(errorPayload(error, 'Voice test failed.'));
    }
  });

  app.post('/api/dubbing/jobs', async (request, reply) => {
    try {
      const job = await createDubbingJob(request.body as Parameters<typeof createDubbingJob>[0]);
      return reply.code(201).send({ jobId: job.id, status: job.status, totalCues: job.totalCues });
    } catch (error) { return sendRouteError(reply, error, 'Could not create dubbing job.'); }
  });

  app.post('/api/dubbing/jobs/:id/start', async (request, reply) => {
    try { return reply.send(await startDubbingJob(idFrom(request))); }
    catch (error) { return sendRouteError(reply, error, 'Could not start dubbing job.'); }
  });

  app.get('/api/dubbing/jobs/:id/status', async (request, reply) => {
    try { return reply.send(await getDubbingJobStatus(idFrom(request))); }
    catch (error) { return sendRouteError(reply, error, 'Could not read dubbing job status.'); }
  });

  app.post('/api/dubbing/jobs/:id/pause', async (request, reply) => {
    try { return reply.send(await pauseDubbingJob(idFrom(request))); }
    catch (error) { return sendRouteError(reply, error, 'Could not pause dubbing job.'); }
  });

  app.post('/api/dubbing/jobs/:id/resume', async (request, reply) => {
    try { return reply.send(await resumeDubbingJob(idFrom(request))); }
    catch (error) { return sendRouteError(reply, error, 'Could not resume dubbing job.'); }
  });

  app.post('/api/dubbing/jobs/:id/cancel', async (request, reply) => {
    try { return reply.send(await cancelDubbingJob(idFrom(request))); }
    catch (error) { return sendRouteError(reply, error, 'Could not cancel dubbing job.'); }
  });

  app.post('/api/dubbing/jobs/:id/retry-failed', async (request, reply) => {
    try { return reply.send(await retryFailedDubbingJob(idFrom(request))); }
    catch (error) { return sendRouteError(reply, error, 'Could not retry failed cues.'); }
  });

  app.get('/api/dubbing/jobs/:id/result', async (request, reply) => {
    try {
      const result = await getDubbingResult(idFrom(request));
      return reply.send({ job: result.job, metadata: result.metadata, audioUrl: `/api/dubbing/jobs/${encodeURIComponent(result.job.id)}/result/audio` });
    } catch (error) { return sendRouteError(reply, error, 'Dubbing result is not ready.'); }
  });

  app.get('/api/dubbing/jobs/:id/result/audio', async (request, reply) => {
    try {
      const audio = await openDubbingAudio(idFrom(request));
      reply.header('Content-Type', 'audio/wav');
      reply.header('Content-Length', String(audio.size));
      reply.header('Content-Disposition', 'attachment; filename="autosub-dub-track.wav"');
      return reply.send(audio.stream);
    } catch (error) { return sendRouteError(reply, error, 'Dubbing audio is not ready.'); }
  });

  // Compatibility entry point. It now creates and starts a job, but never
  // blocks the request while TTS/FFmpeg processes the entire track.
  app.post('/api/dubbing/track', async (request, reply) => {
    try {
      const status = await legacyTrackJob(request.body as Parameters<typeof legacyTrackJob>[0]);
      return reply.code(202).send({ jobId: status.id, status });
    } catch (error) { return sendRouteError(reply, error, 'Could not create dubbing job.'); }
  });
}
