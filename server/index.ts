import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { available, cleanupTemporaryFiles, ensureWorkdir, run, workdir } from './services/ffmpeg';
import { cleanupIncompleteUploads, MAX_UPLOAD_BYTES } from './services/uploads';
import { providerRoutes } from './routes/providers';
import { translationRoutes } from './routes/translate';
import { extractionRoutes } from './routes/extraction';
import { dubbingRoutes } from './routes/dubbing';
import { exportRoutes } from './routes/export';
import { uploadRoutes } from './routes/uploads';

// The multipart plugin enforces the actual per-file limit. Leave a small amount
// of room here for multipart headers and boundaries so a file exactly at 4 GiB
// is not rejected because of the request envelope.
const app = Fastify({ logger: { level: process.env.AUTOSUB_LOG_LEVEL || (process.env.AUTOSUB_DEBUG_UPLOADS === '1' ? 'info' : 'warn') }, bodyLimit: MAX_UPLOAD_BYTES + 8 * 1024 * 1024 });
await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });
await ensureWorkdir();
await cleanupIncompleteUploads();
app.get('/api/health', async () => ({ ok: true }));
app.get('/api/system', async () => {
  let demucs = false;
  try { await run('py', ['-3.12', '-m', 'demucs', '--help']); demucs = true; } catch { demucs = false; }
  return { ffmpeg: await available('ffmpeg'), ffprobe: await available('ffprobe'), demucs, workdir };
});
app.post('/api/system/cleanup', async () => cleanupTemporaryFiles());
const mediaDebug = process.env.AUTOSUB_DEBUG_UPLOADS === '1';
app.addHook('onRequest', async (request) => {
  if (!mediaDebug || !/^\/api\/(uploads|extract\/stt|extract\/ocr|export\/video)/.test(request.url)) return;
  request.log.info({ method: request.method, url: request.url, contentLength: request.headers['content-length'] || '', contentType: request.headers['content-type'] || '' }, 'Media request received');
});
app.addHook('onError', async (request, _reply, error) => {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_ERR_CTP_BODY_TOO_LARGE') request.log.warn({ method: request.method, url: request.url, contentLength: request.headers['content-length'] || '', contentType: request.headers['content-type'] || '', code }, '413 emitted by Fastify request layer');
});
await app.register(uploadRoutes);
await app.register(providerRoutes);
await app.register(translationRoutes);
await app.register(extractionRoutes);
await app.register(dubbingRoutes);
await app.register(exportRoutes);
app.setErrorHandler((error, _request, reply) => {
  app.log.warn(error instanceof Error ? error.message : String(error));
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (code === 'FST_REQ_FILE_TOO_LARGE' || code === 'FST_ERR_CTP_BODY_TOO_LARGE') return void reply.code(413).send({ error: 'File vượt quá giới hạn 4 GiB.' });
  return void reply.code(500).send({ error: 'Backend error. Kiểm tra terminal để biết chi tiết.' });
});
const port = Number(process.env.AUTOSUB_PORT || 8787);
await app.listen({ port, host: '127.0.0.1' });
console.log(`AutoSub backend listening on http://127.0.0.1:${port}`);
