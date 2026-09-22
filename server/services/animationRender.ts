import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import type { AnimationAsset, AnimationProject, CompositeScene, SceneLayer } from '../../shared/animationStudio';
import { assertAnimationProject, normalizeAnimationProjectForRender } from '../../shared/animationStudio';
import { renderDurationInFrames } from '../../src/remotion/timeline';
import { preferredH264Encoder, run, workdir } from './ffmpeg';
import { getAnimationAssetFile } from './animationAssets';
import { resolveUpload } from './uploads';

const x264Presets = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow', 'placebo'] as const;
type X264Preset = typeof x264Presets[number];
const resolveX264Preset = (value: string | undefined): X264Preset => x264Presets.includes(value as X264Preset) ? value as X264Preset : 'ultrafast';

export async function validateAnimationOutput(file: string, expected?: { width: number; height: number; fps: number; durationInFrames: number }) {
  const probe = await run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
  const metadata = JSON.parse(probe.stdout) as { streams?: Array<{ codec_type?: string; width?: number; height?: number; duration?: string }>; format?: { duration?: string } };
  const video = metadata.streams?.find((stream) => stream.codec_type === 'video');
  const duration = Number(video?.duration || metadata.format?.duration);
  if (!video || !video.width || !video.height || !Number.isFinite(duration) || duration <= 0) throw new Error('Bản xuất không có luồng video hợp lệ.');
  if (expected && (video.width !== expected.width || video.height !== expected.height || Math.abs(duration - expected.durationInFrames / expected.fps) > 2 / expected.fps)) {
    throw new Error('Kích thước hoặc thời lượng bản xuất không khớp timeline. Giữ project để xuất lại.');
  }
  return { width: video.width, height: video.height, durationSeconds: duration };
}

export interface AnimationRecordingTimeline { durationMs: number; fps: number }

async function readAnimationTimeline(projectId: string): Promise<AnimationRecordingTimeline | undefined> {
  try {
    const file = path.join(workdir, 'animation-projects', projectId, 'project.json');
    const project = JSON.parse(await readFile(file, 'utf8')) as { fps?: number; scenes?: Array<{ durationMs?: number }> };
    const fps = Number(project.fps);
    const durationMs = (project.scenes || []).reduce((total, scene) => total + Math.max(0, Number(scene.durationMs) || 0), 0);
    if (!Number.isFinite(fps) || fps <= 0 || !Number.isFinite(durationMs) || durationMs <= 0) return undefined;
    return { fps, durationMs };
  } catch {
    return undefined;
  }
}

async function readVideoDuration(file: string) {
  try {
    const probe = await run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=duration', '-of', 'default=nw=1:nk=1', file]);
    const duration = Number(probe.stdout.trim().split(/\s+/)[0]);
    if (Number.isFinite(duration) && duration > 0) return duration;
  } catch { /* fall through to format duration */ }
  try {
    const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    const duration = Number(probe.stdout.trim().split(/\s+/)[0]);
    return Number.isFinite(duration) && duration > 0 ? duration : undefined;
  } catch {
    return undefined;
  }
}

export async function transcodeAnimationRecording(projectId: string, recording: Buffer, requestedCacheKey?: string, requestedTimeline?: AnimationRecordingTimeline) {
  if (!/^[a-f0-9-]{36}$/i.test(projectId)) throw new Error('Project id không hợp lệ.');
  if (!recording.length) throw new Error('Bản ghi animation đang trống.');
  const directory = path.join(workdir, 'animation-projects', projectId, 'renders');
  const cacheDirectory = path.join(workdir, 'animation-render-cache');
  const timeline = requestedTimeline || await readAnimationTimeline(projectId);
  const hash = createHash('sha256').update('browser-recording-v3-timeline-retimed').update(JSON.stringify(timeline || null)).update(requestedCacheKey || '').update(recording).digest('hex');
  const cached = path.join(cacheDirectory, `${hash}.mp4`);
  try { await validateAnimationOutput(cached); return { path: cached, size: (await stat(cached)).size, cached: true }; } catch { /* missing or invalid cache */ }
  await mkdir(directory, { recursive: true }); await mkdir(cacheDirectory, { recursive: true });
  const input = path.join(directory, `${randomUUID()}.webm`); await writeFile(input, recording);
  const temporary = path.join(cacheDirectory, `${hash}.${randomUUID()}.partial.mp4`);
  try {
    const sourceDuration = timeline ? await readVideoDuration(input) : undefined;
    const expectedSeconds = timeline ? timeline.durationMs / 1000 : undefined;
    const retime = timeline
      ? sourceDuration && expectedSeconds && Math.abs(sourceDuration - expectedSeconds) > 1 / timeline.fps
        ? `setpts=${(expectedSeconds / sourceDuration).toFixed(9)}*(PTS-STARTPTS),fps=${timeline.fps}`
        : `setpts=PTS-STARTPTS,fps=${timeline.fps}`
      : undefined;
    const args = ['-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', ...(retime ? ['-vf', retime] : []), ...(expectedSeconds ? ['-t', expectedSeconds.toFixed(3)] : []), '-c:v', 'libx264', '-preset', resolveX264Preset(process.env.AUTOSUB_ANIMATION_X264_PRESET?.trim()), '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', temporary];
    await run('ffmpeg', args);
    await validateAnimationOutput(temporary);
    await rename(temporary, cached);
  } finally {
    await rm(temporary, { force: true });
    await rm(input, { force: true });
  }
  return { path: cached, size: (await stat(cached)).size, cached: false };
}

let remotionBundle: Promise<string> | undefined;

function resolveBrowserExecutable() {
  const candidates = [
    process.env.AUTOSUB_CHROME_PATH,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => existsSync(candidate));
}

async function getRemotionBundle() {
  if (!remotionBundle) {
    const entryPoint = fileURLToPath(new URL('../../src/remotion/index.tsx', import.meta.url));
    remotionBundle = bundle(entryPoint, undefined, { rootDir: path.resolve(path.dirname(entryPoint), '../..'), publicDir: null })
      .catch((error) => { remotionBundle = undefined; throw error; });
  }
  return remotionBundle;
}

type StaticVisual = { path: string; startMs: number; durationMs: number };
type StaticAudio = { path: string; startMs: number; durationMs?: number; volume: number };
type StaticImageTimeline = { visuals: StaticVisual[]; audio: StaticAudio[]; durationMs: number };

const uuidPattern = '[a-f0-9-]{36}';

async function resolveLocalAnimationAsset(asset: AnimationAsset) {
  let pathname = asset.uri;
  try { pathname = new URL(asset.uri, 'http://127.0.0.1').pathname; } catch { /* keep the original URI */ }
  const generated = new RegExp(`^/api/animation-studio/assets/(${uuidPattern})/file$`, 'i').exec(pathname);
  if (generated) return (await getAnimationAssetFile(generated[1])).path;
  const upload = new RegExp(`^/api/uploads/(${uuidPattern})/media$`, 'i').exec(pathname);
  if (upload) return (await resolveUpload(upload[1])).absolutePath;
  return undefined;
}

function sceneImageWindows(scene: CompositeScene, layers: SceneLayer[]) {
  const ordered = [...layers].sort((a, b) => a.zIndex - b.zIndex);
  const hasExplicitTiming = ordered.some((layer) => layer.startMs !== undefined || layer.durationMs !== undefined);
  let cursor = 0;
  return ordered.map((layer, index) => {
    const incoming = scene.commands.filter((command) => command.targetId === layer.id && command.type === 'FADE_IN').sort((a, b) => a.startMs - b.startMs)[0];
    const outgoing = scene.commands.filter((command) => command.targetId === layer.id && command.type === 'FADE_OUT').sort((a, b) => a.startMs - b.startMs)[0];
    const startMs = layer.startMs ?? incoming?.startMs ?? (hasExplicitTiming ? cursor : Math.round(scene.durationMs * index / Math.max(1, ordered.length)));
    const nextStart = ordered[index + 1]?.startMs ?? (hasExplicitTiming ? undefined : Math.round(scene.durationMs * (index + 1) / Math.max(1, ordered.length)));
    const endMs = Math.min(scene.durationMs, startMs + (layer.durationMs ?? Math.max(1, outgoing?.startMs ?? nextStart ?? scene.durationMs) - startMs));
    cursor = Math.max(cursor, endMs);
    return { layer, startMs: Math.max(0, startMs), durationMs: Math.max(1, endMs - startMs) };
  });
}

async function buildStaticImageTimeline(project: AnimationProject): Promise<StaticImageTimeline | undefined> {
  const visuals: StaticVisual[] = [];
  const audio: StaticAudio[] = [];
  let offsetMs = 0;
  for (const scene of project.scenes.sort((a, b) => a.order - b.order)) {
    if (scene.renderMode !== 'composite') return undefined;
    const imageLayers = scene.layers.filter((layer) => layer.visible && layer.type === 'image' && layer.assetId);
    if (!imageLayers.length) return undefined;
    const windows = sceneImageWindows(scene, imageLayers);
    let sceneCursor = 0;
    for (const window of windows) {
      const asset = project.assets.find((candidate) => candidate.id === window.layer.assetId);
      if (!asset) return undefined;
      const file = await resolveLocalAnimationAsset(asset);
      if (!file) return undefined;
      if (window.startMs > sceneCursor + 2) return undefined;
      visuals.push({ path: file, startMs: offsetMs + window.startMs, durationMs: window.durationMs });
      sceneCursor = Math.max(sceneCursor, window.startMs + window.durationMs);
    }
    if (sceneCursor < scene.durationMs - 2) return undefined;
    for (const layer of scene.layers.filter((candidate) => candidate.visible && candidate.type === 'audio' && candidate.assetId)) {
      const asset = project.assets.find((candidate) => candidate.id === layer.assetId);
      if (!asset) return undefined;
      const file = await resolveLocalAnimationAsset(asset);
      if (!file) return undefined;
      const startMs = offsetMs + Math.max(0, layer.startMs || 0);
      const durationMs = layer.durationMs ? Math.max(1, Math.min(layer.durationMs, scene.durationMs - (layer.startMs || 0))) : undefined;
      const isMusic = asset.tags.some((tag) => /^(?:music|bgm|nhac)$/i.test(tag));
      const hasVoiceover = scene.layers.some((candidate) => candidate.type === 'audio' && candidate.visible && candidate.name.startsWith('Voiceover'));
      audio.push({ path: file, startMs, durationMs, volume: Math.max(0, Math.min(1, (layer.volume ?? layer.transform.opacity) * (isMusic && hasVoiceover ? .3 : 1))) });
    }
    offsetMs += scene.durationMs;
  }
  return { visuals, audio, durationMs: offsetMs };
}

async function renderStaticImageProject(project: AnimationProject, timeline: StaticImageTimeline, output: string, onProgress?: (progress: number) => void) {
  // A single FFmpeg command with hundreds of image/audio inputs can exceed
  // Windows' command-line limit. Render each scene independently, then join
  // the already-encoded segments without re-encoding them.
  const segmentDirectory = path.join(path.dirname(output), `${randomUUID()}.segments`);
  const segmentFiles: string[] = [];
  const scenes = [...project.scenes].sort((a, b) => a.order - b.order);
  await mkdir(segmentDirectory, { recursive: true });
  let sceneOffsetMs = 0;
  try {
    for (const [sceneIndex, scene] of scenes.entries()) {
      const sceneStartMs = sceneOffsetMs;
      const sceneEndMs = sceneStartMs + scene.durationMs;
      const visuals = timeline.visuals
        .filter((visual) => visual.startMs < sceneEndMs && visual.startMs + visual.durationMs > sceneStartMs)
        .map((visual) => ({ ...visual, startMs: Math.max(0, visual.startMs - sceneStartMs) }));
      const audio = timeline.audio
        .filter((item) => item.startMs < sceneEndMs && (item.startMs + (item.durationMs || sceneEndMs - item.startMs)) > sceneStartMs)
        .map((item) => ({ ...item, startMs: Math.max(0, item.startMs - sceneStartMs) }));
      if (!visuals.length) throw new Error(`Scene ${scene.name} không có ảnh để xuất.`);

      const filters: string[] = [];
      const videoLabels: string[] = [];
      for (const [index, visual] of visuals.entries()) {
        const duration = (visual.durationMs / 1000).toFixed(3);
        const label = `v${index}`;
        filters.push(`[${index}:v]scale=${project.width}:${project.height},setsar=1,fps=${project.fps},trim=duration=${duration},setpts=PTS-STARTPTS[${label}]`);
        videoLabels.push(`[${label}]`);
      }
      filters.push(`${videoLabels.join('')}concat=n=${videoLabels.length}:v=1:a=0[vout]`);
      const args = ['-y', ...visuals.flatMap((visual) => ['-loop', '1', '-i', visual.path]), ...audio.flatMap((item) => ['-i', item.path])];
      if (audio.length) {
        const audioLabels: string[] = [];
        const sceneSeconds = (scene.durationMs / 1000).toFixed(3);
        audio.forEach((item, index) => {
          const inputIndex = visuals.length + index;
          const startMs = Math.max(0, Math.round(item.startMs));
          const durationMs = Math.max(1, Math.min(item.durationMs || scene.durationMs - item.startMs, scene.durationMs - item.startMs));
          const label = `a${index}`;
          filters.push(`[${inputIndex}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${(durationMs / 1000).toFixed(3)},asetpts=PTS-STARTPTS,volume=${item.volume.toFixed(3)},adelay=${startMs}|${startMs}[${label}]`);
          audioLabels.push(`[${label}]`);
        });
        filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0,apad,atrim=duration=${sceneSeconds},loudnorm=I=-16:TP=-1.5:LRA=7[aout]`);
      }
      args.push('-filter_complex', filters.join(';'), '-map', '[vout]');
      if (audio.length) args.push('-map', '[aout]');
      const sceneFrames = Math.max(1, Math.round(scene.durationMs / 1000 * project.fps));
      args.push('-t', (scene.durationMs / 1000).toFixed(3), '-frames:v', String(sceneFrames), '-r', String(project.fps), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '21', '-pix_fmt', 'yuv420p');
      if (audio.length) args.push('-c:a', 'aac', '-b:a', '192k');
      const segment = path.join(segmentDirectory, `${String(sceneIndex).padStart(4, '0')}.mp4`);
      args.push(segment);
      await run('ffmpeg', args);
      segmentFiles.push(segment);
      sceneOffsetMs = sceneEndMs;
      onProgress?.(.1 + (.8 * (sceneIndex + 1)) / Math.max(1, scenes.length));
    }
    const concatList = path.join(segmentDirectory, 'concat.txt');
    await writeFile(concatList, segmentFiles.map((file) => `file '${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`).join('\n'), 'utf8');
    const outputSeconds = (renderDurationInFrames(project) / Math.max(1, project.fps)).toFixed(3);
    await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-t', outputSeconds, '-c', 'copy', '-movflags', '+faststart', output]);
    onProgress?.(.95);
  } finally {
    await rm(segmentDirectory, { recursive: true, force: true });
  }
}

async function renderStaticImageProjectFast(project: AnimationProject, timeline: StaticImageTimeline, output: string, onProgress?: (progress: number) => void) {
  // The fast path uses one concat manifest and one FFmpeg process. The old
  // scene-by-scene renderer paid process startup and H.264 encoding cost for
  // every cue, which made long videos unnecessarily slow.
  const temporaryDirectory = path.join(path.dirname(output), `${randomUUID()}.static`);
  const visualManifest = path.join(temporaryDirectory, 'visuals.txt');
  const outputSeconds = (renderDurationInFrames(project) / Math.max(1, project.fps)).toFixed(3);
  const escapeConcatPath = (file: string) => file.replace(/\\/g, '/').replace(/'/g, "'\\''");
  const visualManifestLines: string[] = [];
  for (const visual of timeline.visuals) {
    visualManifestLines.push(`file '${escapeConcatPath(visual.path)}'`);
    visualManifestLines.push(`duration ${(visual.durationMs / 1000).toFixed(6)}`);
  }
  const lastVisual = timeline.visuals.at(-1);
  if (lastVisual) visualManifestLines.push(`file '${escapeConcatPath(lastVisual.path)}'`);

  const filters: string[] = [
    `[0:v]scale=${project.width}:${project.height},setsar=1,fps=${project.fps},format=yuv420p[vout]`,
  ];
  const audioLabels: string[] = [];
  timeline.audio.forEach((item, index) => {
    const startMs = Math.max(0, Math.round(item.startMs));
    const durationMs = Math.max(1, Math.min(item.durationMs || timeline.durationMs - item.startMs, timeline.durationMs - item.startMs));
    const label = `a${index}`;
    filters.push(`[${index + 1}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=${(durationMs / 1000).toFixed(6)},asetpts=PTS-STARTPTS,volume=${item.volume.toFixed(3)},adelay=${startMs}|${startMs}[${label}]`);
    audioLabels.push(`[${label}]`);
  });
  if (audioLabels.length) {
    filters.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0:normalize=0,apad,atrim=duration=${outputSeconds},loudnorm=I=-16:TP=-1.5:LRA=7[aout]`);
  }

  const encoder = await preferredH264Encoder();
  const videoCodecArgs = encoder === 'h264_nvenc'
    ? ['-c:v', 'h264_nvenc', '-preset', 'fast', '-rc', 'vbr', '-cq', '21', '-b:v', '0', '-profile:v', 'high', '-tag:v', 'avc1']
    : encoder === 'h264_qsv'
      ? ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '21', '-profile:v', 'high', '-tag:v', 'avc1']
      : encoder === 'h264_amf'
        ? ['-c:v', 'h264_amf', '-usage', 'transcoding', '-quality', 'quality', '-rc', 'cqp', '-qp_i', '21', '-qp_p', '21', '-profile:v', 'high', '-tag:v', 'avc1']
        : ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '21', '-profile:v', 'high', '-tag:v', 'avc1'];

  await mkdir(temporaryDirectory, { recursive: true });
  try {
    await writeFile(visualManifest, `${visualManifestLines.join('\n')}\n`, 'utf8');
    const args = [
      '-y', '-f', 'concat', '-safe', '0', '-i', visualManifest,
      ...timeline.audio.flatMap((item) => ['-i', item.path]),
      '-filter_complex', filters.join(';'), '-map', '[vout]',
    ];
    if (audioLabels.length) args.push('-map', '[aout]', '-c:a', 'aac', '-b:a', '192k');
    args.push('-t', outputSeconds, '-r', String(project.fps), ...videoCodecArgs, '-pix_fmt', 'yuv420p', '-threads', '0', '-progress', 'pipe:2', '-nostats', output);
    let progressBuffer = '';
    await run('ffmpeg', args, undefined, (chunk) => {
      progressBuffer += chunk;
      const lines = progressBuffer.split(/\r?\n/);
      progressBuffer = lines.pop() || '';
      for (const line of lines) {
        const match = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
        if (!match) continue;
        const renderedMs = Number(match[1]) / 1000;
        onProgress?.(.1 + .85 * Math.min(1, renderedMs / Math.max(1, timeline.durationMs)));
      }
    });
    onProgress?.(.99);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function normalizeRenderedAudio(input: string, output: string) {
  await run('ffmpeg', ['-y', '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'copy', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=7', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output]);
}

export async function renderAnimationProject(project: AnimationProject, showSubtitles: boolean, requestedCacheKey?: string, onProgress?: (progress: number) => void) {
  project = normalizeAnimationProjectForRender(project);
  assertAnimationProject(project);
  if (!project.scenes.length) throw new Error('Project chưa có cảnh để xuất.');
  const missingVideo = project.scenes.find((scene) => scene.renderMode === 'generated-video' && !scene.source?.uri);
  if (missingVideo) throw new Error(`Cảnh “${missingVideo.name}” chưa có video nguồn. Không thể xuất bản đầy đủ.`);
  const renderProject: AnimationProject = {
    ...project,
    transitionPreset: { type: 'cut', durationMs: 0 },
    scenes: project.scenes.map((scene) => scene.renderMode !== 'composite' ? scene : {
      ...scene,
      transition: { type: 'cut', durationMs: 0 },
      layers: scene.layers.filter((layer) => layer.type === 'image' || layer.type === 'audio'),
      commands: [],
      camera: { ...scene.camera, commands: [] },
    }),
  };
  const normalized = { ...renderProject, assetManifest: undefined, createdAt: '', updatedAt: '', assets: renderProject.assets.map((asset) => ({ ...asset, createdAt: '' })) };
  // Read cue boundaries from the original project for backwards compatibility,
  // but never pass its commands/layers to the renderer.
  const staticTimeline = await buildStaticImageTimeline(project).catch(() => undefined);
  // A client key must never override the actual project/subtitle/engine fingerprint.
  const hash = createHash('sha256').update(JSON.stringify({ project: normalized, showSubtitles, engine: staticTimeline ? 'ffmpeg-static-image-v3-single-pass-audio-normalized' : 'remotion-v5-audio-normalized', requestedCacheKey })).digest('hex');
  const cacheDirectory = path.join(workdir, 'animation-render-cache');
  const cached = path.join(cacheDirectory, `${hash}.mp4`);
  try {
    await validateAnimationOutput(cached, { width: project.width, height: project.height, fps: project.fps, durationInFrames: renderDurationInFrames(project) });
    return { path: cached, size: (await stat(cached)).size, cached: true };
  } catch { /* missing or invalid cache */ }
  await mkdir(cacheDirectory, { recursive: true });
  if (staticTimeline) {
    const temporary = path.join(cacheDirectory, `${hash}.${randomUUID()}.partial.mp4`);
    try {
      await renderStaticImageProjectFast(renderProject, staticTimeline, temporary, onProgress);
      await validateAnimationOutput(temporary, { width: renderProject.width, height: renderProject.height, fps: renderProject.fps, durationInFrames: renderDurationInFrames(renderProject) });
      await rename(temporary, cached);
      return { path: cached, size: (await stat(cached)).size, cached: false };
    } catch (error) {
      const fastRenderError = error instanceof Error ? error.message : String(error);
      await writeFile(path.join(cacheDirectory, 'last-fast-render-error.txt'), fastRenderError, 'utf8').catch(() => undefined);
      console.warn('[animation-render] Fast static renderer skipped; using Remotion fallback.', fastRenderError);
      await rm(temporary, { force: true });
      // Keep the browser renderer as a compatibility fallback for old or unusual assets.
    }
  }
  const serveUrl = await getRemotionBundle();
  const executable = resolveBrowserExecutable();
  const inputProps = { project: renderProject, showSubtitles: false, assetOrigin: `http://127.0.0.1:${Number(process.env.AUTOSUB_PORT || 8787)}` };
  const browserOptions = executable ? { browserExecutable: executable } : {};
  const composition = await selectComposition({ serveUrl, id: 'AutoSubAnimation', inputProps, logLevel: 'warn', timeoutInMilliseconds: 120_000, ...browserOptions });
  const temporary = path.join(cacheDirectory, `${hash}.${randomUUID()}.partial.mp4`);
  const configuredConcurrency = Number(process.env.AUTOSUB_ANIMATION_RENDER_CONCURRENCY);
  const availableParallelism = typeof os.availableParallelism === 'function' ? os.availableParallelism() : 4;
  const concurrency = Math.max(2, Math.min(8, Number.isFinite(configuredConcurrency) && configuredConcurrency > 0 ? Math.round(configuredConcurrency) : availableParallelism));
  const x264Preset = resolveX264Preset(process.env.AUTOSUB_ANIMATION_X264_PRESET?.trim());
  const hasAudio = renderProject.scenes.some((scene) => scene.renderMode === 'composite' && scene.layers.some((layer) => layer.type === 'audio' && layer.visible && layer.assetId));
  try {
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: 'h264',
    pixelFormat: 'yuv420p',
    crf: 21,
    x264Preset,
    audioBitrate: '192k',
    outputLocation: temporary,
    overwrite: true,
    concurrency,
    logLevel: 'warn',
    timeoutInMilliseconds: 120_000,
    onProgress: ({ progress }) => onProgress?.(Math.max(0, Math.min(1, progress))),
    ...browserOptions,
  });
  await validateAnimationOutput(temporary, { width: composition.width, height: composition.height, fps: composition.fps, durationInFrames: composition.durationInFrames });
  let finalOutput = temporary;
  if (hasAudio) {
    const normalizedAudioOutput = path.join(cacheDirectory, `${hash}.${randomUUID()}.audio-normalized.partial.mp4`);
    try {
      await normalizeRenderedAudio(temporary, normalizedAudioOutput);
      await validateAnimationOutput(normalizedAudioOutput, { width: composition.width, height: composition.height, fps: composition.fps, durationInFrames: composition.durationInFrames });
      await rm(temporary, { force: true });
      finalOutput = normalizedAudioOutput;
    } catch {
      await rm(normalizedAudioOutput, { force: true });
    }
  }
  await rename(finalOutput, cached);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { path: cached, size: (await stat(cached)).size, cached: false };
}

export interface AnimationRenderJob { id: string; projectId: string; engine?: 'browser-recording' | 'remotion'; showSubtitles?: boolean; cacheKey?: string; timeline?: AnimationRecordingTimeline; status: 'queued' | 'rendering' | 'completed' | 'failed'; progress: number; createdAt: string; updatedAt: string; cached?: boolean; result?: { path: string; size: number }; error?: string }
const root = path.join(workdir, 'animation-render-jobs'); const jobs = new Map<string, AnimationRenderJob>(); const queue: string[] = []; let running = false;
const jobDirectory = (id: string) => path.join(root, /^[a-f0-9-]{36}$/i.test(id) ? id : 'invalid');
const jobFile = (id: string) => path.join(jobDirectory(id), 'job.json'); const recordingFile = (id: string) => path.join(jobDirectory(id), 'recording.webm'); const projectFile = (id: string) => path.join(jobDirectory(id), 'project.json');
let jobWrites: Promise<unknown> = Promise.resolve();
async function saveJob(job: AnimationRenderJob) {
  const terminal = job.status === 'completed' || job.status === 'failed';
  if (!terminal) jobs.set(job.id, job);
  const write = jobWrites.catch(() => undefined).then(async () => {
    await mkdir(jobDirectory(job.id), { recursive: true });
    const temporary = `${jobFile(job.id)}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(job, null, 2), 'utf8');
      await rename(temporary, jobFile(job.id));
    } finally { await rm(temporary, { force: true }); }
  });
  jobWrites = write;
  await write;
  if (terminal) jobs.set(job.id, job);
  return job;
}
async function patchJob(id: string, change: Partial<AnimationRenderJob>) { return saveJob({ ...jobs.get(id)!, ...change, updatedAt: new Date().toISOString() }); }
async function drainQueue() {
  if (running) return;
  running = true;
  try {
    while (queue.length) {
      const id = queue.shift()!;
      const job = jobs.get(id);
      if (!job) continue;
      try {
        await patchJob(id, { status: 'rendering', progress: 5 });
        // Progress is transient: persist stage boundaries, not every rendered frame.
        const reportProgress = (progress: number) => {
          const current = jobs.get(id);
          if (current?.status === 'rendering') jobs.set(id, { ...current, progress: Math.max(current.progress, 8, Math.round(progress * 90)), updatedAt: new Date().toISOString() });
        };
        const result = job.engine === 'remotion'
          ? await renderAnimationProject(JSON.parse(await readFile(projectFile(id), 'utf8')) as AnimationProject, job.showSubtitles !== false, job.cacheKey, reportProgress)
          : await transcodeAnimationRecording(job.projectId, await readFile(recordingFile(id)), job.cacheKey, job.timeline);
        await patchJob(id, { status: 'completed', progress: 100, cached: result.cached, result: { path: result.path, size: result.size }, error: undefined });
      } catch (error) {
        const failed: AnimationRenderJob = { ...jobs.get(id)!, status: 'failed', progress: 100, error: error instanceof Error ? error.message : String(error), updatedAt: new Date().toISOString() };
        // A disk failure must not become an unhandled rejection or abandon later jobs.
        try { await saveJob(failed); } catch (writeError) { jobs.set(id, failed); console.error('Cannot persist animation render failure', id, writeError); }
      }
    }
  } finally { running = false; }
}
export async function initializeAnimationRenderJobs() { await mkdir(root, { recursive: true }); for (const entry of await readdir(root, { withFileTypes: true })) { if (!entry.isDirectory()) continue; try { let job = JSON.parse(await readFile(jobFile(entry.name), 'utf8')) as AnimationRenderJob; if (job.status === 'queued' || job.status === 'rendering') { job = await saveJob({ ...job, status: 'queued', progress: 0, error: undefined, updatedAt: new Date().toISOString() }); queue.push(job.id); } else jobs.set(job.id, job); } catch { /* ignore broken job record */ } } void drainQueue(); }
export async function enqueueAnimationRender(projectId: string, recording: Buffer, cacheKey?: string, timeline?: AnimationRecordingTimeline) { if (!/^[a-f0-9-]{36}$/i.test(projectId) || !recording.length) throw new Error('Project hoặc bản ghi render không hợp lệ.'); const now = new Date().toISOString(); const job: AnimationRenderJob = { id: randomUUID(), projectId, cacheKey: cacheKey && /^[a-f0-9]{64}$/i.test(cacheKey) ? cacheKey : undefined, timeline, status: 'queued', progress: 0, createdAt: now, updatedAt: now }; await mkdir(jobDirectory(job.id), { recursive: true }); await writeFile(recordingFile(job.id), recording); await saveJob(job); queue.push(job.id); void drainQueue(); return job; }
export async function enqueueAnimationProjectRender(projectId: string, project: AnimationProject, showSubtitles = true, cacheKey?: string) { project = normalizeAnimationProjectForRender(project); if (!/^[a-f0-9-]{36}$/i.test(projectId) || project.id !== projectId) throw new Error('Project render không hợp lệ.'); assertAnimationProject(project); const normalizedCacheKey = cacheKey && /^[a-f0-9]{64}$/i.test(cacheKey) ? cacheKey : undefined; const duplicate = [...jobs.values()].filter((candidate) => candidate.projectId === projectId && candidate.engine === 'remotion' && candidate.showSubtitles === showSubtitles && candidate.cacheKey === normalizedCacheKey && (candidate.status === 'queued' || candidate.status === 'rendering')).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]; if (duplicate) return duplicate; const now = new Date().toISOString(); const job: AnimationRenderJob = { id: randomUUID(), projectId, engine: 'remotion', showSubtitles, cacheKey: normalizedCacheKey, status: 'queued', progress: 0, createdAt: now, updatedAt: now }; await mkdir(jobDirectory(job.id), { recursive: true }); await writeFile(projectFile(job.id), JSON.stringify(project), 'utf8'); await saveJob(job); queue.push(job.id); void drainQueue(); return job; }
export function getAnimationRenderJob(id: string) { const job = jobs.get(id); if (!job) throw new Error('Không tìm thấy render job.'); return job; }
export function listAnimationRenderJobs() { return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
