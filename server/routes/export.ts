import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { run, ensureWorkdir, workdir } from '../services/ffmpeg';
import { getDubbingResult } from '../services/dubbingJobs';
import { buildExportAudioFilter } from '../services/exportAudio';
import { cleanupUploadSession, createUploadSession, discardUploadStream, persistUploadStream, resolveUpload, safeUploadName, UploadTooLargeError } from '../services/uploads';

type Fields = Record<string, string>;
type Region = { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number; startMs: number; endMs: number; blurStrength: number; borderRadius?: number; mode?: 'blur' | 'neighbor' };
type Logo = { xPercent: number; yPercent: number; widthPercent: number; opacity: number };
type CropRegion = { xPercent: number; yPercent: number; widthPercent: number; heightPercent: number };
type VideoEdit = { aspectRatio?: 'original' | '16:9' | '9:16' | '1:1' | '4:5'; trimStartMs?: number; trimEndMs?: number; crop?: CropRegion };
type ExportProgress = { percent: number; stage: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; error?: string; updatedAt: number };

const exportProgress = new Map<string, ExportProgress>();
const setExportProgress = (id: string | undefined, patch: Partial<ExportProgress>) => {
  if (!id) return;
  const current = exportProgress.get(id) || { percent: 1, stage: 'Đang nhận video', status: 'running' as const, updatedAt: Date.now() };
  exportProgress.set(id, { ...current, ...patch, updatedAt: Date.now() });
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const uploadError = (error: unknown) => error instanceof UploadTooLargeError || (error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE');
const ffmpegPath = (file: string) => file.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
const outputSize = (resolution: string, aspectRatio?: VideoEdit['aspectRatio']) => {
  const shortEdge = resolution === '1440' ? 1440 : resolution === '1080' ? 1080 : resolution === '720' ? 720 : undefined;
  if (!shortEdge) return undefined;
  if (aspectRatio === '9:16') return `${shortEdge}x${Math.round(shortEdge * 16 / 9)}`;
  if (aspectRatio === '1:1') return `${shortEdge}x${shortEdge}`;
  if (aspectRatio === '4:5') return `${shortEdge}x${Math.round(shortEdge * 5 / 4)}`;
  return `${Math.round(shortEdge * 16 / 9)}x${shortEdge}`;
};

export async function exportRoutes(app: FastifyInstance) {
  app.get('/api/export/progress/:id', async (request, reply) => {
    const id = String((request.params as { id?: string }).id || '');
    return reply.send(exportProgress.get(id) || { percent: 1, stage: 'Đang tải video lên máy', status: 'running' });
  });

  app.post('/api/export/video', async (request, reply) => {
    await ensureWorkdir();
    const uploadDir = await createUploadSession();
    const fields: Fields = {};
    let input: string | undefined;
    let dubFile: string | undefined;
    let fontFile: string | undefined;
    let logoFile: string | undefined;
    let videoName = 'input.mp4';
    let fontName = 'uploaded-font.ttf';
    let logoName = 'logo.png';

    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (part.fieldname === 'file') {
            videoName = safeUploadName(part.filename || videoName);
            input = (await persistUploadStream(part.file, path.join(uploadDir, `source-${videoName}`))).path;
          } else if (part.fieldname === 'dubTrack') {
            dubFile = (await persistUploadStream(part.file, path.join(uploadDir, 'dub-track.wav'))).path;
          } else if (part.fieldname === 'fontFile') {
            fontName = safeUploadName(part.filename || fontName);
            fontFile = (await persistUploadStream(part.file, path.join(uploadDir, `font-${fontName}`))).path;
          } else if (part.fieldname === 'logoFile') {
            logoName = safeUploadName(part.filename || logoName);
            logoFile = (await persistUploadStream(part.file, path.join(uploadDir, `logo-${logoName}`))).path;
          } else await discardUploadStream(part.file);
        } else {
          fields[part.fieldname] = String(part.value);
          if (part.fieldname === 'exportId') setExportProgress(fields.exportId, { percent: 3, stage: 'Đã nhận yêu cầu render', status: 'running' });
        }
      }
    } catch (error) {
      await cleanupUploadSession(uploadDir);
      if (uploadError(error)) return reply.code(413).send({ error: 'File vượt quá giới hạn 4 GiB.' });
      throw error;
    }

    if (!input && fields.uploadId) {
      try { input = (await resolveUpload(fields.uploadId)).absolutePath; }
      catch { await cleanupUploadSession(uploadDir); return reply.code(400).send({ error: 'Upload video không còn tồn tại. Hãy chọn lại video.' }); }
    }
    if (!input) { await cleanupUploadSession(uploadDir); return reply.code(400).send({ error: 'Thiếu video để xuất.' }); }

    let options: { resolution: 'original' | '1440' | '1080' | '720'; crf?: number; keepAudio: boolean; originalVolume?: number; burnSubtitles?: boolean; separateVocals?: boolean; blurRegions?: Region[]; logo?: Logo; dubbingJobId?: string; videoEdit?: VideoEdit };
    try {
      options = JSON.parse(fields.options || '{"resolution":"original","crf":20,"keepAudio":true,"blurRegions":[]}');
    } catch {
      await cleanupUploadSession(uploadDir);
      return reply.code(400).send({ error: 'Tùy chọn export không hợp lệ.' });
    }

    const ass = fields.ass;
    if (options.burnSubtitles !== false && !ass) { await cleanupUploadSession(uploadDir); return reply.code(400).send({ error: 'Thiếu ASS subtitle.' }); }
    const exportId = fields.exportId;
    const trimStartMs = Math.max(0, Number(options.videoEdit?.trimStartMs) || 0);
    const trimEndMs = Number(options.videoEdit?.trimEndMs) || undefined;
    if (trimEndMs !== undefined && trimEndMs <= trimStartMs) { await cleanupUploadSession(uploadDir); return reply.code(400).send({ error: 'Điểm kết thúc phải nằm sau điểm bắt đầu.' }); }
    const trimStartSeconds = trimStartMs / 1000;
    const trimDurationSeconds = trimEndMs === undefined ? undefined : (trimEndMs - trimStartMs) / 1000;
    setExportProgress(exportId, { percent: 6, stage: 'Đang chuẩn bị media', status: 'running' });
    let jobDubPath: string | undefined;
    let jobDubIncludesBackground = false;
    if (options.dubbingJobId) {
      try {
        const result = await getDubbingResult(options.dubbingJobId);
        jobDubPath = result.audioFile;
        jobDubIncludesBackground = Boolean(result.job.config.audioMix.keepOriginal && result.job.config.audioMix.separateVocals);
      }
      catch (error) { await cleanupUploadSession(uploadDir); return reply.code(400).send({ error: error instanceof Error ? error.message : 'Dub job chưa hoàn tất.' }); }
    }

    const job = `export-${Date.now()}`;
    const assFile = path.join(workdir, 'subtitles', `${job}.ass`);
    const output = path.join(workdir, 'exports', `${job}.mp4`);
    const separationDir = path.join(workdir, 'audio', `${job}-stems`);
    const requestAbort = new AbortController();
    const abortOnClientClose = () => requestAbort.abort();
    request.raw.once('aborted', abortOnClientClose);
    let responseStream: ReturnType<typeof createReadStream> | undefined;
    let responseSent = false;

    try {
      await writeFile(assFile, ass || '', 'utf8');
      setExportProgress(exportId, { percent: 10, stage: 'Đã lưu video nguồn', status: 'running' });
      const regions = options.blurRegions || [];
      const filters: string[] = [];
      let current = '0:v';

      const requestedCrop = options.videoEdit?.crop;
      if (requestedCrop) {
        const xPercent = clamp(Number(requestedCrop.xPercent), 0, 99);
        const yPercent = clamp(Number(requestedCrop.yPercent), 0, 99);
        const widthPercent = clamp(Number(requestedCrop.widthPercent), 1, 100 - xPercent);
        const heightPercent = clamp(Number(requestedCrop.heightPercent), 1, 100 - yPercent);
        const cropX = `trunc(iw*${xPercent / 100}/2)*2`;
        const cropY = `trunc(ih*${yPercent / 100}/2)*2`;
        const cropW = `max(2,trunc(iw*${widthPercent / 100}/2)*2)`;
        const cropH = `max(2,trunc(ih*${heightPercent / 100}/2)*2)`;
        filters.push(`[${current}]crop=w='${cropW}':h='${cropH}':x='${cropX}':y='${cropY}'[cropOut]`);
        current = 'cropOut';
      } else {
        const canvasRatio = options.videoEdit?.aspectRatio && options.videoEdit.aspectRatio !== 'original'
          ? ({ '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:5': 4 / 5 } as const)[options.videoEdit.aspectRatio]
          : undefined;
        if (canvasRatio) {
          // The aspect-ratio picker changes the output canvas, not the source
          // crop. Fit the full source and letterbox/pillarbox surplus space.
          // Cropping remains an explicit Crop-modal action.
          const ratio = canvasRatio.toFixed(8);
          filters.push(`[${current}]scale=w='if(gt(a,${ratio}),round(ih*${ratio}/2)*2,iw)':h='if(gt(a,${ratio}),-2,round(iw/${ratio}/2)*2)',pad=w='max(iw,round(ih*${ratio}/2)*2)':h='max(ih,round(iw/${ratio}/2)*2)':x='(ow-iw)/2':y='(oh-ih)/2':color=black,setsar=1[aspectOut]`);
          current = 'aspectOut';
        }
      }

      regions.forEach((region, index) => {
        const xPercent = clamp(Number(region.xPercent), 0, 99);
        const yPercent = clamp(Number(region.yPercent), 0, 99);
        const widthPercent = clamp(Number(region.widthPercent), 1, 100 - xPercent);
        const heightPercent = clamp(Number(region.heightPercent), 1, 100 - yPercent);
        const start = Math.max(0, Number(region.startMs) || 0) / 1000;
        const end = Math.max(start, Number(region.endMs) || 0) / 1000;
        const radius = Math.max(3, Math.min(60, Math.round(Number(region.blurStrength) || 24)));
        const softEdge = Math.max(2, Math.min(24, Math.round(radius * 0.75)));
        const borderRadius = clamp(Number(region.borderRadius ?? 0), 0, 40);
        // Treat the control as a real corner radius. CSS percentage radii on a
        // wide subtitle strip become an exaggerated capsule and do not match
        // the exported frame.
        const cornerRadius = `min(${Math.round(borderRadius)},min(W,H)/2)`;
        const roundedMask = borderRadius > 0 ? `if(gt(between(X,${cornerRadius},W-${cornerRadius})+between(Y,${cornerRadius},H-${cornerRadius})+lte(hypot(X-${cornerRadius},Y-${cornerRadius}),${cornerRadius})+lte(hypot(X-(W-${cornerRadius}),Y-${cornerRadius}),${cornerRadius})+lte(hypot(X-${cornerRadius},Y-(H-${cornerRadius})),${cornerRadius})+lte(hypot(X-(W-${cornerRadius}),Y-(H-${cornerRadius})),${cornerRadius}),0),1,0)` : '1';
        const alpha = `255*clip(min(min(X,W-X),min(Y,H-Y))/${softEdge},0,1)*${roundedMask}`;
        const base = `base${index}`;
        const crop = `crop${index}`;
        const blur = `blur${index}`;
        const out = `video${index}`;
        const cropX = `trunc(iw*${xPercent / 100}/2)*2`;
        const cropY = `trunc(ih*${yPercent / 100}/2)*2`;
        const cropW = `trunc(iw*${widthPercent / 100}/2)*2`;
        const cropH = `trunc(ih*${heightPercent / 100}/2)*2`;
        const overlayX = `trunc(main_w*${xPercent / 100}/2)*2`;
        const overlayY = `trunc(main_h*${yPercent / 100}/2)*2`;
        if (region.mode === 'neighbor') {
          // Legacy "neighbor" regions used to copy a strip from above/below,
          // which looked like a mirror. Keep the saved mode compatible but
          // erase text from the region itself with a stronger local blend.
          const horizontalBlur = Math.min(140, Math.max(32, radius * 5));
          const verticalBlur = Math.round(Math.min(70, Math.max(16, radius * 2.5)));
          filters.push(`[${current}]split=2[${base}][${crop}];[${crop}]crop=${cropW}:${cropH}:${cropX}:${cropY},median=radius=${Math.min(10, Math.max(5, Math.round(radius / 2)))},avgblur=sizeX=${horizontalBlur}:sizeY=${verticalBlur},gblur=sigma=${Math.min(60, radius * 1.25)}:steps=3,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}'[${blur}];[${base}][${blur}]overlay=x=${overlayX}:y=${overlayY}:enable='between(t,${start},${end})'[${out}]`);
        } else {
          const horizontalBlur = Math.min(120, Math.max(24, radius * 4));
          const verticalBlur = Math.min(60, Math.max(12, radius * 2));
          filters.push(`[${current}]split=2[${base}][${crop}];[${crop}]crop=${cropW}:${cropH}:${cropX}:${cropY},median=radius=${Math.min(10, Math.max(4, Math.round(radius / 2)))},avgblur=sizeX=${horizontalBlur}:sizeY=${verticalBlur},gblur=sigma=${radius}:steps=3,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alpha}'[${blur}];[${base}][${blur}]overlay=x=${overlayX}:y=${overlayY}:enable='between(t,${start},${end})'[${out}]`);
        }
        current = out;
      });

      const args: string[] = ['-y'];
      if (trimStartSeconds > 0) args.push('-ss', trimStartSeconds.toFixed(3));
      args.push('-i', input);
      let nextInputIndex = 1;
      let logoInputIndex: number | undefined;
      if (logoFile) { logoInputIndex = nextInputIndex; nextInputIndex += 1; args.push('-loop', '1', '-i', logoFile); }
      const hasDub = Boolean(dubFile || jobDubPath);
      let dubInputIndex: number | undefined;
      if (hasDub) { dubInputIndex = nextInputIndex; nextInputIndex += 1; if (trimStartSeconds > 0) args.push('-ss', trimStartSeconds.toFixed(3)); args.push('-i', jobDubPath || dubFile as string); }

      let backgroundAudioPath: string | undefined;
      if (options.separateVocals && !jobDubIncludesBackground) {
        setExportProgress(exportId, { percent: 14, stage: 'Đang tách lời gốc khỏi nhạc nền bằng Demucs', status: 'running' });
        await mkdir(separationDir, { recursive: true });
        await run('py', ['-3.12', '-m', 'demucs', '--two-stems', 'vocals', '-n', 'htdemucs', '--out', separationDir, input], requestAbort.signal);
        backgroundAudioPath = path.join(separationDir, 'htdemucs', path.parse(input).name, 'no_vocals.wav');
        setExportProgress(exportId, { percent: 42, stage: 'Đã tách lời, đang dựng video', status: 'running' });
      }
      let backgroundInputIndex: number | undefined;
      if (backgroundAudioPath) { backgroundInputIndex = nextInputIndex; nextInputIndex += 1; if (trimStartSeconds > 0) args.push('-ss', trimStartSeconds.toFixed(3)); args.push('-i', backgroundAudioPath); }

      if (logoInputIndex !== undefined && options.logo) {
        const xPercent = clamp(Number(options.logo.xPercent), 0, 99);
        const yPercent = clamp(Number(options.logo.yPercent), 0, 99);
        const widthPercent = clamp(Number(options.logo.widthPercent), 2, 80);
        const opacity = clamp(Number(options.logo.opacity), 0, 1);
        const logoX = `trunc(main_w*${xPercent / 100}/2)*2`;
        const logoY = `trunc(main_h*${yPercent / 100}/2)*2`;
        filters.push(`[${logoInputIndex}:v][${current}]scale2ref=w=trunc(main_w*${widthPercent / 100}/2)*2:h=-1[logoScaled][logoBase];[logoScaled]format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)}[logoOpacity];[logoBase][logoOpacity]overlay=x=${logoX}:y=${logoY}:format=auto:shortest=1[logoOut]`);
        current = 'logoOut';
      }

      const fontDir = fontFile ? path.dirname(fontFile).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'") : '';
      if (options.burnSubtitles === false) filters.push(`[${current}]null[videoout]`);
      else filters.push(`[${current}]subtitles='${ffmpegPath(assFile)}'${fontDir ? `:fontsdir='${fontDir}'` : ''}[videoout]`);

      const audio = buildExportAudioFilter({
        hasDub,
        dubInputIndex,
        backgroundInputIndex,
        keepAudio: options.keepAudio,
        originalVolume: options.originalVolume,
        jobDubIncludesBackground,
      });
      if (audio) filters.push(audio);

      args.push('-filter_complex', filters.join(';'), '-map', '[videoout]');
      if (audio) args.push('-map', '[audioout]');
      const scaledOutput = outputSize(options.resolution, options.videoEdit?.aspectRatio);
      if (scaledOutput) args.push('-s', scaledOutput);
      args.push('-c:v', 'libx264', '-crf', String(Math.round(clamp(Number(options.crf ?? 20), 16, 35))), '-preset', 'medium');
      if (audio) args.push('-c:a', 'aac', '-shortest');
      else args.push('-an');
      if (trimDurationSeconds !== undefined) args.push('-t', trimDurationSeconds.toFixed(3));
      args.push('-progress', 'pipe:2', '-nostats', output);

      const durationProbe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', input], requestAbort.signal);
      const sourceDurationMs = Math.max(1, Number(durationProbe.stdout.trim()) * 1000);
      const durationMs = Math.max(1, Math.min(trimDurationSeconds === undefined ? sourceDurationMs - trimStartMs : trimDurationSeconds * 1000, sourceDurationMs - trimStartMs));
      let progressBuffer = '';
      setExportProgress(exportId, { percent: Math.max(45, exportProgress.get(exportId || '')?.percent || 0), stage: 'FFmpeg đang render video và âm thanh', status: 'running' });
      await run('ffmpeg', args, requestAbort.signal, (chunk) => {
        progressBuffer += chunk;
        const lines = progressBuffer.split(/\r?\n/);
        progressBuffer = lines.pop() || '';
        for (const line of lines) {
          const match = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
          if (!match) continue;
          const renderedMs = Number(match[1]) / 1000;
          setExportProgress(exportId, { percent: Math.round(Math.min(98, Math.max(45, 45 + (renderedMs / durationMs) * 53))), stage: 'FFmpeg đang render video và âm thanh', status: 'running' });
        }
      });

      const outputStat = await stat(output);
      setExportProgress(exportId, { percent: 100, stage: 'Đã render xong video', status: 'completed' });
      reply.header('Content-Type', 'video/mp4');
      reply.header('Content-Length', String(outputStat.size));
      reply.header('Content-Disposition', 'attachment; filename="autosub-final.mp4"');
      responseStream = createReadStream(output);
      const cleanupOutput = () => { void unlink(output).catch(() => undefined); };
      responseStream.once('close', cleanupOutput);
      responseStream.once('error', cleanupOutput);
      responseSent = true;
      return reply.send(responseStream);
    } catch (error) {
      if (requestAbort.signal.aborted) { setExportProgress(fields.exportId, { status: 'cancelled', stage: 'Đã hủy render' }); return; }
      const message = error instanceof Error ? error.message : 'FFmpeg không thể render video.';
      const friendly = /No module named demucs/i.test(message) ? 'Chưa cài Demucs cho Python 3.12. Hãy cài dependency tách lời trước khi dùng chế độ giữ nhạc nền.' : message;
      setExportProgress(fields.exportId, { status: 'failed', stage: 'Render thất bại', error: friendly });
      return reply.code(500).send({ error: friendly });
    } finally {
      request.raw.off('aborted', abortOnClientClose);
      await Promise.all([assFile, responseSent ? undefined : output].filter((file): file is string => Boolean(file)).map((file) => unlink(file).catch(() => undefined)));
      await rm(separationDir, { recursive: true, force: true }).catch(() => undefined);
      await cleanupUploadSession(uploadDir);
      if (fields.exportId) setTimeout(() => exportProgress.delete(fields.exportId), 10 * 60_000).unref?.();
    }
  });
}
