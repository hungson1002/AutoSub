import type {CanvasStudioObject,CanvasStudioScene} from '../types';
import {resolveCharacterModel,characterDrawingScale} from './characterModel';
import {resolveCharacterRig} from './characterRig';
import {evaluateCanvasObject} from '../runtime';
import {canvasActingTiming} from '../choreography';
export function resolveStageCharacterRig(object: CanvasStudioObject, scene: CanvasStudioScene, timeMs: number, voiceActive: boolean) {
  const model = resolveCharacterModel(object, scene);
  const acting = canvasActingTiming(object, scene, timeMs);
  // Keep the same distance origin through recovery. Losing the beat at its
  // end used to reset the gait phase even while authored travel continued.
  const walkBeat = scene.animationBeats?.filter(beat => beat.action === 'run' && beat.targetIds.includes(object.id)
    && timeMs >= beat.atMs).sort((a,b)=>a.atMs-b.atMs).at(-1);
  const walkSource = scene.objects.find(actor => actor.id === object.id) || object;
  const hasTravel=walkBeat || object.motion==='walk-left' || object.motion==='walk-right' || object.keyframes?.some(k=>k.dx!==undefined)
    || scene.animationBeats?.some(beat=>beat.action==='assist'&&beat.targetIds.includes(object.id));
  const travel = (object.pose==='run'||object.pose==='assist') && hasTravel ? (evaluateCanvasObject(walkSource,scene,timeMs).x-evaluateCanvasObject(walkSource,scene,walkBeat?.atMs??0).x)
    / characterDrawingScale(object,model) * (object.facing==='left'?-1:1) : undefined;
  const interaction=['reach','wipe','write','tie','aid','assist'].includes(object.pose||'');
  const focus=(object.pose==='point'||interaction)&&scene.objects.find(target=>target.id===object.lookAtId);
  const targetPosition=focus?evaluateCanvasObject(focus,scene,timeMs):undefined;
  const actorPosition=targetPosition?evaluateCanvasObject(object,scene,timeMs):undefined;
  const gripping=focus&&scene.animationBeats?.some(b=>b.action==='grab'&&b.targetIds.includes(object.id)&&b.focusTargetId===focus.id&&timeMs>=b.atMs);
  if(targetPosition&&focus&&focus.kind==='character'&&(object.pose==='aid'||object.pose==='assist'||gripping)){
    const targetModel=resolveCharacterModel(focus,scene);
    const targetRig=resolveCharacterRig(focus,targetModel,timeMs,false);
    const nearRight=actorPosition&&(actorPosition.x-targetPosition.x)*(focus.facing==='left'?-1:1)>0;
    const anchor=gripping?targetRig.footL:object.pose==='aid'?(focus.legBandage==='left'?targetRig.kneeL:targetRig.kneeR):nearRight?targetRig.shoulderR:targetRig.shoulderL;
    const size=characterDrawingScale(focus,targetModel)*targetPosition.scale;
    targetPosition.x+=anchor.x*size*(focus.facing==='left'?-1:1);
    targetPosition.y+=anchor.y*size;
  }
  const heldPhone=scene.objects.some(p=>p.variant==='phone'&&p.heldBy===object.id);
  const pointTarget=heldPhone?{x:model.faceWidth*.5+6,y:model.horror?-29:-33}:targetPosition&&actorPosition?{
    x:(targetPosition.x-actorPosition.x)/characterDrawingScale(object,model)*(object.facing==='left'?-1:1),
    y:(targetPosition.y-actorPosition.y)/characterDrawingScale(object,model),
  }:undefined;
  const rig = resolveCharacterRig(object, model, timeMs, voiceActive, acting.localMs, acting.weight, travel, pointTarget, heldPhone);
  return {model,rig};
}

/** Match the same rig, facing, drawing scale and object transform as the actor. */
export function canvasCharacterHand(object: CanvasStudioObject, scene: CanvasStudioScene, timeMs: number, voiceActive: boolean) {
  const {model,rig}=resolveStageCharacterRig(object,scene,timeMs,voiceActive);
  const transform=evaluateCanvasObject(object,scene,timeMs);
  const scale=characterDrawingScale(object,model)*transform.scale;
  const x=rig.handR.x*scale*(object.facing==='left'?-1:1);
  const y=rig.handR.y*scale+(model.lod==='close'?object.height*.055*transform.scale:0);
  const angle=transform.rotation*Math.PI/180;
  return {x:transform.x+x*Math.cos(angle)-y*Math.sin(angle),y:transform.y+x*Math.sin(angle)+y*Math.cos(angle)};
}

