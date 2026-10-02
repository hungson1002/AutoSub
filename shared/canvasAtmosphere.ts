import type {CanvasStudioObject} from './canvasAnimationStudio';

/** A visible two-short / one-long call and its one-long / two-short reply. */
export function canvasLampLight(object: Pick<CanvasStudioObject,'lightLevel'|'lightSignal'>, timeMs: number) {
  const base = Math.max(0, Math.min(1, object.lightLevel ?? 1));
  if (!object.lightSignal) return base * (.97 + .03 * Math.sin(timeMs / 137));
  const elapsed = timeMs + (object.lightSignal.offsetMs || 0);
  const phase = ((elapsed % 5200) + 5200) % 5200;
  const ranges = object.lightSignal.pattern === 'distress'
    ? [[0,400],[800,1200],[2400,3800]] : [[0,1400],[2400,2800],[3200,3600]];
  return ranges.some(([a,b]) => phase >= a! && phase < b!) ? base : 0;
}

/** Deterministic frame-addressable current; no timers or per-frame randomness. */
export function canvasWaterPhase(timeMs: number, row: number, intensity = 1) {
  const strength = Math.max(0, Math.min(2, intensity));
  if(!strength)return {dx:0,dy:0};
  return {dx: timeMs / 1000 * (16 + row * 3) * strength,
    dy: Math.sin(timeMs / 530 + row * .83) * (1.2 + row * .3) * strength};
}
