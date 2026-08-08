import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { run, ensureWorkdir, workdir } from '../services/ffmpeg';
import { getDubbingResult } from '../services/dubbingJobs';

type Fields = Record<string, string>;
type Region = {
  xPercent: number;
  yPercent: number;
  widthPercent: number;
  heightPercent: number;
  startMs: number;
  endMs: number;
  blurStrength: number;
  mode?: 'blur' | 'neighbor';
};
type Logo = { xPercent: number; yPercent: number; widthPercent: number; opacity: number };
type ExportProgress = { percent: number; stage: string; status: 'running' | 'completed' | 'failed' | 'cancelled'; error?: string; updatedAt: number };

const exportProgress = new Map<string, ExportProgress>();
const setExportProgress = (id: string | undefined, patch: Partial<ExportProgress>) => {
  if (!id) return;
  const current = exportProgress.get(id) || { percent: 1, stage: 'Đang nhận video', status: 'running' as const, updatedAt: Date.now() };
  exportProgress.set(id, { ...current, ...patch, updatedAt: Date.now() });
};

const safeFile = (name: string) => path.basename(name).replace(/[^\p{L}\p{N}._-]/gu, '_');
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

export async function exportRoutes(app: FastifyInstance) {
  app.get('/api/export/progress/:id', async (request, reply) => {
    const id = String((request.params as { id?: string }).id || '');
    const progress = exportProgress.get(id);
    if (!progress) return reply.send({ percent: 1, stage: 'Đang tải video lên máy', status: 'running' });
    return reply.send(progress);
  });

  app.post('/api/export/video', async (request, reply) => {
    const fields: Fields = {};
    let videoBuffer: Buffer | undefined;
    let videoName = 'input.mp4';
    let dubBuffer: Buffer | undefined;
    let fontBuffer: Buffer | undefined;
    let fontName = 'uploaded-font.ttf';
    let logoBuffer: Buffer | undefined;
    let logoName = 'logo.png';

    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        if (part.fieldname === 'file') {
          videoBuffer = buffer;
          videoName = part.filename;
        }
        if (part.fieldname === 'dubTrack') dubBuffer = buffer;
        if (part.fieldname === 'fontFile') { fontBuffer = buffer; fontName = part.filename; }
        if (part.fieldname === 'logoFile') { logoBuffer = buffer; logoName = part.filename; }
      } else {
        fields[part.fieldname] = String(part.value);
        if (part.fieldname === 'exportId') setExportProgress(fields.exportId, { percent: 3, stage: 'Đã nhận yêu cầu render', status: 'running' });
      }
    }

    if (!videoBuffer) return reply.code(400).send({ error: 'Thiếu video để xuất.' });

    let options: { resolution: 'original' | '1080' | '720'; crf?: number; keepAudio: boolean; originalVolume?: number; burnSubtitles?: boolean; separateVocals?: boolean; blurRegions?: Region[]; logo?: Logo; dubbingJobId?: string };
    try {
      options = JSON.parse(fields.options || '{"resolution":"original","crf":20,"keepAudio":true,"blurRegions":[]}');
    } catch {
      return reply.code(400).send({ error: 'Tùy chọn export không hợp lệ.' });
    }

    const ass = fields.ass;
    if (options.burnSubtitles !== false && !ass) return reply.code(400).send({ error: 'Thiếu ASS subtitle.' });
    const exportId = fields.exportId;
    setExportProgress(exportId, { percent: 6, stage: 'Đang chuẩn bị media', status: 'running' });
    let jobDubPath: string | undefined;
    if (options.dubbingJobId) {
      try { jobDubPath = (await getDubbingResult(options.dubbingJobId)).audioFile; }
      catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Dub job chưa hoàn tất.' }); }
    }

    await ensureWorkdir();
    const job = `export-${Date.now()}`;
    const input = path.join(workdir, 'uploads', `${job}-${safeFile(videoName)}`);
    const assFile = path.join(workdir, 'subtitles', `${job}.ass`);
    const dubFile = path.join(workdir, 'tts', `${job}-dub.wav`);
    const fontFile = path.join(workdir, 'subtitles', `${job}-${safeFile(fontName)}`);
    const logoFile = path.join(workdir, 'uploads', `${job}-${safeFile(logoName)}`);
    const output = path.join(workdir, 'exports', `${job}.mp4`);
    const separationDir = path.join(workdir, 'audio', `${job}-stems`);
    const requestAbort = new AbortController();
    const abortOnClientClose = () => requestAbort.abort();
    request.raw.once('aborted', abortOnClientClose);

    try {
      await writeFile(input, videoBuffer);
      await writeFile(assFile, ass || '', 'utf8');
      if (dubBuffer) await writeFile(dubFile, dubBuffer);
      if (fontBuffer) await writeFile(fontFile, fontBuffer);
      if (logoBuffer) await writeFile(logoFile, logoBuffer);

      setExportProgress(exportId, { percent: 10, stage: 'Đã lưu video nguồn', status: 'running' });
      const filterPath = assFile.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
      const regions = options.blurRegions || [];
      const filters: string[] = [];
      let current = '0:v';

      regions.forEach((region, index) => {
        const xPercent = clamp(Number(region.xPercent), 0, 99);
        const yPercent = clamp(Number(region.yPercent), 0, 99);
        const widthPercent = clamp(Number(region.widthPercent), 1, 100 - xPercent);
        const heightPercent = clamp(Number(region.heightPercent), 1, 100 - yPercent);
        const start = Math.max(0, Number(region.startMs) || 0) / 1000;
        const end = Math.max(start, Number(region.endMs) || 0) / 1000;
        const radius = Math.max(3, Math.min(40, Math.round(Number(region.blurStrength) || 12)));
        const base = `base${index}`;
        const crop = `crop${index}`;
        const blur = `blur${index}`;
        const out = `video${index}`;

        // crop requires integer dimensions, while overlay uses main_w/main_h
        // (iw/ih are not valid overlay variables in current FFmpeg builds).
        const cropX = `trunc(iw*${xPercent / 100}/2)*2`;
        const cropY = `trunc(ih*${yPercent / 100}/2)*2`;
        const cropW = `trunc(iw*${widthPercent / 100}/2)*2`;
        const cropH = `trunc(ih*${heightPercent / 100}/2)*2`;
        const overlayX = `trunc(main_w*${xPercent / 100}/2)*2`;
        const overlayY = `trunc(main_h*${yPercent / 100}/2)*2`;

        if (region.mode === 'neighbor') {
          const neighborYPercent = yPercent >= heightPercent ? yPercent - heightPercent : Math.min(100 - heightPercent, yPercent + heightPercent);
          const neighborY = `trunc(ih*${neighborYPercent / 100}/2)*2`;
          filters.push(
            `[${current}]split=2[${base}][${crop}];` +
            `[${crop}]crop=${cropW}:${cropH}:${cropX}:${neighborY}[${blur}];` +
            `[${base}][${blur}]overlay=x=${overlayX}:y=${overlayY}:enable='between(t,${start},${end})'[${out}]`,
          );
        } else {
          filters.push(
            `[${current}]split=2[${base}][${crop}];` +
            `[${crop}]crop=${cropW}:${cropH}:${cropX}:${cropY},boxblur=${radius}:1[${blur}];` +
            `[${base}][${blur}]overlay=x=${overlayX}:y=${overlayY}:enable='between(t,${start},${end})'[${out}]`,
          );
        }
        current = out;
      });

      const args: string[] = ['-y', '-i', input];
      let nextInputIndex = 1;
      let logoInputIndex: number | undefined;
      if (logoBuffer) { logoInputIndex = nextInputIndex; nextInputIndex += 1; args.push('-loop', '1', '-i', logoFile); }
      const hasDub = Boolean(dubBuffer || jobDubPath);
      let dubInputIndex: number | undefined;
      if (hasDub) { dubInputIndex = nextInputIndex; nextInputIndex += 1; args.push('-i', jobDubPath || dubFile); }

      let backgroundAudioPath: string | undefined;
      if (options.separateVocals) {
        setExportProgress(exportId, { percent: 14, stage: 'Đang tách lời gốc khỏi nhạc nền bằng Demucs', status: 'running' });
        await mkdir(separationDir, { recursive: true });
        await run('py', ['-3.12', '-m', 'demucs', '--two-stems', 'vocals', '-n', 'htdemucs', '--out', separationDir, input], requestAbort.signal);
        backgroundAudioPath = path.join(separationDir, 'htdemucs', path.parse(input).name, 'no_vocals.wav');
        setExportProgress(exportId, { percent: 42, stage: 'Đã tách lời, đang dựng video', status: 'running' });
      }
      let backgroundInputIndex: number | undefined;
      if (backgroundAudioPath) { backgroundInputIndex = nextInputIndex; nextInputIndex += 1; args.push('-i', backgroundAudioPath); }

      if (logoInputIndex !== undefined && options.logo) {
        const xPercent = clamp(Number(options.logo.xPercent), 0, 99);
        const yPercent = clamp(Number(options.logo.yPercent), 0, 99);
        const widthPercent = clamp(Number(options.logo.widthPercent), 2, 80);
        const opacity = clamp(Number(options.logo.opacity), 0, 1);
        const logoBase = 'logoBase';
        const logoScaled = 'logoScaled';
        const logoOut = 'logoOut';
        const logoX = `trunc(main_w*${xPercent / 100}/2)*2`;
        const logoY = `trunc(main_h*${yPercent / 100}/2)*2`;
        filters.push(
          `[${logoInputIndex}:v][${current}]scale2ref=w=trunc(main_w*${widthPercent / 100}/2)*2:h=-1[${logoScaled}][${logoBase}];` +
          `[${logoScaled}]format=rgba,colorchannelmixer=aa=${opacity.toFixed(3)}[${logoScaled}Opacity];` +
          `[${logoBase}][${logoScaled}Opacity]overlay=x=${logoX}:y=${logoY}:format=auto:shortest=1[${logoOut}]`,
        );
        current = logoOut;
      }

      const fontDir = fontBuffer ? path.dirname(fontFile).replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'") : '';
      if (options.burnSubtitles === false) filters.push(`[${current}]null[videoout]`);
      else filters.push(`[${current}]subtitles='${filterPath}'${fontDir ? `:fontsdir='${fontDir}'` : ''}[videoout]`);

      const audio = hasDub
        ? backgroundInputIndex !== undefined
          ? `[${backgroundInputIndex}:a]volume=${clamp(Number(options.originalVolume ?? 0.35), 0, 1).toFixed(3)}[background];[${dubInputIndex}:a]loudnorm=I=-16:LRA=11:TP=-1.5[dub];[background][dub]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[audioout]`
          : options.keepAudio
            ? `[0:a]volume=${clamp(Number(options.originalVolume ?? 0.25), 0, 1).toFixed(3)}[original];[${dubInputIndex}:a]loudnorm=I=-16:LRA=11:TP=-1.5[dub];[original][dub]amix=inputs=2:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95[audioout]`
            : `[${dubInputIndex}:a]loudnorm=I=-16:LRA=11:TP=-1.5[audioout]`
        : backgroundInputIndex !== undefined
          ? `[${backgroundInputIndex}:a]anull[audioout]`
          : options.keepAudio
            ? '[0:a]anull[audioout]'
          : '';
      if (audio) filters.push(audio);

      args.push('-filter_complex', filters.join(';'), '-map', '[videoout]');
      if (audio) args.push('-map', '[audioout]');
      if (options.resolution === '1080') args.push('-s', '1920x1080');
      if (options.resolution === '720') args.push('-s', '1280x720');
      args.push('-c:v', 'libx264', '-crf', String(Math.round(clamp(Number(options.crf ?? 20), 16, 35))), '-preset', 'medium');
      if (audio) args.push('-c:a', 'aac', '-shortest');
      else args.push('-an');
      args.push('-progress', 'pipe:2', '-nostats');
      args.push(output);

      const durationProbe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', input], requestAbort.signal);
      const durationMs = Math.max(1, Number(durationProbe.stdout.trim()) * 1000);
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
          const percent = Math.min(98, Math.max(45, 45 + (renderedMs / durationMs) * 53));
          setExportProgress(exportId, { percent: Math.round(percent), stage: 'FFmpeg đang render video và âm thanh', status: 'running' });
        }
      });
      const buffer = await readFile(output);
      setExportProgress(exportId, { percent: 100, stage: 'Đã render xong video', status: 'completed' });
      reply.header('Content-Type', 'video/mp4');
      reply.header('Content-Disposition', 'attachment; filename="autosub-final.mp4"');
      return reply.send(buffer);
    } catch (error) {
      if (requestAbort.signal.aborted) { setExportProgress(fields.exportId, { status: 'cancelled', stage: 'Đã hủy render' }); return; }
      const message = error instanceof Error ? error.message : 'FFmpeg không thể render video.';
      const friendly = /No module named demucs/i.test(message) ? 'Chưa cài Demucs cho Python 3.12. Hãy cài dependency tách lời trước khi dùng chế độ giữ nhạc nền.' : message;
      setExportProgress(fields.exportId, { status: 'failed', stage: 'Render thất bại', error: friendly });
      return reply.code(500).send({ error: friendly });
    } finally {
      request.raw.off('aborted', abortOnClientClose);
      await Promise.all([input, assFile, dubFile, fontFile, logoFile, output].map((file) => unlink(file).catch(() => undefined)));
      await rm(separationDir, { recursive: true, force: true }).catch(() => undefined);
      if (fields.exportId) setTimeout(() => exportProgress.delete(fields.exportId), 10 * 60_000).unref?.();
    }
  });
}
