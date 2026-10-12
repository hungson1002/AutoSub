import type {CanvasStudioObject,CanvasStudioScene,CanvasSceneEffect} from './types';
import {evaluateCanvasObject} from './runtime';
import {applyCanvasChoreographyState} from './choreography';
import {canvasCharacterHand} from './characters/characterStaging';
import {isCanvasActorSpeaking} from '../../shared/canvasDialogue';
import {canvasLampLight} from '../../shared/canvasAtmosphere';
import {canvasLanternUsesHandlePivot,canvasPropBottomRatio,canvasPropSupportSurfaceRatio} from '../../shared/canvasSpatialRelations';

/** One attachment transform for the visible prop and its light emitter. */
export function evaluateAttachedProp(object:CanvasStudioObject,scene:CanvasStudioScene,timeMs:number){
  const transform=evaluateCanvasObject(applyCanvasChoreographyState(object,scene,timeMs),scene,timeMs);
  if(object.restingOn&&!object.heldBy&&!object.handling){
    const support=scene.objects.find(o=>o.id===object.restingOn&&o.id!==object.id);
    const surface=support&&canvasPropSupportSurfaceRatio(support);
    const bottom=canvasPropBottomRatio(object);
    if(support&&surface!==undefined&&bottom!==undefined){
      const base=evaluateCanvasObject(applyCanvasChoreographyState(support,scene,timeMs),scene,timeMs);
      const angle=base.rotation*Math.PI/180;
      const localX=Math.max(-1,Math.min(1,object.restingOffsetX||0))*support.width*base.scale*.5;
      const localY=surface*support.height*base.scale;
      const surfaceX=base.x+localX*Math.cos(angle)-localY*Math.sin(angle);
      const surfaceY=base.y+localX*Math.sin(angle)+localY*Math.cos(angle);
      const bottomY=bottom*object.height*transform.scale;
      transform.x=surfaceX+Math.sin(angle)*bottomY;
      transform.y=surfaceY-Math.cos(angle)*bottomY;
    }
  }
  const handling=object.handling;
  if(handling){
    const holder=scene.objects.find(o=>o.id===handling.actorId&&o.kind==='character');
    const progress=Math.max(0,Math.min(1,(timeMs-handling.atMs)/Math.max(1,handling.durationMs)));
    const attached=handling.kind==='pick-up'?progress>=.35:progress<.8;
    if(holder&&attached){
      const hand=canvasCharacterHand(applyCanvasChoreographyState(holder,scene,timeMs),scene,timeMs,false);
      transform.x=hand.x;transform.y=hand.y;
    }
  }
  const holder=object.heldBy&&scene.objects.find(actor=>actor.id===object.heldBy&&actor.kind==='character'&&!actor.imageUrl);
  if(holder){
    const actor=applyCanvasChoreographyState(holder,scene,timeMs);
    const hand=canvasCharacterHand(actor,scene,timeMs,isCanvasActorSpeaking(scene,actor,timeMs)??false,object.heldHand==='left'?'L':'R');
    transform.x=hand.x+(object.variant==='teapot'?object.width*.45*transform.scale:0);
    transform.y=hand.y+(object.variant==='lantern'?object.height*.51*transform.scale:object.variant==='phone'?-object.height*.15*transform.scale:0);
    if(object.variant==='oar'){
      const other=canvasCharacterHand(actor,scene,timeMs,false,'L');
      transform.rotation=Math.atan2(hand.y-other.y,hand.x-other.x)*180/Math.PI;
      // The authored shaft has grips at x=0 and x=-28. Match both
      // hands every frame rather than fitting only its origin to one hand.
      transform.scale=Math.hypot(hand.x-other.x,hand.y-other.y)/(object.width*.28);
    }
  }
  return transform;
}

export function resolveCanvasLight(effect:CanvasSceneEffect,scene:CanvasStudioScene,timeMs:number):CanvasSceneEffect{
  const source=scene.objects.find(o=>o.id===effect.sourceObjectId);
  if(!source)return effect;
  const transform=evaluateAttachedProp(source,scene,timeMs);
  // Only held/suspended lanterns rotate around their handle. A tabletop
  // lantern is center-authored and must not inherit the hanging-pivot offset.
  const pivot=canvasLanternUsesHandlePivot(source)?source.height*.51*transform.scale:0;
  // Authored lantern halo is centered at local y=2 in its 100-unit prop frame.
  const flame=source.variant==='lantern'?source.height*.02*transform.scale:0;
  const angle=transform.rotation*Math.PI/180;
  const level=source.variant==='lantern'?canvasLampLight(applyCanvasChoreographyState(source,scene,timeMs),timeMs):1;
  return {...effect,x:transform.x-Math.sin(angle)*(pivot+flame),y:transform.y-pivot+Math.cos(angle)*(pivot+flame),scale:effect.scale*transform.scale,intensity:(effect.intensity??1)*transform.opacity*level};
}
