import type { AnimationCommand, CompositeScene, Point, SceneLayer, Transform } from '../../shared/animationStudio';

export interface EvaluatedLayer extends SceneLayer { transform: Transform }
export interface EvaluatedScene { layers: EvaluatedLayer[]; camera: Transform }

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function ease(progress: number, easing: AnimationCommand['easing'] = 'linear') {
  const value = clamp01(progress);
  if (easing === 'ease-in') return value * value;
  if (easing === 'ease-out') return 1 - (1 - value) * (1 - value);
  if (easing === 'ease-in-out') return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
  return value;
}

const numberAt = (from: number, to: number, progress: number) => from + (to - from) * progress;
const pointAt = (from: Point, to: Point, progress: number): Point => ({ x: numberAt(from.x, to.x, progress), y: numberAt(from.y, to.y, progress) });
const isPoint = (value: unknown): value is Point => value !== null && typeof value === 'object' && 'x' in value && 'y' in value;

function commandProgress(command: AnimationCommand, timeMs: number) {
  if (timeMs < command.startMs) return undefined;
  if (command.durationMs === 0) return 1;
  return ease((timeMs - command.startMs) / command.durationMs, command.easing);
}

function activeProgress(command: AnimationCommand, timeMs: number) { if (timeMs < command.startMs || timeMs > command.startMs + command.durationMs) return undefined; return command.durationMs ? ease((timeMs - command.startMs) / command.durationMs, command.easing) : 1; }

export function evaluateTransform(base: Transform, commands: AnimationCommand[], timeMs: number): Transform {
  const result: Transform = { ...base, position: { ...base.position }, scale: { ...base.scale }, anchor: { ...base.anchor } };
  for (const command of commands) {
    const progress = commandProgress(command, timeMs);
    if (progress === undefined) continue;
    if (command.type === 'MOVE' && isPoint(command.from) && isPoint(command.to)) result.position = pointAt(command.from, command.to, progress);
    else if (['WALK', 'RUN'].includes(command.type) && isPoint(command.from) && isPoint(command.to)) result.position = pointAt(command.from, command.to, progress);
    else if (command.type === 'JUMP' && isPoint(command.from) && isPoint(command.to)) { const position = pointAt(command.from, command.to, progress); result.position = { x: position.x, y: position.y - Math.sin(progress * Math.PI) * Number(command.parameters?.height || 120) }; }
    else if (command.type === 'FALL' && isPoint(command.from) && isPoint(command.to)) result.position = pointAt(command.from, command.to, progress * progress);
    else if (command.type === 'SCALE' && isPoint(command.from) && isPoint(command.to)) result.scale = pointAt(command.from, command.to, progress);
    else if (command.type === 'ROTATE' && typeof command.from === 'number' && typeof command.to === 'number') result.rotation = numberAt(command.from, command.to, progress);
    else if (command.type === 'FADE_IN') result.opacity = numberAt(typeof command.from === 'number' ? command.from : 0, typeof command.to === 'number' ? command.to : 1, progress);
    else if (command.type === 'FADE_OUT') result.opacity = numberAt(typeof command.from === 'number' ? command.from : 1, typeof command.to === 'number' ? command.to : 0, progress);
    else if (command.type === 'ZOOM_IN') result.scale = pointAt(isPoint(command.from) ? command.from : { x: 1, y: 1 }, isPoint(command.to) ? command.to : { x: 1.15, y: 1.15 }, progress);
    else if (command.type === 'ZOOM_OUT') result.scale = pointAt(isPoint(command.from) ? command.from : { x: 1.15, y: 1.15 }, isPoint(command.to) ? command.to : { x: 1, y: 1 }, progress);
    else if (command.type === 'PAN_LEFT') result.position.x = numberAt(typeof command.from === 'number' ? command.from : 0, typeof command.to === 'number' ? command.to : -120, progress);
    else if (command.type === 'PAN_RIGHT') result.position.x = numberAt(typeof command.from === 'number' ? command.from : 0, typeof command.to === 'number' ? command.to : 120, progress);
    else if (command.type === 'SPAWN') result.opacity = progress;
    else if (command.type === 'DESPAWN') result.opacity = 1 - progress;
    else if (command.type === 'BOUNCE') { const baseY = typeof command.from === 'number' ? command.from : base.position.y; result.position.y = baseY - Math.abs(Math.sin(progress * Math.PI * 2)) * Number(command.parameters?.height || 70) * (1 - progress * .5); }
    else if (command.type === 'CAMERA_SHAKE') { const active = activeProgress(command, timeMs); if (active !== undefined) { const strength = Number(command.parameters?.strength || 18) * (1 - active); result.position.x += Math.sin(timeMs * .071) * strength; result.position.y += Math.cos(timeMs * .093) * strength; } }
    else if (command.type === 'FLASH') { const active = activeProgress(command, timeMs); if (active !== undefined) result.opacity = Math.max(result.opacity, Math.sin(active * Math.PI)); }
    else if (command.type === 'EXPLOSION') { const active = activeProgress(command, timeMs); if (active !== undefined) { const peak = Math.sin(active * Math.PI); result.scale = { x: base.scale.x * (1 + peak * .35), y: base.scale.y * (1 + peak * .35) }; result.opacity = 1 - active * .8; } }
  }
  return result;
}

export function evaluateScene(scene: CompositeScene, timeMs: number): EvaluatedScene {
  const boundedTime = Math.min(scene.durationMs, Math.max(0, timeMs));
  return {
    layers: scene.layers
      .filter((layer) => layer.visible)
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((layer) => ({ ...layer, transform: evaluateTransform(layer.transform, scene.commands.filter((command) => command.targetId === layer.id), boundedTime) })),
    camera: evaluateTransform(scene.camera.transform, scene.camera.commands, boundedTime),
  };
}
