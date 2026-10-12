import type {CanvasStudioObject,CanvasStudioScene} from '../types';
import {resolveCharacterModel,characterDrawingScale} from './characterModel';
import {resolveCharacterRig} from './characterRig';
import {evaluateCanvasObject} from '../runtime';
import {canvasActingTiming} from '../choreography';
export function resolveStageCharacterRig(object: CanvasStudioObject, scene: CanvasStudioScene, timeMs: number, voiceActive: boolean) {
  const model = resolveCharacterModel(object, scene);
  let acting = canvasActingTiming(object, scene, timeMs);
  const handlingProp=scene.objects.find(prop=>prop.handling?.actorId===object.id&&(timeMs>=prop.handling.atMs||prop.handling.kind==='place'));
  if(handlingProp?.handling){
    const event=handlingProp.handling,elapsed=timeMs-event.atMs;
    if(elapsed<=event.durationMs||event.kind==='pick-up')acting={localMs:Math.max(0,Math.min(elapsed,event.durationMs)),weight:elapsed<0?1:Math.min(1,elapsed/Math.min(320,event.durationMs*.25))};
  }
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
  const targetPosition=focus&&focus.heldBy!==object.id?evaluateCanvasObject(focus,scene,timeMs):undefined;
  const actorPosition=targetPosition?evaluateCanvasObject(object,scene,timeMs):undefined;
  const offsetTarget=(x:number,y:number)=>{
    if(!targetPosition)return;
    const angle=targetPosition.rotation*Math.PI/180,scale=targetPosition.scale;
    targetPosition.x+=(x*Math.cos(angle)-y*Math.sin(angle))*scale;
    targetPosition.y+=(x*Math.sin(angle)+y*Math.cos(angle))*scale;
  };
  const transaction=scene.objects.find(prop=>prop.handling?.actorId===object.id&&timeMs>=prop.handling.atMs
    &&timeMs<=prop.handling.atMs+prop.handling.durationMs);
  if(targetPosition&&actorPosition&&transaction?.handling&&focus&&focus.id===transaction.id){
    const event=transaction.handling;
    const progress=Math.max(0,Math.min(1,(timeMs-event.atMs)/event.durationMs));
    const lift=event.kind==='pick-up'?Math.max(0,(progress-.35)/.65):1-Math.min(1,progress/.8);
    const blend=lift*lift*(3-2*lift),fit=characterDrawingScale(object,model);
    const carry={x:actorPosition.x+fit*20*(object.facing==='left'?-1:1),y:actorPosition.y+fit*14};
    targetPosition.x+=(carry.x-targetPosition.x)*blend;targetPosition.y+=(carry.y-targetPosition.y)*blend;
  }
  const gripping=focus&&scene.animationBeats?.some(b=>b.action==='grab'&&b.targetIds.includes(object.id)&&b.focusTargetId===focus.id&&timeMs>=b.atMs);
  if(targetPosition&&focus&&focus.environmentAnchor==='doorway'){
    offsetTarget(-focus.width*.30,focus.height*.02);
  }
  if(targetPosition&&focus&&focus.kind==='ship'&&actorPosition){
    // Touch the near gunwale, not the center of a large boat illustration.
    const side=actorPosition.x<targetPosition.x?-1:1;
    offsetTarget(side*focus.width*.36,focus.height*.05);
  }
  if(targetPosition&&focus&&focus.kind==='character'&&(object.pose==='aid'||object.pose==='assist'||object.pose==='reach'||gripping)){
    const targetModel=resolveCharacterModel(focus,scene);
    const targetRig=resolveCharacterRig(focus,targetModel,timeMs,false);
    const nearRight=actorPosition&&(actorPosition.x-targetPosition.x)*(focus.facing==='left'?-1:1)>0;
    const anchor=gripping?targetRig.footL:object.pose==='aid'?(focus.legBandage==='left'?targetRig.kneeL:targetRig.kneeR):nearRight?targetRig.shoulderR:targetRig.shoulderL;
    const size=characterDrawingScale(focus,targetModel);
    offsetTarget(anchor.x*size*(focus.facing==='left'?-1:1),anchor.y*size);
  }
  const heldPhone=scene.objects.some(p=>p.variant==='phone'&&p.heldBy===object.id);
  const angle=(actorPosition?.rotation||0)*Math.PI/180;
  const dx=(targetPosition?.x||0)-(actorPosition?.x||0),dy=(targetPosition?.y||0)-(actorPosition?.y||0);
  const size=characterDrawingScale(object,model)*(actorPosition?.scale||1);
  const pointTarget=heldPhone?{x:model.faceWidth*.5+6,y:model.horror?-29:-33}:targetPosition&&actorPosition?{
    x:(dx*Math.cos(angle)+dy*Math.sin(angle))/size*(object.facing==='left'?-1:1),
    y:(-dx*Math.sin(angle)+dy*Math.cos(angle))/size-(model.lod==='close'?object.height*.055/characterDrawingScale(object,model):0),
  }:undefined;
  const baseObject=scene.objects.find(actor=>actor.id===object.id)||object;
  const restPose=baseObject.pose||((baseObject.sittingStyle||object.sittingStyle)?'sit':'idle');
  const rig = resolveCharacterRig(object, model, timeMs, voiceActive, acting.localMs, acting.weight, travel, pointTarget, heldPhone, restPose);
  return {model,rig};
}

/** Match the same rig, facing, drawing scale and object transform as the actor. */
export function canvasCharacterLocalGroundOffset(object:CanvasStudioObject,scene:CanvasStudioScene,timeMs:number){
  const {model,rig}=resolveStageCharacterRig(object,scene,timeMs,false);
  const shoeBottom=Math.max(rig.footL.y,rig.footR.y)+3.15;
  return shoeBottom*characterDrawingScale(object,model);
}

/** Match the same rig, facing, drawing scale and object transform as the actor. */
export function canvasCharacterHand(object: CanvasStudioObject, scene: CanvasStudioScene, timeMs: number, voiceActive: boolean,side:'L'|'R'='R') {
  const {model,rig}=resolveStageCharacterRig(object,scene,timeMs,voiceActive);
  const transform=evaluateCanvasObject(object,scene,timeMs);
  const scale=characterDrawingScale(object,model)*transform.scale;
  const x=rig[`hand${side}`].x*scale*(object.facing==='left'?-1:1);
  const y=rig[`hand${side}`].y*scale+(model.lod==='close'?object.height*.055*transform.scale:0);
  const angle=transform.rotation*Math.PI/180;
  return {x:transform.x+x*Math.cos(angle)-y*Math.sin(angle),y:transform.y+x*Math.sin(angle)+y*Math.cos(angle)};
}

