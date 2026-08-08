import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { available, ensureWorkdir, run, workdir } from './services/ffmpeg';
import { providerRoutes } from './routes/providers';
import { translationRoutes } from './routes/translate';
import { extractionRoutes } from './routes/extraction';
import { dubbingRoutes } from './routes/dubbing';
import { exportRoutes } from './routes/export';

const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 30 * 1024 * 1024 });
await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 4 * 1024 * 1024 * 1024 } });
await ensureWorkdir();
app.get('/api/health', async () => ({ ok: true }));
app.get('/api/system', async () => {
  let demucs = false;
  try {
    await run('py', ['-3.12', '-m', 'demucs', '--help']);
    demucs = true;
  } catch {
    demucs = false;
  }
  return { ffmpeg: await available('ffmpeg'), ffprobe: await available('ffprobe'), demucs, workdir };
});
await app.register(providerRoutes);
await app.register(translationRoutes);
await app.register(extractionRoutes);
await app.register(dubbingRoutes);
await app.register(exportRoutes);
app.setErrorHandler((error, _request, reply) => { app.log.warn(error instanceof Error ? error.message : String(error)); void reply.code(500).send({ error: 'Backend error. Kiểm tra terminal để biết chi tiết.' }); });
const port = Number(process.env.AUTOSUB_PORT || 8787);
await app.listen({ port, host: '127.0.0.1' });
console.log(`AutoSub backend listening on http://127.0.0.1:${port}`);
