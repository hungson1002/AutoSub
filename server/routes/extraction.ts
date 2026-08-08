import { readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AIProvider } from '../types';
import { recognizeImage, transcribe, ProviderError } from '../adapters';
import { ensureWorkdir, extractAudio, extractRoiFrames, workdir } from '../services/ffmpeg';
import { groupOcrResults, hasSignificantFrameChange, segmentsToCues } from '../services/subtitles';

type FieldMap = Record<string, { value?: string }>;
const safeFile = (name: string) => path.basename(name).replace(/[^\p{L}\p{N}._-]/gu, '_');

export async function extractionRoutes(app: FastifyInstance) {
  app.post('/api/extract/stt', async (request, reply) => {
    const fields: FieldMap = {};
    let fileBuffer: Buffer | undefined;
    let filename = 'input.mp4';
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname === 'file') {
          fileBuffer = await part.toBuffer();
          filename = part.filename || filename;
        } else {
          await part.toBuffer();
        }
      } else {
        fields[part.fieldname] = { value: String(part.value) };
      }
    }
    if (!fileBuffer) return reply.code(400).send({ error: 'Thiếu file audio/video.' });
    const provider = JSON.parse(fields.provider?.value || '{}') as AIProvider;
    const model = fields.model?.value || '';
    const language = fields.language?.value || 'Auto Detect';
    if (!provider.baseUrl || !model) return reply.code(400).send({ error: 'STT cần provider và model.' });
    await ensureWorkdir();
    const name = safeFile(filename);
    const input = path.join(workdir, 'uploads', `${Date.now()}-${name}`);
    await writeFile(input, fileBuffer);
    let audio = input;
    if (!/\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(name)) {
      audio = path.join(workdir, 'audio', `${Date.now()}-audio.wav`);
      try { await extractAudio(input, audio); } catch { return reply.code(500).send({ error: 'FFmpeg không thể tách audio từ file này.' }); }
    }
    try {
      let result: Awaited<ReturnType<typeof transcribe>> | undefined;
      let lastError: unknown;
      for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
        try { result = await transcribe(provider, model, await readFile(audio), path.basename(audio), language); } catch (error) { lastError = error; if (attempt === 2) throw error; }
      }
      if (!result) throw lastError instanceof Error ? lastError : new Error('STT retry exhausted');
      const cues = segmentsToCues(result.segments);
      if (!cues.length && result.text) cues.push({ id: `stt-1-${Date.now()}`, index: 1, startMs: 0, endMs: 3000, originalText: result.text, translatedText: '', voiceGroup: 'G1', enabled: true });
      return { cues, audioName: path.basename(audio) };
    } catch (error) {
      const message = error instanceof ProviderError ? error.message : 'STT provider không hỗ trợ hoặc request thất bại sau 3 lần thử.';
      return reply.code(error instanceof ProviderError ? error.status : 502).send({ error: message, detail: error instanceof ProviderError ? error.detail : undefined });
    }
  });

  app.post('/api/extract/ocr', async (request, reply) => {
    const fields: FieldMap = {};
    let fileBuffer: Buffer | undefined;
    let filename = 'input.mp4';
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname === 'file') {
          fileBuffer = await part.toBuffer();
          filename = part.filename || filename;
        } else {
          await part.toBuffer();
        }
      } else {
        fields[part.fieldname] = { value: String(part.value) };
      }
    }
    if (!fileBuffer) return reply.code(400).send({ error: 'Thiếu video.' });
    const provider = JSON.parse(fields.provider?.value || '{}') as AIProvider;
    const model = fields.model?.value || '';
    const roi = JSON.parse(fields.roi?.value || '{"x":0,"y":70,"w":100,"h":20}') as { x: number; y: number; w: number; h: number };
    const fps = Math.max(1, Math.min(4, Number(fields.samplingFps?.value || 2)));
    const filterWatermark = fields.filterWatermark?.value === 'true';
    if (!provider.baseUrl || !model) return reply.code(400).send({ error: 'OCR cần provider và model.' });
    await ensureWorkdir();
    const name = safeFile(filename);
    const input = path.join(workdir, 'uploads', `${Date.now()}-${name}`);
    await writeFile(input, fileBuffer);
    const frameDir = path.join(workdir, 'frames');
    const prefix = `ocr-${Date.now()}`;
    const pattern = path.join(frameDir, `${prefix}-%05d.jpg`);
    try {
      await extractRoiFrames(input, pattern, fps, roi);
      const frames = (await readdir(frameDir)).filter((file) => file.startsWith(prefix) && file.endsWith('.jpg')).sort();
      const results: Array<{ text: string; timestampMs: number }> = [];
      let previousFrame: Buffer | undefined;
      for (const [index, frame] of frames.entries()) {
        const framePath = path.join(frameDir, frame);
        const currentFrame = await readFile(framePath);
        const changed = hasSignificantFrameChange(previousFrame, currentFrame);
        previousFrame = currentFrame;
        if (!changed) continue;
        const text = await recognizeImage(provider, model, framePath, 'Read only the subtitle text inside this cropped frame. Return plain text only. If there is no subtitle, return an empty string.');
        if (text) results.push({ text, timestampMs: Math.round(index * 1000 / fps) });
      }
      return { cues: groupOcrResults(results, filterWatermark) };
    } catch (error) {
      const message = error instanceof ProviderError ? error.message : 'OCR pipeline thất bại. Kiểm tra FFmpeg, ROI và Vision provider.';
      return reply.code(error instanceof ProviderError ? error.status : 502).send({ error: message, detail: error instanceof ProviderError ? error.detail : undefined });
    } finally {
      const frames = await readdir(frameDir).catch(() => []);
      await Promise.all(frames.filter((file) => file.startsWith(prefix)).map((file) => unlink(path.join(frameDir, file)).catch(() => undefined)));
    }
  });
}
