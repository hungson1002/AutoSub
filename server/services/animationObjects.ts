import { defaultTransform, type SceneLayer, type AnimationCommand } from '../../shared/animationStudio';

export type AnimatedObject = { name: string; shape: 'ellipse' | 'rectangle'; fill: string; width: number; height: number; path: Array<{ t: number; x: number; y: number; rotation: number }> };
export function normalizeAnimatedObjects(value: unknown): AnimatedObject[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 8).flatMap((o) => {
    if (!o || typeof o.name !== 'string' || !['ellipse', 'rectangle'].includes(o.shape) || !/^#[a-f0-9]{6}$/i.test(o.fill) || ![o.width, o.height].every((n) => Number.isFinite(n) && n >= .01 && n <= .6) || !Array.isArray(o.path)) return [];
    const points: Array<{ t: number; x: number; y: number; rotation?: number }> = o.path.slice(0, 24);
    if (points.length < 2 || points[0]?.t !== 0 || points.at(-1)?.t !== 1 || points.some((p, i) => !p || ![p.t, p.x, p.y, p.rotation ?? 0].every(Number.isFinite) || p.t < 0 || p.t > 1 || p.x < o.width / 2 || p.x > 1 - o.width / 2 || p.y < o.height / 2 || p.y > .85 - o.height / 2 || (i > 0 && p.t <= points[i - 1].t))) return [];
    return [{ name: o.name.slice(0, 80), shape: o.shape, fill: o.fill, width: o.width, height: o.height, path: points.map((p) => ({ t: p.t, x: p.x, y: p.y, rotation: p.rotation ?? 0 })) }];
  });
}

export function buildAnimatedObjects(objects: AnimatedObject[], prefix: string, start: number, end: number, width: number, height: number) {
  const layers: SceneLayer[] = []; const commands: AnimationCommand[] = [];
  objects.forEach((o, index) => {
    const id = `${prefix}-object-${index}`; const first = o.path[0];
    layers.push({ id, name: o.name, type: 'shape', shape: o.shape, fill: o.fill, width: o.width * width, height: o.height * height, visible: true, locked: false, zIndex: 90 + index, transform: { ...defaultTransform(), opacity: 0, rotation: first.rotation, position: { x: first.x * width, y: first.y * height } } });
    commands.push({ id: `${id}-in`, type: 'FADE_IN', targetId: id, startMs: start, durationMs: 1 }, { id: `${id}-out`, type: 'FADE_OUT', targetId: id, startMs: end - 1, durationMs: 1 });
    o.path.slice(1).forEach((point, i) => {
      const before = o.path[i]; const at = start + Math.round((end - start - 1) * before.t); const until = start + Math.round((end - start - 1) * point.t);
      if (until <= at) return;
      if (before.x !== point.x || before.y !== point.y) commands.push({ id: `${id}-move-${i}`, type: 'MOVE', targetId: id, startMs: at, durationMs: until - at, easing: 'linear', from: { x: before.x * width, y: before.y * height }, to: { x: point.x * width, y: point.y * height } });
      if (before.rotation !== point.rotation) commands.push({ id: `${id}-rotate-${i}`, type: 'ROTATE', targetId: id, startMs: at, durationMs: until - at, easing: 'linear', from: before.rotation, to: point.rotation });
    });
  });
  return { layers, commands };
}

export const animationObjectRules = `For educational motion graphics, visualBeats may contain objects:[{name,shape:"ellipse|rectangle",fill:"#RRGGBB",width:0.12,height:0.12,path:[{t:0,x:0.2,y:0.4,rotation:0},{t:1,x:0.7,y:0.4,rotation:0}]}]. Width/height/positions are fractions of canvas; t spans 0..1 within the beat. Provide 2–24 strictly increasing path points for real travel/orbits/rotation. Keep objects fully inside canvas above subtitle area y=.85. Use up to 8 meaningful independently moving shapes per beat to explain forces, trajectories, shadows, size comparisons or mechanisms. Compose multiple parts where useful. These are clean vector diagrams, NOT realistic humans/animals; never substitute basic shapes for requested character animation. No arbitrary decorative motion to pass quality checks. Background prompts must omit these composited objects. Prefer diagram-only beats (empty visual) for self-contained schematics. Existing sprite actors remain available. Establishing/detail illustrations may be still; an explanation/action must have appropriate object motion, a staged diagram, or a valid sprite performance.`;
