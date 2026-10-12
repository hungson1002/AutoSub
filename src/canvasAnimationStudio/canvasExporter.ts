import type { CanvasStudioProject } from './types';
import { projectDurationMs, resolveProjectTime } from './runtime';
import { validateCanvasBeat } from '../../shared/canvasBeats';
import { compileCanvasProjectLayout } from '../../shared/canvasLayoutCompiler';

// renderer.ts pulls DOM + flubber ESM, so it is lazy-loaded inside
// recordPureCanvasProject(). Pure helpers stay import-safe under node tests.

export type PureCanvasExportProgress = (doneMs: number, totalMs: number) => void;

export interface PureCanvasRecordOptions {
  assetOrigin?: string;
  /** Mix each scene audioUrl into the recording. Defaults to true. */
  withAudio?: boolean;
  onProgress?: PureCanvasExportProgress;
  signal?: AbortSignal;
}

const PREFERRED_MIMES = [
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
  'video/mp4',
];

/** Pick the first MediaRecorder mime the browser accepts. Pure + unit-testable. */
export function selectCanvasExportMimeType(
  isSupported?: (mime: string) => boolean,
): string {
  const supported = isSupported
    || ((mime: string) => typeof MediaRecorder !== 'undefined'
      && MediaRecorder.isTypeSupported(mime));
  for (const mime of PREFERRED_MIMES) {
    try {
      if (supported(mime)) return mime;
    } catch {
      continue;
    }
  }
  return '';
}

export function canvasProjectTotalFrames(project: CanvasStudioProject): number {
  const fps = Math.max(1, Math.min(60, project.fps || 30));
  return project.scenes.reduce(
    (total, scene) => total + Math.max(1, Math.round(Math.max(250, scene.durationMs) / 1000 * fps)),
    0,
  );
}

/** Structural validation before a pure-canvas recording starts. */
export function validateCanvasExportProject(project: CanvasStudioProject): string[] {
  const issues: string[] = [];
  if (!project || project.version !== 1) issues.push('Canvas project không đúng schema v1.');
  if (!Number.isFinite(project.width) || project.width < 320) issues.push('Chiều rộng Canvas tối thiểu 320px.');
  if (!Number.isFinite(project.height) || project.height < 180) issues.push('Chiều cao Canvas tối thiểu 180px.');
  if (!Array.isArray(project.scenes) || !project.scenes.length) issues.push('Project chưa có scene để xuất.');
  for (const scene of project.scenes || []) {
    if (!scene.objects.length && !scene.backgroundRef && !scene.backgroundImageUrl) issues.push(`Cảnh “${scene.name}” chưa có object nào.`);
    for (const beat of scene.animationBeats || []) {
      for (const issue of validateCanvasBeat(scene, beat)) issues.push(`Cảnh “${scene.name}”: ${issue}`);
    }
  }
  return issues;
}

type SceneVoice = { element: HTMLAudioElement; source: MediaElementAudioSourceNode; sceneId: string };

async function attachSceneAudio(
  project: CanvasStudioProject,
  audioContext: AudioContext,
  destination: MediaStreamAudioDestinationNode,
  signal?: AbortSignal,
) {
  const voices: SceneVoice[] = [];
  for (const scene of project.scenes) {
    if (!scene.audioUrl) continue;
    const element = new Audio(scene.audioUrl);
    element.crossOrigin = 'anonymous';
    element.preload = 'auto';
    const source = audioContext.createMediaElementSource(element);
    source.connect(destination);
    voices.push({ element, source, sceneId: scene.id });
  }
  if (signal) {
    const abort = () => {
      for (const voice of voices) {
        try { voice.element.pause(); } catch { /* already torn down */ }
        try { voice.source.disconnect(); } catch { /* already torn down */ }
      }
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  return voices;
}

/**
 * Record a Canvas project with pure JS + HTML Canvas — no Remotion, no headless
 * Chrome. The canvas is driven deterministically by wall-clock project time and
 * captured with canvas.captureStream(); scene voice tracks are mixed with WebAudio.
 */
export async function recordPureCanvasProject(
  project: CanvasStudioProject,
  options: PureCanvasRecordOptions = {},
): Promise<Blob> {
  const errors = validateCanvasExportProject(project);
  if (errors.length) throw new Error(`Project chưa đủ điều kiện xuất thuần: ${errors[0]}`);
  if (typeof document === 'undefined') throw new Error('Xuất thuần Canvas cần chạy trong trình duyệt.');
  project = compileCanvasProjectLayout(project);
  const { assetOrigin, withAudio = true, onProgress, signal } = options;
  signal?.throwIfAborted();

  const fps = Math.max(1, Math.min(60, project.fps || 30));
  const totalMs = projectDurationMs(project.scenes);
  const { preloadCanvasSceneImages, renderCanvasScene } = await import('./renderer');
  for (const scene of project.scenes) {
    signal?.throwIfAborted();
    await preloadCanvasSceneImages(scene, assetOrigin);
  }

  const canvas = document.createElement('canvas');
  canvas.width = project.width;
  canvas.height = project.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Trình duyệt không cấp được Canvas 2D.');

  const mimeType = selectCanvasExportMimeType();
  if (!mimeType) throw new Error('Trình duyệt không hỗ trợ MediaRecorder để xuất thuần.');

  const stream = canvas.captureStream(fps);
  let audioContext: AudioContext | undefined;
  let voices: SceneVoice[] = [];
  let currentSceneId = '';
  if (withAudio && project.scenes.some((scene) => scene.audioUrl)) {
    audioContext = new AudioContext();
    if (audioContext.state === 'suspended') await audioContext.resume().catch(() => undefined);
    const destination = audioContext.createMediaStreamDestination();
    for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    voices = await attachSceneAudio(project, audioContext, destination, signal);
  }

  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];
  const done = new Promise<void>((resolve, reject) => {
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size) chunks.push(event.data);
    };
    recorder.onerror = () => reject(new Error('Ghi hình thuần Canvas thất bại.'));
    recorder.onstop = () => resolve();
    signal?.addEventListener('abort', () => {
      try { recorder.stop(); } catch { /* already stopped */ }
      reject(signal.reason instanceof Error ? signal.reason : new Error('Đã hủy xuất thuần Canvas.'));
    }, { once: true });
  });
  recorder.start(250);

  const stopTracks = () => {
    for (const track of stream.getTracks()) {
      try { track.stop(); } catch { /* already stopped */ }
    }
  };

  try {
    const start = performance.now();
    let lastSceneId = '';
    for (;;) {
      signal?.throwIfAborted();
      const elapsed = performance.now() - start;
      if (elapsed >= totalMs) break;
      const resolved = resolveProjectTime(project.scenes, elapsed);
      if (resolved.scene) {
        renderCanvasScene(ctx, resolved.scene, resolved.localTimeMs, project.width, project.height, assetOrigin);
        if (resolved.scene.id !== lastSceneId) {
          lastSceneId = resolved.scene.id;
          currentSceneId = resolved.scene.id;
          for (const voice of voices) {
            if (voice.sceneId === currentSceneId) {
              voice.element.currentTime = 0;
              void voice.element.play().catch(() => undefined);
            } else {
              voice.element.pause();
            }
          }
        }
      }
      onProgress?.(Math.min(totalMs, elapsed), totalMs);
      await new Promise((frame) => requestAnimationFrame(frame));
    }
    // Flush the tail so the last frame lands in the recording.
    const tail = resolveProjectTime(project.scenes, Math.max(0, totalMs - 1));
    if (tail.scene) renderCanvasScene(ctx, tail.scene, tail.localTimeMs, project.width, project.height, assetOrigin);
    onProgress?.(totalMs, totalMs);
    await new Promise((resolve) => setTimeout(resolve, 350));
  } finally {
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch { /* recorder already settled */ }
    for (const voice of voices) {
      try { voice.element.pause(); } catch { /* already paused */ }
    }
    if (audioContext) await audioContext.close().catch(() => undefined);
  }

  await done;
  stopTracks();
  return new Blob(chunks, { type: mimeType.split(';')[0] });
}
