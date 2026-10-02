import type {
  CanvasAnimationBeat,
  CanvasStudioObject,
  CanvasStudioScene,
} from './types';
import { evaluateObjectKeyframes } from './keyframes';
import { isCanvasDialogueSpeaker } from '../../shared/canvasDialogue';

export type CanvasChoreographyOffset = {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
};

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function easeOutCubic(value: number) {
  const t = clamp01(value);
  return 1 - Math.pow(1 - t, 3);
}

function easeInOutCubic(value: number) {
  const t = clamp01(value);
  return t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function beatProgress(beat: CanvasAnimationBeat, timeMs: number) {
  const local = timeMs - Math.max(0, beat.atMs);
  return clamp01(local / Math.max(120, beat.durationMs));
}

function activeBeats(scene: CanvasStudioScene, objectId: string, timeMs: number) {
  return (scene.animationBeats || []).filter((beat) =>
    beat.targetIds.includes(objectId)
    && timeMs >= beat.atMs
    && timeMs <= beat.atMs + beat.durationMs,
  );
}

/** Ease limbs into and out of authored actions without changing speech timing. */
export function canvasActingTiming(object: CanvasStudioObject, scene: CanvasStudioScene, timeMs: number) {
  const actions: Record<string, string> = {grab:'reach',struggle:'struggle',sink:'struggle',surface:'idle',talk: 'talk', point: 'point', react: 'brace', brace: 'brace', run: 'run', row: 'row', celebrate: 'celebrate',reach:'reach',wipe:'wipe',write:'write',tie:'tie',aid:'aid',assist:'assist' };
  const beat = scene.animationBeats?.filter(item=>item.targetIds.includes(object.id)&&item.atMs<=timeMs&&actions[item.action]===object.pose)
    .sort((a,b)=>a.atMs-b.atMs).at(-1);
  if (!beat) return { weight: 1, localMs: timeMs };
  const elapsed = timeMs - beat.atMs;
  const localMs = Math.min(elapsed,beat.durationMs);
  const ramp = Math.min(320, beat.durationMs / 3);
  const source=scene.objects.find(actor=>actor.id===object.id)||object;
  const nextPose=evaluateObjectKeyframes(source.keyframes,beat.atMs+beat.durationMs+1).pose||source.pose;
  const walkingTrack=object.pose==='run'&&nextPose==='run'&&source.keyframes?.some(frame=>frame.dx!==undefined&&frame.dx!==0);
  const hold=beat.action==='grab'||(['aid','assist','tie','wipe','write','reach'].includes(object.pose||'')&&nextPose===object.pose)||walkingTrack;
  if(hold)return {localMs,weight:easeInOutCubic(localMs/ramp)};
  if(elapsed>=beat.durationMs)return {localMs,weight:0};
  return { localMs, weight: easeInOutCubic(localMs / ramp) * easeInOutCubic((beat.durationMs - localMs) / ramp) };
}

export function applyCanvasChoreographyState(
  object: CanvasStudioObject,
  scene: CanvasStudioScene,
  timeMs: number,
): CanvasStudioObject {
  const beats = activeBeats(scene, object.id, timeMs).sort((a,b) => Number(!a.id.startsWith('voice-')) - Number(!b.id.startsWith('voice-')));
  const keyed = evaluateObjectKeyframes(object.keyframes, timeMs);
  const speaker = scene.dialogue?.find(line => timeMs >= (line.atMs || 0) && timeMs < (line.atMs || 0) + (line.durationMs || 0));
  const speakerObject = speaker && scene.objects.find(actor => actor.kind === 'character' && isCanvasDialogueSpeaker(actor,speaker));
  let lookAtId = object.lookAtId || (speakerObject?.id !== object.id ? speakerObject?.id : undefined);
  const grip=scene.animationBeats?.find(beat=>beat.action==='grab'&&beat.targetIds.includes(object.id)&&timeMs>=beat.atMs);
  if(grip)lookAtId=grip.focusTargetId;
  // A held physical pose must keep its contact anchor after the cue window.
  // Otherwise an aid/tie pose falls back to a generic raised arm mid-scene.
  const heldPose=keyed.pose||object.pose;
  const heldContact=scene.animationBeats?.filter(beat=>beat.targetIds.includes(object.id)&&beat.atMs<=timeMs
    &&beat.action===heldPose&&['aid','assist','tie','wipe','write','reach'].includes(beat.action)&&beat.focusTargetId)
    .sort((a,b)=>a.atMs-b.atMs).at(-1);
  if(heldContact)lookAtId=heldContact.action==='assist'&&heldContact.focusTargetId===object.id
    ?heldContact.targetIds.find(id=>id!==object.id&&scene.objects.some(o=>o.id===id&&o.kind==='character')):heldContact.focusTargetId;
  if (!beats.length) {
    return {
      ...object,
      pose: grip?'reach':keyed.pose || ((object.motion==='walk-left'||object.motion==='walk-right') && (!object.pose||object.pose==='idle')?'run':object.pose),
      expression: keyed.expression || object.expression,
      facing: keyed.facing || object.facing,
      lookAtId,
      doorOpen: keyed.doorOpen ?? object.doorOpen,
      lightLevel: keyed.lightLevel ?? object.lightLevel,
      boxOpen: keyed.boxOpen ?? object.boxOpen,
      bandageProgress: keyed.bandageProgress ?? object.bandageProgress,
    };
  }

  let pose = object.pose;
  let expression = object.expression;
  for (const beat of beats) {
    if (beat.focusTargetId) lookAtId = beat.action==='assist'&&beat.focusTargetId===object.id
      ? beat.targetIds.find(id=>id!==object.id&&scene.objects.some(o=>o.id===id&&o.kind==='character'))
      : beat.focusTargetId;
    if(beat.action==='grab')pose='reach';
    else if(beat.action==='struggle'||beat.action==='sink')pose=object.appearance==='water-spirit'?'reach':'struggle';
    else if (beat.action === 'talk') {
      // Speech changes the face, not a seated/walking/pointing body or its mood.
      pose = !object.pose || object.pose==='idle' || object.pose==='talk' ? 'talk' : object.pose;
    } else if (beat.action === 'point') {
      pose = 'point';
    } else if (beat.action === 'react') {
      pose = object.pose === 'run' ? object.pose : 'brace';
      expression = 'surprised';
    } else if (beat.action === 'celebrate') {
      pose = 'celebrate';
      expression = 'happy';
    } else if (beat.action === 'brace') {
      pose = 'brace';
    } else if (beat.action === 'run') {
      pose = 'run';
    } else if (beat.action === 'row') {
      pose = 'row';
    } else if (['reach','wipe','write','tie','aid','assist'].includes(beat.action)) {
      pose = beat.action as CanvasStudioObject['pose'];
    }
  }

  return {
    ...object,
    pose: keyed.pose==='idle'&&['run','assist','aid','tie','wipe','write'].includes(pose||'')?pose:keyed.pose || pose,
    expression: keyed.expression || expression,
    facing: keyed.facing || object.facing,
    lookAtId,
    doorOpen: keyed.doorOpen ?? object.doorOpen,
    lightLevel: keyed.lightLevel ?? object.lightLevel,
    boxOpen: keyed.boxOpen ?? object.boxOpen,
    bandageProgress: keyed.bandageProgress ?? object.bandageProgress,
  };
}

export function evaluateCanvasChoreographyOffset(
  object: CanvasStudioObject,
  scene: CanvasStudioScene,
  timeMs: number,
): CanvasChoreographyOffset {
  const beats = activeBeats(scene, object.id, timeMs);
  let x = 0;
  let y = 0;
  let scale = 1;
  let rotation = 0;
  let opacity = 1;

  const authoredTravel = object.keyframes?.some(frame => frame.dx !== undefined || frame.dy !== undefined);
  // Physical emergence/descent is one persistent trajectory, not a loop or fade.
  for(const beat of scene.animationBeats||[]){
    if(!beat.targetIds.includes(object.id))continue;
    if(beat.action==='surface')y+=(1-easeOutCubic(beatProgress(beat,timeMs)))*object.height*.75;
    if(timeMs<beat.atMs)continue;
    if(beat.action==='sink')y+=easeInOutCubic(beatProgress(beat,timeMs))*object.height*.45;
  }
  if (!authoredTravel) {
    // A completed travel beat leaves the actor at its destination.
    for (const beat of scene.animationBeats || []) {
      if (beat.action === 'run' && beat.targetIds.includes(object.id) && timeMs > beat.atMs + beat.durationMs) {
        x += (object.facing === 'left' ? -1 : 1) * 58 * Math.max(.2, Math.min(2.5, beat.intensity || 1));
      }
    }
  }

  for (const beat of beats) {
    const progress = beatProgress(beat, timeMs);
    const intensity = Math.max(.2, Math.min(2.5, beat.intensity || 1));
    const ease = easeOutCubic(progress);

    if (beat.action === 'reveal') {
      const reveal = easeOutCubic(Math.min(1, progress * 1.6));
      scale *= .72 + .28 * reveal;
      opacity *= reveal;
    } else if (beat.action === 'react') {
      const envelope = Math.sin(progress * Math.PI);
      // A single recoil and recovery, not a high-frequency tremor.
      x -= 4 * envelope * intensity;
      rotation -= 1.5 * envelope * intensity;
      scale *= 1 + envelope * .03 * intensity;
    } else if (beat.action === 'impact') {
      const anticipation = Math.exp(-Math.pow((progress - .28) / .12, 2));
      const impact = Math.exp(-Math.pow((progress - .52) / .1, 2));
      x -= anticipation * 14 * intensity;
      x += Math.sin((timeMs - beat.atMs) / 14) * 18 * impact * intensity;
      rotation += Math.sin((timeMs - beat.atMs) / 18) * 8 * impact * intensity;
      scale *= 1 - anticipation * .035 + impact * .07;
    } else if (beat.action === 'float') {
      y += Math.sin((timeMs - beat.atMs) / 180) * 7 * intensity;
    } else if (beat.action === 'pulse') {
      scale *= 1 + Math.sin(progress * Math.PI * 3) * .045 * intensity;
    } else if (beat.action === 'run') {
      const direction = object.facing === 'left' ? -1 : 1;
      if (!authoredTravel) x += direction * easeInOutCubic(progress) * 58 * intensity;
      if(!authoredTravel)y -= Math.abs(Math.sin(progress * Math.PI * 4)) * .5 * Math.sin(progress * Math.PI) * intensity;
    } else if (beat.action === 'row') {
      rotation += Math.sin(progress * Math.PI * 2) * 2.5 * intensity;
    } else if (beat.action === 'talk') {
      y += Math.sin(progress * Math.PI * 2) * .6 * intensity;
    } else if (beat.action === 'celebrate') {
      y -= Math.sin(progress * Math.PI) * 9 * intensity;
      scale *= 1 + Math.sin(progress * Math.PI) * .035 * intensity;
    } else if (beat.action === 'brace') {
      rotation += Math.sin(progress * Math.PI) * -2.5 * intensity;
    }
  }

  return { x, y, scale, rotation, opacity };
}
