import { randomUUID } from 'node:crypto';
import { mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { ProviderError } from '../adapters/errors';
import {
  createVoiceCloneProfile,
  deleteVoiceCloneProfile,
  listVoiceCloneProfiles,
  MAX_VOICE_REFERENCE_BYTES,
  voiceProfileToVoice,
} from '../services/voiceClones';
import { workdir } from '../services/ffmpeg';

const UPLOAD_ROOT = path.join(workdir, 'vieneu', 'reference-uploads');

const isLocalOrigin = (origin?: string) => {
  if (!origin) return true;
  try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname); }
  catch { return false; }
};

async function storeReference(stream: NodeJS.ReadableStream, destination: string) {
  const handle = await open(destination, 'wx');
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_VOICE_REFERENCE_BYTES) throw new ProviderError('File mẫu giọng tối đa 25 MB.', 413);
      await handle.write(buffer);
    }
  } finally {
    await handle.close();
  }
  return bytes;
}

function routeError(reply: { code: (status: number) => { send: (value: unknown) => unknown } }, error: unknown) {
  const status = error instanceof ProviderError ? error.status : 500;
  return reply.code(status).send({
    error: error instanceof ProviderError ? error.message : 'Không thể quản lý giọng clone.',
    ...(error instanceof ProviderError && error.detail ? { detail: error.detail } : {}),
  });
}

export async function voiceCloneRoutes(app: FastifyInstance) {
  app.get('/api/voice-clones/vieneu', async (_request, reply) => {
    try {
      const profiles = await listVoiceCloneProfiles();
      return reply.send({ profiles, voices: profiles.map(voiceProfileToVoice) });
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.post('/api/voice-clones/vieneu', async (request, reply) => {
    if (!isLocalOrigin(request.headers.origin)) return reply.code(403).send({ error: 'Chỉ AutoSub trên máy này được phép tạo giọng clone.' });
    await mkdir(UPLOAD_ROOT, { recursive: true });
    const temporary = path.join(UPLOAD_ROOT, `${randomUUID()}.upload`);
    let name = '';
    let consent = false;
    let sourceName = 'voice-reference';
    let stored = false;
    try {
      for await (const part of request.parts()) {
        if (part.type === 'field') {
          if (part.fieldname === 'name') name = String(part.value || '');
          if (part.fieldname === 'consent') consent = String(part.value || '').toLowerCase() === 'true';
          continue;
        }
        if (part.fieldname !== 'file' || stored) {
          part.file.resume();
          continue;
        }
        sourceName = part.filename || sourceName;
        await storeReference(part.file, temporary);
        stored = true;
      }
      if (!stored) throw new ProviderError('Hãy chọn file mẫu giọng 3–8 giây.', 400);
      const profile = await createVoiceCloneProfile({ name, sourcePath: temporary, sourceName, authorized: consent });
      return reply.code(201).send({ profile, voice: voiceProfileToVoice(profile) });
    } catch (error) {
      return routeError(reply, error);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  });

  app.delete('/api/voice-clones/vieneu/:id', async (request, reply) => {
    if (!isLocalOrigin(request.headers.origin)) return reply.code(403).send({ error: 'Chỉ AutoSub trên máy này được phép xóa giọng clone.' });
    try {
      const id = String((request.params as { id?: string }).id || '');
      await deleteVoiceCloneProfile(id);
      return reply.code(204).send();
    } catch (error) {
      return routeError(reply, error);
    }
  });
}
