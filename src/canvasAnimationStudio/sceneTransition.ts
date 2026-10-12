import type {CanvasStudioScene} from './types';
import {renderCanvasScene} from './renderer';
import {canvasTransitionProgress} from '../../shared/canvasSceneTransition';
import {canvasScenesShareStage} from '../../shared/canvasContinuity';
import {canvasConversationKey} from '../../shared/canvasDialogueDirection';
import {isFolkHorrorScene} from '../../shared/canvasFolkHorror';

const buffers=new WeakMap<CanvasRenderingContext2D,HTMLCanvasElement>();

export function renderCanvasSceneWithTransition(ctx:CanvasRenderingContext2D,scene:CanvasStudioScene,previous:CanvasStudioScene|undefined,timeMs:number,width:number,height:number,assetOrigin?:string){
  renderCanvasScene(ctx,scene,timeMs,width,height,assetOrigin);
  // Flat folk stories change shot size with dry cuts. Blending two different
  // cameras duplicates the skull/body even when both shots share the same set.
  if(scene.vectorScene||isFolkHorrorScene(scene))return;
  const conversation=canvasConversationKey(scene);
  const sameStage=canvasScenesShareStage(previous,scene);
  const sameConversation=Boolean(previous&&conversation&&conversation===canvasConversationKey(previous));
  // Real editorial cuts (close reaction / POV / prop insert) remain dry cuts.
  // A continuity pair gets a tiny layer blend so adding a prop/actor does not
  // look like the whole set was rebuilt between adjacent frames.
  if(previous&&sameConversation&&!sameStage)return;
  const progress=canvasTransitionProgress(timeMs,scene.durationMs,sameStage?'stage-blend':'cut');
  if(!previous||progress>=1)return;
  let buffer=buffers.get(ctx);
  if(!buffer){buffer=document.createElement('canvas');buffers.set(ctx,buffer);}
  if(buffer.width!==width)buffer.width=width;
  if(buffer.height!==height)buffer.height=height;
  const outgoing=buffer.getContext('2d');
  if(!outgoing)return;
  // Continue outgoing ambient motion rather than freezing or replaying its tail.
  renderCanvasScene(outgoing,previous,previous.durationMs+Math.max(0,timeMs),width,height,assetOrigin);
  ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.globalAlpha=1-progress;
  ctx.drawImage(buffer,0,0);ctx.restore();
}
