import type {
  CanvasCameraKeyframe,
  CanvasKeyframeEase,
  CanvasObjectKeyframe,
} from './types';

export type EvaluatedObjectKeyframe = {
  bandageProgress?: number;
  dx: number;
  dy: number;
  scale: number;
  rotation: number;
  opacity: number;
  doorOpen?: number;
  boxOpen?: number;
  lightLevel?: number;
  revealProgress?: number;
  pose?: CanvasObjectKeyframe['pose'];
  expression?: CanvasObjectKeyframe['expression'];
  facing?: CanvasObjectKeyframe['facing'];
  lookAtId?: string;
};

export type EvaluatedCameraKeyframe = {
  dx: number;
  dy: number;
  zoom: number;
  rotation: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function ease(value: number, easing: CanvasKeyframeEase | undefined) {
  const t = clamp01(value);
  if (easing === 'hold') return 0;
  if (easing === 'ease-in') return t * t * t;
  if (easing === 'ease-out' || easing === 'snappy') return 1 - Math.pow(1 - t, easing === 'snappy' ? 5 : 3);
  if (easing === 'ease-in-out') return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  if (easing === 'elastic') {
    if (t === 0 || t === 1) return t;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - .75) * c4) + 1;
  }
  return t;
}

function ordered<T extends { atMs: number }>(frames: T[] | undefined) {
  return [...(frames || [])]
    .filter((frame) => Number.isFinite(frame.atMs))
    .sort((a, b) => a.atMs - b.atMs);
}

function segment<T extends { atMs: number; easing?: CanvasKeyframeEase }>(frames: T[], timeMs: number) {
  if (!frames.length) return undefined;
  if (timeMs <= frames[0]!.atMs) return { before: undefined, from: frames[0]!, to: frames[0]!, t: 1 };
  const last = frames.at(-1)!;
  if (timeMs >= last.atMs) return { before: frames.at(-2), from: last, to: last, t: 1 };
  for (let index = 0; index < frames.length - 1; index += 1) {
    const from = frames[index]!;
    const to = frames[index + 1]!;
    if (timeMs < from.atMs || timeMs > to.atMs) continue;
    const duration = Math.max(1, to.atMs - from.atMs);
    return {
      before: index > 0 ? frames[index - 1] : undefined,
      from,
      to,
      t: ease((timeMs - from.atMs) / duration, to.easing || from.easing),
    };
  }
  return { before: undefined, from: last, to: last, t: 1 };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function trackNumber<T extends { atMs: number; easing?: CanvasKeyframeEase }>(
  frames: T[], key: keyof T, timeMs: number, fallback: number,
) {
  const track = frames.filter(frame => frame[key] !== undefined && Number.isFinite(Number(frame[key])));
  if (!track.length) return fallback;
  const first = track[0]!;
  if (first.atMs > 0) track.unshift({ ...first, atMs: 0, [key]: fallback });
  const current = segment(track, timeMs)!;
  return lerp(Number(current.from[key]), Number(current.to[key]), current.t);
}

function heldState<T extends { atMs: number }>(frames: T[], timeMs: number, key: keyof T) {
  let value: T[keyof T] | undefined;
  for (const frame of frames) {
    if (frame.atMs > timeMs) break;
    if (frame[key] !== undefined) value = frame[key];
  }
  return value;
}

export function evaluateObjectKeyframes(
  frames: CanvasObjectKeyframe[] | undefined,
  timeMs: number,
): EvaluatedObjectKeyframe {
  const list = ordered(frames);
  if (!list.length) return { dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1 };
  // Numeric channels are independent: an expression key cannot reset travel
  // or visibility after that channel's last authored value.
  return {
    dx: trackNumber(list, 'dx', timeMs, 0),
    dy: trackNumber(list, 'dy', timeMs, 0),
    scale: Math.max(.01, trackNumber(list, 'scale', timeMs, 1)),
    rotation: trackNumber(list, 'rotation', timeMs, 0),
    opacity: Math.max(0, Math.min(1, trackNumber(list, 'opacity', timeMs, 1))),
    doorOpen: list.some(frame => frame.doorOpen !== undefined)
      ? clamp01(trackNumber(list, 'doorOpen', timeMs, 0)) : undefined,
    lightLevel: list.some(frame => frame.lightLevel !== undefined)
      ? clamp01(trackNumber(list, 'lightLevel', timeMs, 1)) : undefined,
    revealProgress: list.some(frame => frame.revealProgress !== undefined)
      ? clamp01(trackNumber(list, 'revealProgress', timeMs, 0)) : undefined,
    bandageProgress: list.some(frame => frame.bandageProgress !== undefined)
      ? clamp01(trackNumber(list, 'bandageProgress', timeMs, 0)) : undefined,
    boxOpen: list.some(frame => frame.boxOpen !== undefined)
      ? clamp01(trackNumber(list, 'boxOpen', timeMs, 0)) : undefined,
    pose: heldState(list, timeMs, 'pose') as EvaluatedObjectKeyframe['pose'],
    expression: heldState(list, timeMs, 'expression') as EvaluatedObjectKeyframe['expression'],
    facing: heldState(list, timeMs, 'facing') as EvaluatedObjectKeyframe['facing'],
    lookAtId: heldState(list, timeMs, 'lookAtId') as string | undefined,
  };
}

export function evaluateCameraKeyframes(
  frames: CanvasCameraKeyframe[] | undefined,
  timeMs: number,
): EvaluatedCameraKeyframe {
  const list = ordered(frames);
  if (!list.length) return { dx: 0, dy: 0, zoom: 1, rotation: 0 };
  return {
    dx: trackNumber(list, 'dx', timeMs, 0),
    dy: trackNumber(list, 'dy', timeMs, 0),
    zoom: Math.max(.05, trackNumber(list, 'zoom', timeMs, 1)),
    rotation: trackNumber(list, 'rotation', timeMs, 0),
  };
}
