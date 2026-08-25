import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AIProvider } from '../types';
import { recognizeImage, transcribe, ProviderError } from '../adapters';
import { ensureWorkdir, extractAudio, extractRoiFrames, run } from '../services/ffmpeg';
import { resolveProviderType } from '../providers/base';
import { cleanupUploadSession, createTemporarySession, resolveUpload, UploadReferenceError } from '../services/uploads';
import { groupOcrResults, hasSignificantFrameChange, offsetSubtitleSegments, segmentsToCues } from '../services/subtitles';
import { alignTranscriptToAudio } from '../services/textAudioAlignment';

type ExtractionBody = {
  uploadId?: string;
  progressId?: string;
  provider?: AIProvider;
  model?: string;
  language?: string;
  roi?: { x: number; y: number; w: number; h: number };
  samplingFps?: number;
  filterWatermark?: boolean;
};

type ExtractionProgress = {
  percent: number;
  stage: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  processed?: number;
  total?: number;
  error?: string;
};

const bodyOf = (request: { body: unknown }) => (request.body && typeof request.body === 'object' ? request.body as ExtractionBody : {});
const routeError = (error: unknown, fallback: string) => ({ error: error instanceof ProviderError ? error.message : error instanceof Error ? error.message : fallback, ...(error instanceof ProviderError && error.detail ? { detail: error.detail } : {}) });
export const GROQ_DIRECT_AUDIO_LIMIT_BYTES = 25 * 1024 * 1024;
export const GROQ_CHUNK_SECONDS = 600;
const mediaDebug = process.env.AUTOSUB_DEBUG_UPLOADS === '1';
const debugMedia = (scope: string, details: Record<string, unknown>) => { if (mediaDebug) console.info(`[${scope}] ${JSON.stringify(details)}`); };
const extractionProgress = new Map<string, ExtractionProgress>();
const boundedConcurrency = (value: unknown, fallback: number, maximum = 8) => {
  const configured = Number(value);
  return Math.max(1, Math.min(maximum, Number.isFinite(configured) ? Math.round(configured) : fallback));
};

export async function mapWithConcurrency<T, R>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(items.length, Math.max(1, concurrency)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
const reportExtractionProgress = (progressId: string | undefined, patch: Partial<ExtractionProgress>) => {
  if (!progressId) return;
  extractionProgress.set(progressId, { percent: 0, stage: 'Đang khởi tạo', status: 'running', ...extractionProgress.get(progressId), ...patch });
};
const forgetExtractionProgress = (progressId: string | undefined) => {
  if (!progressId) return;
  const timer = setTimeout(() => extractionProgress.delete(progressId), 10 * 60 * 1000);
  timer.unref?.();
};
const segmentDebug = (segments: Array<{ text?: string; start?: number; end?: number }>) => segments.slice(0, 5).map((segment) => ({ text: segment.text, start: segment.start, end: segment.end, startMs: typeof segment.start === 'number' ? Math.round(segment.start * 1000) : undefined, endMs: typeof segment.end === 'number' ? Math.round(segment.end * 1000) : undefined }));
const cueDebug = (cues: Array<{ startMs: number; endMs: number; originalText?: string }>) => cues.slice(0, 5).map((cue) => ({ text: cue.originalText, startMs: cue.startMs, endMs: cue.endMs }));

export function buildOcrPrompt(language = 'Auto Detect') {
  const languageHint = /^(?:auto(?:matic)?(?:[\s_-]*detect)?)$/i.test(language.trim())
    ? 'Detect the source language only to identify its original script.'
    : `The expected source language is ${language}.`;
  return `Transcribe verbatim only the subtitle text visible in this video frame. ${languageHint} Preserve the exact original language and script. Never translate, romanize, summarize, correct, or explain the text. Ignore logos, watermarks, scene text and UI text. Return plain subtitle text only; if there is no subtitle, return an empty string.`;
}

async function transcribeGroqAudio(provider: AIProvider, model: string, audio: string, language: string, signal?: AbortSignal, onProgress?: (percent: number) => void) {
  const audioSize = (await stat(audio)).size;
  debugMedia('stt', { audioPath: audio, audioSize, provider: provider.name, providerType: resolveProviderType(provider) });
  if (audioSize <= GROQ_DIRECT_AUDIO_LIMIT_BYTES) return transcribe(provider, model, audio, path.basename(audio), language, signal);

  const chunkDir = await createTemporarySession('stt-chunks-');
  try {
    const pattern = path.join(chunkDir, 'chunk-%03d.wav');
    await run('ffmpeg', ['-y', '-i', audio, '-map', '0:a:0', '-f', 'segment', '-segment_time', String(GROQ_CHUNK_SECONDS), '-reset_timestamps', '1', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', pattern], signal);
    const chunks = (await readdir(chunkDir)).filter((file) => /^chunk-\d+\.wav$/i.test(file)).sort();
    if (!chunks.length) throw new Error('FFmpeg không tạo được audio chunk cho Groq STT.');

    const processed = await mapWithConcurrency(
      chunks,
      boundedConcurrency(process.env.AUTOSUB_GROQ_STT_CONCURRENCY, 2, 4),
      async (chunk, index) => {
        const chunkPath = path.join(chunkDir, chunk);
        const chunkSize = (await stat(chunkPath)).size;
        debugMedia('stt', { audioPath: chunkPath, audioSize: chunkSize, provider: provider.name, chunk, chunkCount: chunks.length });
        const result = await transcribe(provider, model, chunkPath, chunk, language, signal);
        const offsetSeconds = index * GROQ_CHUNK_SECONDS;
        const offsetSegments = offsetSubtitleSegments(result.segments, offsetSeconds);
        debugMedia('CHUNK MERGE', { chunk, offsetMs: Math.round(offsetSeconds * 1000), local: segmentDebug(result.segments), global: segmentDebug(offsetSegments) });
        onProgress?.(((index + 1) / chunks.length) * 100);
        return { text: result.text.trim(), segments: offsetSegments };
      },
    );
    const texts = processed.map((item) => item.text).filter(Boolean);
    const segments = processed.flatMap((item) => item.segments);
    return { text: texts.join('\n'), segments };
  } finally {
    await cleanupUploadSession(chunkDir);
  }
}

export async function extractionRoutes(app: FastifyInstance) {
  app.get<{ Params: { progressId: string } }>('/api/extract/progress/:progressId', async (request) => extractionProgress.get(request.params.progressId) || { percent: 0, stage: 'Tác vụ không còn chạy', status: 'failed', error: 'Kết nối xử lý đã bị ngắt. Hãy chạy lại tác vụ.' });

  app.post('/api/extract/stt', async (request, reply) => {
    await ensureWorkdir();
    let temporaryDir: string | undefined;
    let progressId: string | undefined;
    const controller = new AbortController();
    const abortDisconnectedRequest = () => {
      if (!reply.raw.writableEnded && !controller.signal.aborted) controller.abort();
    };
    request.raw.once('aborted', abortDisconnectedRequest);
    reply.raw.once('close', abortDisconnectedRequest);
    try {
      const body = bodyOf(request);
      progressId = body.progressId;
      reportExtractionProgress(progressId, { percent: 3, stage: 'Đang kiểm tra file nguồn', status: 'running' });
      debugMedia('extraction', { method: request.method, url: request.url, contentLength: request.headers['content-length'] || '', contentType: request.headers['content-type'] || '', uploadId: body.uploadId || '' });
      if (!body.uploadId) return reply.code(400).send({ error: 'Thiếu uploadId. Hãy upload video một lần trước.' });
      if (!body.provider?.baseUrl || !body.model) return reply.code(400).send({ error: 'STT cần provider và model.' });
      const upload = await resolveUpload(body.uploadId);
      debugMedia('upload', { uploadId: upload.uploadId, storedPath: upload.storedPath, fileSize: upload.size });
      let audio = upload.absolutePath;
      if (!/\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(upload.filename)) {
        temporaryDir = await createTemporarySession('stt-audio-');
        audio = path.join(temporaryDir, 'extracted-audio.wav');
        reportExtractionProgress(progressId, { percent: 8, stage: 'FFmpeg đang tách audio' });
        await extractAudio(upload.absolutePath, audio, controller.signal);
      }
      reportExtractionProgress(progressId, { percent: 15, stage: 'Đang chờ STT provider' });
      const onSttProgress = (percent: number) => reportExtractionProgress(progressId, {
        percent: Math.round(18 + (Math.max(0, Math.min(100, percent)) * 0.67)),
        stage: `Whisper Local đang nhận dạng · ${Math.round(percent)}%`,
      });
      const result = resolveProviderType(body.provider) === 'groq'
        ? await transcribeGroqAudio(body.provider, body.model, audio, body.language || 'Auto Detect', controller.signal, onSttProgress)
        : await transcribe(body.provider, body.model, audio, path.basename(audio), body.language || 'Auto Detect', controller.signal, onSttProgress);
      reportExtractionProgress(progressId, { percent: 88, stage: 'Đã nhận dạng xong · đang căn thời gian phụ đề' });
      let providerCues = segmentsToCues(result.segments);
      debugMedia('PROVIDER SEGMENTS', { cues: cueDebug(providerCues), wordTimestampCueCount: providerCues.filter((cue) => Array.isArray(cue.words) && cue.words.length > 0).length });
      debugMedia('STT PROVIDER CUES', { cues: cueDebug(providerCues) });
      if (!providerCues.length && result.text) {
        debugMedia('STT timestamp fallback activated', { reason: 'provider returned no segments', textLength: result.text.length });
        providerCues = [{ id: `stt-1-${Date.now()}`, index: 1, startMs: 0, endMs: 3000, originalText: result.text, translatedText: '', voiceGroup: 'G1', enabled: true }];
      }
      const alignment = await alignTranscriptToAudio({ audioPath: audio, cues: providerCues, language: body.language || 'Auto Detect' });
      debugMedia('ALIGNMENT', { entries: alignment.entries.slice(0, 5), method: alignment.metadata.alignmentMethod, confidence: alignment.metadata.alignmentConfidence, timestampSource: alignment.metadata.timestampSource });
      debugMedia('FINAL CUES', { cues: cueDebug(alignment.cues), refinedCount: alignment.metadata.refinedCount, fallbackCount: alignment.metadata.fallbackCount, analysisMs: alignment.metadata.analysisMs });
      debugMedia('API RESPONSE', { uploadId: upload.uploadId, cueCount: alignment.cues.length, cues: cueDebug(alignment.cues) });
      reportExtractionProgress(progressId, { percent: 100, stage: `Hoàn tất · ${alignment.cues.length} câu`, status: 'completed' });
      return { cues: alignment.cues, audioName: path.basename(audio), uploadId: upload.uploadId, timestampRefinement: alignment.metadata, textAudioAlignment: { entries: alignment.entries, metadata: alignment.metadata } };
    } catch (error) {
      const message = error instanceof ProviderError ? error.message : error instanceof Error ? error.message : 'STT provider không hỗ trợ hoặc request thất bại.';
      reportExtractionProgress(progressId, { status: controller.signal.aborted ? 'cancelled' : 'failed', stage: controller.signal.aborted ? 'Đã hủy nhận dạng' : 'Nhận dạng thất bại', error: message });
      return reply.code(error instanceof ProviderError ? error.status : error instanceof UploadReferenceError ? error.statusCode : 502).send(routeError(error, message));
    } finally {
      request.raw.removeListener('aborted', abortDisconnectedRequest);
      reply.raw.removeListener('close', abortDisconnectedRequest);
      if (temporaryDir) await cleanupUploadSession(temporaryDir);
      forgetExtractionProgress(progressId);
    }
  });

  app.post('/api/extract/ocr', async (request, reply) => {
    await ensureWorkdir();
    const frameDir = await createTemporarySession('ocr-');
    let prefix = '';
    let progressId: string | undefined;
    try {
      const body = bodyOf(request);
      progressId = body.progressId;
      debugMedia('extraction', { method: request.method, url: request.url, contentLength: request.headers['content-length'] || '', contentType: request.headers['content-type'] || '', uploadId: body.uploadId || '', progressId: progressId || '' });
      reportExtractionProgress(progressId, { percent: 3, stage: 'Đang kiểm tra file upload' });
      if (!body.uploadId) return reply.code(400).send({ error: 'Thiếu uploadId. Hãy upload video một lần trước.' });
      if (!body.provider?.baseUrl || !body.model) return reply.code(400).send({ error: 'OCR cần provider và model.' });
      const upload = await resolveUpload(body.uploadId);
      debugMedia('upload', { uploadId: upload.uploadId, storedPath: upload.storedPath, fileSize: upload.size });
      reportExtractionProgress(progressId, { percent: 8, stage: `Đã tìm thấy video · ${(upload.size / 1024 / 1024).toFixed(1)} MB` });
      const roi = body.roi || { x: 0, y: 75, w: 100, h: 25 };
      const fps = Math.max(1, Math.min(4, Number(body.samplingFps || 2)));
      prefix = `ocr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      reportExtractionProgress(progressId, { percent: 12, stage: `FFmpeg đang tách frame · ${fps} FPS` });
      await extractRoiFrames(upload.absolutePath, path.join(frameDir, `${prefix}-%05d.jpg`), fps, roi);
      const frames = (await readdir(frameDir)).filter((file) => file.startsWith(prefix) && file.endsWith('.jpg')).sort();
      reportExtractionProgress(progressId, { percent: 25, stage: `Đã tách ${frames.length} frame · bắt đầu lọc thay đổi`, processed: 0, total: frames.length });
      const changedFrames: Array<{ framePath: string; frameIndex: number }> = [];
      let previousFrame: Buffer | undefined;
      for (const [index, frame] of frames.entries()) {
        reportExtractionProgress(progressId, { percent: frames.length ? 25 + ((index / frames.length) * 18) : 43, stage: `Đang lọc frame ${index + 1}/${frames.length} · Frame change`, processed: index, total: frames.length });
        const framePath = path.join(frameDir, frame);
        const currentFrame = await readFile(framePath);
        const changed = hasSignificantFrameChange(previousFrame, currentFrame);
        previousFrame = currentFrame;
        if (!changed) continue;
        changedFrames.push({ framePath, frameIndex: index });
      }
      let recognized = 0;
      const results = (await mapWithConcurrency(
        changedFrames,
        boundedConcurrency(process.env.AUTOSUB_OCR_CONCURRENCY, 4),
        async ({ framePath, frameIndex }) => {
          const text = await recognizeImage(body.provider!, body.model!, framePath, buildOcrPrompt(body.language));
          recognized += 1;
          reportExtractionProgress(progressId, { percent: changedFrames.length ? 45 + ((recognized / changedFrames.length) * 48) : 93, stage: `Vision provider · ${recognized}/${changedFrames.length} frame thay đổi`, processed: recognized, total: changedFrames.length });
          return text ? { text, timestampMs: Math.round(frameIndex * 1000 / fps) } : undefined;
        },
      )).filter((item): item is { text: string; timestampMs: number } => Boolean(item));
      reportExtractionProgress(progressId, { percent: 96, stage: `Đang nhóm ${results.length} kết quả thành SubtitleCue[]`, processed: frames.length, total: frames.length });
      const cues = groupOcrResults(results, Boolean(body.filterWatermark));
      reportExtractionProgress(progressId, { percent: 100, stage: `OCR hoàn tất · ${cues.length} cue`, status: 'completed', processed: frames.length, total: frames.length });
      return { cues, uploadId: upload.uploadId };
    } catch (error) {
      reportExtractionProgress(progressId, { status: 'failed', stage: 'OCR thất bại', error: error instanceof Error ? error.message : 'OCR pipeline thất bại.' });
      const message = error instanceof ProviderError ? error.message : 'OCR pipeline thất bại. Kiểm tra FFmpeg, ROI và Vision provider.';
      return reply.code(error instanceof ProviderError ? error.status : error instanceof UploadReferenceError ? error.statusCode : 502).send(routeError(error, message));
    } finally {
      await cleanupUploadSession(frameDir);
      forgetExtractionProgress(progressId);
    }
  });
}
