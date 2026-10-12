import type { CanvasAnimationBeat, CanvasStudioObject, CanvasStudioScene } from './types';
import type { EvaluatedCanvasTransform } from './runtime';
import { folkCharacterScale } from '../../shared/canvasFolkHorror';
import { evaluateObjectKeyframes } from './keyframes';

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => { const t = clamp01(value); return t * t * (3 - 2 * t); };

export function isProceduralLongSpirit(object: CanvasStudioObject) {
  return object.kind === 'character' && object.appearance === 'long-limbed-spirit'
    && !object.imageUrl && !object.sprite && !object.spriteActs?.length;
}

export function resolveFolkGrip(scene: CanvasStudioScene, source: CanvasStudioObject, timeMs: number) {
  if (!isProceduralLongSpirit(source)) return undefined;
  const events = (scene.animationBeats || []).filter(beat => beat.targetIds.includes(source.id)
    && ['grab', 'pull', 'release'].includes(beat.action) && beat.atMs <= timeMs)
    .sort((a, b) => a.atMs - b.atMs);
  const grab = events.filter(beat => beat.action === 'grab').at(-1);
  if (!grab?.focusTargetId) return undefined;
  const victim = scene.objects.find(object => object.id === grab.focusTargetId && object.kind === 'character');
  if (!victim) return undefined;
  const release = events.find(beat => beat.action === 'release' && beat.atMs >= grab.atMs);
  const extension = smooth((timeMs - grab.atMs) / Math.max(120, grab.durationMs));
  const progress = release ? extension * (1 - smooth((timeMs - release.atMs) / Math.max(120, release.durationMs))) : extension;
  return { victim, progress, wrapped: !release && extension >= .999 };
}

/** The fallen state holds after pull/release; ending a beat cannot stand the victim back up. */
export function evaluateFolkVictimPull(object: CanvasStudioObject, scene: CanvasStudioScene, timeMs: number) {
  const pull = (scene.animationBeats || []).filter(beat => beat.action === 'pull'
    && beat.focusTargetId === object.id && beat.atMs <= timeMs
    && scene.objects.some(source => beat.targetIds.includes(source.id) && isProceduralLongSpirit(source)))
    .sort((a, b) => a.atMs - b.atMs).at(-1);
  if (!pull) return { x: 0, y: 0, rotation: 0 };
  const source = scene.objects.find(candidate => pull.targetIds.includes(candidate.id) && isProceduralLongSpirit(candidate))!;
  const grip = scene.animationBeats?.some(beat => beat.action === 'grab' && beat.atMs <= pull.atMs
    && beat.targetIds.includes(source.id) && beat.focusTargetId === object.id);
  if (!grip) return { x: 0, y: 0, rotation: 0 };
  const direction = source.x < object.x ? -1 : 1;
  // A pull is a short physical jerk followed by a held fall, even when the
  // spoken phrase spans several seconds. Do not stretch the fall over it all.
  const progress = smooth((timeMs - pull.atMs) / Math.max(120, Math.min(1100, pull.durationMs)));
  const endMs = pull.atMs + pull.durationMs;
  const from = evaluateObjectKeyframes(object.keyframes, pull.atMs);
  const to = evaluateObjectKeyframes(object.keyframes, endMs);
  const current = evaluateObjectKeyframes(object.keyframes, timeMs);
  const authoredFall = Math.abs(object.rotation + to.rotation) >= 60;
  // Static placement and walking completed before contact are not fall tracks.
  const authored = (property: 'dx' | 'dy' | 'rotation') => Math.abs(to[property] - from[property]) > .001
    || object.keyframes?.some(frame => frame.atMs > pull.atMs && frame.atMs < endMs
      && frame[property] !== undefined && Math.abs(frame[property]! - from[property]) > .001) === true;
  const scale = folkCharacterScale(object);
  const descent = Number.isFinite(object.groundY)
    ? object.groundY! - scale * 22 - object.y - current.dy : scale * 25;
  return {
    x: authoredFall && authored('dx') ? 0 : direction * Math.min(Math.abs(source.x - object.x) * .18, object.height * .3) * progress,
    y: authoredFall && authored('dy') ? 0 : descent * progress,
    rotation: authoredFall && authored('rotation') ? 0 : (direction * 88 - object.rotation - current.rotation) * progress,
  };
}

export type FolkPoint = { x: number; y: number };
export function folkWorldPoint(object: CanvasStudioObject, frame: EvaluatedCanvasTransform, x: number, y: number): FolkPoint {
  const scale = folkCharacterScale(object) * frame.scale;
  const angle = frame.rotation * Math.PI / 180;
  const localX = x * scale * (object.facing === 'left' ? -1 : 1), localY = y * scale;
  return { x: frame.x + localX * Math.cos(angle) - localY * Math.sin(angle),
    y: frame.y + localX * Math.sin(angle) + localY * Math.cos(angle) };
}

export function folkLimbGeometry(source: CanvasStudioObject, sourceFrame: EvaluatedCanvasTransform,
  victim: CanvasStudioObject | undefined, victimFrame: EvaluatedCanvasTransform | undefined, progress: number, side: -1 | 1) {
  const start = folkWorldPoint(source, sourceFrame, side * 7, -9);
  const rest = folkWorldPoint(source, sourceFrame, side * 13, 85);
  const contact = victim && victimFrame ? folkWorldPoint(victim, victimFrame, side * 3, -19) : rest;
  const t = clamp01(progress);
  const end = { x: rest.x + (contact.x - rest.x) * t, y: rest.y + (contact.y - rest.y) * t };
  const sag = Math.min(70, Math.abs(end.x - start.x) * .16) * t;
  return { start, end, contact, control: { x: start.x + (end.x - start.x) * .45 + side * 8,
    y: start.y + (end.y - start.y) * .72 + sag } };
}

export function folkContactIssues(scene: CanvasStudioScene): string[] {
  const problems: string[] = [];
  for (const beat of scene.animationBeats || []) {
    if (!['grab', 'pull'].includes(beat.action)) continue;
    const source = scene.objects.find(object => beat.targetIds.includes(object.id) && isProceduralLongSpirit(object));
    if (!source) continue;
    const victim = scene.objects.find(object => object.id === beat.focusTargetId && object.kind === 'character' && object.id !== source.id);
    if (!victim) problems.push(`${source.label}: ${beat.action} cần focusTargetId của nạn nhân trong cảnh.`);
    else if (beat.action === 'pull' && !(scene.animationBeats || []).some((grab: CanvasAnimationBeat) =>
      grab.action === 'grab' && grab.targetIds.includes(source.id) && grab.focusTargetId === victim.id
      && grab.atMs + grab.durationMs <= beat.atMs)) {
      problems.push(`${source.label}: phải chạm và quấn xong trước khi pull nạn nhân.`);
    }
  }
  return problems;
}
