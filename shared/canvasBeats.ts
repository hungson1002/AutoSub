import type {
  CanvasAnimationAction,
  CanvasAnimationBeat,
  CanvasStudioScene,
} from './canvasAnimationStudio';

export type LipSyncWindow = { startMs: number; endMs: number };

export const CANVAS_BEAT_ACTIONS: CanvasAnimationAction[] = [
  'talk', 'point', 'react', 'celebrate', 'brace',
  'run', 'row', 'reveal', 'impact', 'float', 'pulse',
  'reach','wipe','write','tie','aid','assist','grab','struggle','sink','surface',
];

/** Cadence used to carve natural pauses into a talk beat. Pure + deterministic. */
const TALK_CHUNK_MS = 380;
const TALK_PAUSE_MS = 90;

const clampInt = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
};

export function createCanvasBeat(
  scene: Pick<CanvasStudioScene, 'durationMs' | 'objects'>,
  overrides: Partial<CanvasAnimationBeat> = {},
): CanvasAnimationBeat {
  const firstTarget = scene.objects[0]?.id || '';
  return {
    id: `beat-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    atMs: 0,
    durationMs: Math.min(1500, Math.max(250, scene.durationMs)),
    action: 'talk',
    targetIds: firstTarget ? [firstTarget] : [],
    intensity: 1,
    ...overrides,
  };
}

export function validateCanvasBeat(
  scene: Pick<CanvasStudioScene, 'durationMs' | 'objects'>,
  beat: CanvasAnimationBeat,
): string[] {
  const issues: string[] = [];
  if (!beat.id.trim()) issues.push('Beat cần id.');
  if (!CANVAS_BEAT_ACTIONS.includes(beat.action)) issues.push(`Action ${beat.action} không hỗ trợ.`);
  if (!Number.isFinite(beat.atMs) || beat.atMs < 0) issues.push('atMs phải >= 0.');
  if (!Number.isFinite(beat.durationMs) || beat.durationMs < 120) issues.push('durationMs tối thiểu 120ms.');
  if (beat.atMs + beat.durationMs > scene.durationMs + 1) issues.push('Beat vượt quá thời lượng scene.');
  const known = new Set(scene.objects.map((item) => item.id));
  if (!beat.targetIds.length) issues.push('Beat cần ít nhất 1 target.');
  for (const target of beat.targetIds) {
    if (!known.has(target)) issues.push(`Target ${target} không có trong scene.`);
  }
  if (beat.intensity !== undefined && (!Number.isFinite(beat.intensity) || beat.intensity < 0.2 || beat.intensity > 2.5)) {
    issues.push('intensity phải trong khoảng 0.2–2.5.');
  }
  return issues;
}

export function clampBeatToScene(
  scene: Pick<CanvasStudioScene, 'durationMs'>,
  beat: CanvasAnimationBeat,
): CanvasAnimationBeat {
  const atMs = clampInt(beat.atMs, 0, Math.max(0, scene.durationMs - 120));
  const durationMs = clampInt(beat.durationMs, 120, Math.max(120, scene.durationMs - atMs));
  return { ...beat, atMs, durationMs };
}

/**
 * Convert talk beats into voice-activity windows with natural pauses.
 * Scenes without talk beats return [] so the renderer keeps legacy behavior.
 */
export function buildLipSyncFromBeats(
  beats: CanvasAnimationBeat[] | undefined,
  sceneDurationMs: number,
): LipSyncWindow[] {
  const windows: LipSyncWindow[] = [];
  for (const beat of beats || []) {
    if (beat.action !== 'talk') continue;
    const start = Math.max(0, beat.atMs);
    const end = Math.min(sceneDurationMs, beat.atMs + Math.max(120, beat.durationMs));
    let cursor = start;
    while (cursor < end - 60) {
      const chunkEnd = Math.min(end, cursor + TALK_CHUNK_MS);
      windows.push({ startMs: Math.round(cursor), endMs: Math.round(chunkEnd) });
      cursor = chunkEnd + TALK_PAUSE_MS;
    }
  }
  return windows.sort((a, b) => a.startMs - b.startMs);
}

/** Resolve effective voice windows: explicit lipSync wins, otherwise derive from talk beats. */
export function resolveVoiceWindows(scene: Pick<CanvasStudioScene, 'lipSync' | 'animationBeats' | 'durationMs'>): LipSyncWindow[] | undefined {
  if (scene.lipSync && scene.lipSync.length) return scene.lipSync;
  const derived = buildLipSyncFromBeats(scene.animationBeats, scene.durationMs);
  return derived.length ? derived : undefined;
}

export function isVoiceActiveAt(windows: LipSyncWindow[] | undefined, timeMs: number): boolean {
  // No voice data -> legacy behavior: keep animating so old projects render unchanged.
  if (!windows) return true;
  return windows.some((window) => timeMs >= window.startMs && timeMs <= window.endMs);
}

/** Phoneme-like mouth openness. Closed-ish when no voice is active. */
export function mouthOpenAmount(timeMs: number, voiceActive: boolean): number {
  if (!voiceActive) return 0.05;
  const phonemes = [0.24, 0.07, 0.17, 0.05, 0.2, 0.1, 0.15, 0.06];
  const step = Math.floor(Math.max(0, timeMs) / 110) % phonemes.length;
  return phonemes[step] ?? 0.12;
}
