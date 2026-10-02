import type { CanvasCameraMotion, CanvasMotion, CanvasShotType, CanvasStudioObject, CanvasStudioScene } from './types';
import { evaluateCanvasChoreographyOffset } from './choreography';
import { evaluateCameraKeyframes, evaluateObjectKeyframes } from './keyframes';

export type EvaluatedCanvasTransform = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
};

export type EvaluatedCanvasCamera = {
  focusX: number;
  focusY: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
};

export function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

export function easeOutCubic(value: number) {
  const t = clamp01(value);
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(value: number) {
  const t = clamp01(value);
  return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function easeOutBack(value: number) {
  const t = clamp01(value);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeOutQuint(value: number) {
  const t = clamp01(value);
  return 1 - Math.pow(1 - t, 5);
}

function objectEase(object: CanvasStudioObject, value: number) {
  if (object.motionCurve === 'smooth') return easeInOutCubic(value);
  if (object.motionCurve === 'elastic') return easeOutBack(value);
  if (object.motionCurve === 'snappy') return easeOutQuint(value);
  return easeOutCubic(value);
}

export function sceneProgress(scene: CanvasStudioScene, timeMs: number) {
  return clamp01(timeMs / Math.max(1, scene.durationMs));
}

function entranceProgress(object: CanvasStudioObject, timeMs: number) {
  const delay = Math.max(0, object.delayMs || 0);
  const duration = Math.max(120, object.motionDurationMs || 520);
  return objectEase(object, (timeMs - delay) / duration);
}

export function evaluateCanvasObject(
  object: CanvasStudioObject,
  scene: CanvasStudioScene,
  timeMs: number,
  attachmentChain: ReadonlySet<string> = new Set(),
): EvaluatedCanvasTransform {
  const t = Math.max(0, timeMs);
  if (object.environmentAnchor === 'doorway') {
    // A wall-mounted panel cannot translate away from its jamb. Its aperture
    // is evaluated separately by choreography; retain authored tracks in data.
    const keyed = evaluateObjectKeyframes(object.keyframes, t);
    return { x: object.x, y: object.y, scale: 1, rotation: 0, opacity: object.opacity * keyed.opacity };
  }
  const localT = Math.max(0, t - Math.max(0, object.delayMs || 0));
  const progress = sceneProgress(scene, t);
  const enter = entranceProgress(object, t);
  const intensity = Math.max(.2, Math.min(3, object.motionIntensity || 1));
  let x = object.x;
  let y = object.y;
  let scale = object.scale;
  let rotation = object.rotation;
  let opacity = object.opacity;

  const motion: CanvasMotion = object.motion || 'none';
  if (motion === 'slide-left') {
    x += (1 - enter) * -260 * intensity;
    opacity *= enter;
  } else if (motion === 'slide-right') {
    x += (1 - enter) * 260 * intensity;
    opacity *= enter;
  } else if (motion === 'slide-up') {
    y += (1 - enter) * 180 * intensity;
    opacity *= enter;
  } else if (motion === 'pop') {
    const anticipation = enter < .45 ? 1 - Math.sin((enter / .45) * Math.PI) * .06 * intensity : 1;
    scale *= (0.68 + 0.32 * enter) * anticipation;
    opacity *= enter;
  } else if (motion === 'float') {
    y += Math.sin(localT / (object.kind==='ship'?1100:420)) * (object.kind==='ship'?2.5:14) * intensity;
    rotation += Math.sin(localT / (object.kind==='ship'?1500:640)) * (object.kind==='ship'?.5:1.1) * intensity;
  } else if (motion === 'shake') {
    const strength = localT < 900 ? 8 : 3;
    x += Math.sin(localT / 31) * strength * intensity;
    rotation += Math.sin(localT / 47) * 1.4 * intensity;
  } else if (motion === 'drift-left') {
    const depthBoost = object.depth === 'foreground' ? 1.3 : object.depth === 'background' ? 0.6 : 1;
    x -= progress * 140 * intensity * depthBoost;
    y += Math.sin(progress * Math.PI * 2) * 6 * intensity;
  } else if (motion === 'drift-right') {
    const depthBoost = object.depth === 'foreground' ? 1.3 : object.depth === 'background' ? 0.6 : 1;
    x += progress * 140 * intensity * depthBoost;
    y += Math.sin(progress * Math.PI * 2) * 6 * intensity;
  } else if (motion === 'pulse') {
    scale *= 1 + Math.sin(localT / 220) * 0.05 * intensity;
  } else if (motion === 'bounce') {
    y -= Math.abs(Math.sin(localT / 260)) * 18 * intensity;
  } else if (motion === 'walk-left') {
    x -= progress * 180 * intensity;
    y -= Math.abs(Math.sin(localT / 150)) * 7 * intensity;
    rotation += Math.sin(localT / 150) * 1.8 * intensity;
  } else if (motion === 'walk-right') {
    x += progress * 180 * intensity;
    y -= Math.abs(Math.sin(localT / 150)) * 7 * intensity;
    rotation += Math.sin(localT / 150) * 1.8 * intensity;
  } else if (motion === 'hit') {
    const anticipation = Math.exp(-Math.pow((progress - .34) / .07, 2));
    const impact = Math.exp(-Math.pow((progress - .48) / .075, 2));
    x -= 18 * anticipation * intensity;
    x += Math.sin(localT / 16) * 14 * impact * intensity;
    rotation += Math.sin(localT / 21) * 9 * impact * intensity;
    scale *= 1 - anticipation * .035 + impact * .085 * intensity;
  } else if (motion === 'tilt-left') {
    rotation -= easeInOutCubic(progress) * 13 * intensity;
    y += easeInOutCubic(progress) * 14 * intensity;
  } else if (motion === 'tilt-right') {
    rotation += easeInOutCubic(progress) * 13 * intensity;
    y += easeInOutCubic(progress) * 14 * intensity;
  } else if (motion === 'fall') {
    const fall = easeInOutCubic(progress);
    y += fall * fall * 180 * intensity;
    rotation += fall * 32 * intensity;
    opacity *= progress > .92 ? Math.max(0, 1 - (progress - .92) / .08) : 1;
  }

  if (t < Math.max(0, object.delayMs || 0) && ['slide-left', 'slide-right', 'slide-up', 'pop'].includes(motion)) {
    opacity = 0;
  }

  const choreography = evaluateCanvasChoreographyOffset(object, scene, t);
  x += choreography.x;
  y += choreography.y;
  scale *= choreography.scale;
  rotation += choreography.rotation;
  opacity *= choreography.opacity;

  // Explicit keyframes are the general-purpose motion layer. They are relative
  // to semantic layout so authored slots can still be recompiled safely.
  const keyed = evaluateObjectKeyframes(object.keyframes, t);
  x += keyed.dx;
  y += keyed.dy;
  scale *= keyed.scale;
  rotation += keyed.rotation;
  opacity *= keyed.opacity;

  const boat=object.onBoat&&scene.objects.find(o=>o.id===object.onBoat&&o.kind==='ship');
  const chain=new Set(attachmentChain).add(object.id);
  if(boat&&!chain.has(boat.id)){
    const vessel=evaluateCanvasObject(boat,scene,timeMs,chain);
    const angle=vessel.rotation*Math.PI/180;
    const dx=x-boat.x,dy=y-boat.y;
    x=vessel.x+(dx*Math.cos(angle)-dy*Math.sin(angle))*vessel.scale;
    y=vessel.y+(dx*Math.sin(angle)+dy*Math.cos(angle))*vessel.scale;
    rotation+=vessel.rotation;scale*=vessel.scale;
  }
  const assistance=scene.animationBeats?.find(beat=>beat.action==='assist'&&beat.targetIds.includes(object.id)&&timeMs>=beat.atMs);
  const patient=assistance&&scene.objects.find(actor=>actor.kind==='character'&&actor.id===assistance.focusTargetId);
  if(patient&&!chain.has(patient.id)&&!object.keyframes?.some(frame=>frame.dx!==undefined||frame.dy!==undefined)){
    const supported=evaluateCanvasObject(patient,scene,timeMs,chain);
    x=object.x+supported.x-patient.x;y=object.y+supported.y-patient.y;
  }

  return { x, y, scale, rotation, opacity };
}

function shotScale(shot: CanvasShotType) {
  if (shot === 'medium') return 1.08;
  if (shot === 'close-up') return 1.24;
  if (shot === 'extreme-close-up') return 1.5;
  if (shot === 'pov') return 1.15;
  if (shot === 'diagram') return 1.04;
  if (shot === 'split') return 1.02;
  return 1;
}

export function evaluateCanvasCamera(scene: CanvasStudioScene, timeMs: number, width: number, height: number): EvaluatedCanvasCamera {
  const camera = scene.camera;
  const progress = sceneProgress(scene, timeMs);
  const motion: CanvasCameraMotion = camera?.motion || 'none';
  const base = Math.max(.8, Math.min(2, camera?.zoom || 1)) * shotScale(camera?.shot || 'wide');
  let scale = base;
  let offsetX = 0;
  let offsetY = 0;
  let rotation = 0;
  if (motion === 'push-in') scale *= 1 + progress * .14;
  else if (motion === 'pull-out') scale *= 1.14 - progress * .14;
  else if (motion === 'pan-left') offsetX = progress * 120;
  else if (motion === 'pan-right') offsetX = -progress * 120;
  else if (motion === 'follow') {
    offsetX = Math.sin(progress * Math.PI) * -70;
    scale *= 1 + Math.sin(progress * Math.PI) * .05;
  } else if (motion === 'impact') {
    const burst = Math.exp(-Math.pow((progress - .48) / .08, 2));
    scale *= 1 + burst * .12;
    offsetX += Math.sin(timeMs / 16) * 11 * burst;
    offsetY += Math.sin(timeMs / 21) * 8 * burst;
    rotation += Math.sin(timeMs / 19) * 1.3 * burst;
  }

  // Frame-addressable camera choreography layers cleanly over the lightweight
  // preset motion, mirroring code-first video systems that interpolate tracks.
  const keyedCamera = evaluateCameraKeyframes(camera?.keyframes, timeMs);
  offsetX += keyedCamera.dx;
  offsetY += keyedCamera.dy;
  scale *= keyedCamera.zoom;
  rotation += keyedCamera.rotation;

  const focusX = Math.max(0, Math.min(width, camera?.focusX ?? width / 2));
  const focusY = Math.max(0, Math.min(height, camera?.focusY ?? height / 2));
  const physicalShot=scene.template&&scene.animationBeats?.some(beat=>['run','row','brace','celebrate','aid','assist','reach','tie','wipe','write'].includes(beat.action));
  const actors=physicalShot?scene.objects.filter(o=>o.kind==='character'&&o.role!=='background'&&o.depth!=='background'):[];
  if(actors.length){
    // Reserve the whole action area, including feet and authored travel, for
    // physical scenes. A portrait crop must not hide the action below the waist.
    const bounds=actors.map(actor=>{
      const frames=actor.keyframes||[],fit=Math.min(actor.width/68,actor.height/100);
      const size=Math.max(actor.scale||1,...frames.map(k=>k.scale??1));
      const xs=[0,...frames.map(k=>k.dx??0)],ys=[0,...frames.map(k=>k.dy??0)];
      return {left:actor.x+Math.min(...xs)-actor.width*.6*size,right:actor.x+Math.max(...xs)+actor.width*.6*size,
        top:actor.y+Math.min(...ys)-fit*70*size,bottom:actor.y+Math.max(...ys)+fit*60*size};
    });
    const left=Math.min(...bounds.map(b=>b.left)),right=Math.max(...bounds.map(b=>b.right));
    const top=Math.min(...bounds.map(b=>b.top)),bottom=Math.max(...bounds.map(b=>b.bottom));
    const safeScale=Math.min((width-48)/Math.max(1,right-left),(height-48)/Math.max(1,bottom-top));
    scale=Math.min(scale,Math.max(1,safeScale));
    offsetX+=width/2-focusX-scale*((left+right)/2-focusX);
    offsetY+=height/2-focusY-scale*((top+bottom)/2-focusY);
  }
  const angle = rotation * Math.PI / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Reserve a stable crop for pans so keeping the background in view does not
  // turn a wide shot into a stationary camera or zoom in during the movement.
  const panMargin = motion === 'pan-left' || motion === 'pan-right' ? 120 : motion === 'follow' ? 70 : 0;
  scale = Math.max(scale, 1 + 2 * panMargin / width,
    (Math.abs(cos) * width + Math.abs(sin) * height) / width,
    (Math.abs(sin) * width + Math.abs(cos) * height) / height);

  // Inverse-transform the viewport center, then constrain its rotated footprint
  // to the scene bounds. Preview, pointer mapping and both exporters share this.
  const halfViewWidth = (Math.abs(cos) * width + Math.abs(sin) * height) / (2 * scale);
  const halfViewHeight = (Math.abs(sin) * width + Math.abs(cos) * height) / (2 * scale);
  const dx = width / 2 - focusX - offsetX;
  const dy = height / 2 - focusY - offsetY;
  const centerX = focusX + (dx * cos + dy * sin) / scale;
  const centerY = focusY + (-dx * sin + dy * cos) / scale;
  const correctionX = centerX - Math.max(halfViewWidth, Math.min(width - halfViewWidth, centerX));
  const correctionY = centerY - Math.max(halfViewHeight, Math.min(height - halfViewHeight, centerY));
  offsetX += scale * (correctionX * cos - correctionY * sin);
  offsetY += scale * (correctionX * sin + correctionY * cos);

  return {
    focusX,
    focusY,
    scale,
    offsetX,
    offsetY,
    rotation,
  };
}

export function projectDurationMs(scenes: CanvasStudioScene[]) {
  return scenes.reduce((total, scene) => total + Math.max(250, scene.durationMs), 0);
}

export function resolveProjectTime(scenes: CanvasStudioScene[], projectTimeMs: number) {
  const total = projectDurationMs(scenes);
  const safeTime = Math.min(Math.max(0, projectTimeMs), Math.max(0, total - 0.001));
  let offset = 0;
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    if (!scene) continue;
    const end = offset + Math.max(250, scene.durationMs);
    if (safeTime < end || index === scenes.length - 1) {
      return {
        scene,
        sceneIndex: index,
        localTimeMs: Math.max(0, safeTime - offset),
        sceneStartMs: offset,
        totalDurationMs: total,
      };
    }
    offset = end;
  }
  return {
    scene: scenes[0] ?? null,
    sceneIndex: 0,
    localTimeMs: 0,
    sceneStartMs: 0,
    totalDurationMs: total,
  };
}
