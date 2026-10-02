import assert from 'node:assert/strict';
import test from 'node:test';
import {createCanvasScene,createCanvasProject} from '../../shared/canvasAnimationStudio';
import {canvasCaptionAt,hasCanvasCaptions,drawCanvasCaption} from './captions';

test('shared export captions respect measured dialogue, silence and narrator versus character tags',()=>{
 const scene=createCanvasScene();scene.durationMs=5000;scene.dialogue=[{id:'l',speaker:'Lan',characterKey:'lan',text:'Mình về thôi.',atMs:1000,durationMs:1500}];
 assert.equal(canvasCaptionAt(scene,500),'');assert.equal(canvasCaptionAt(scene,1200),'Mình về thôi.');assert.equal(canvasCaptionAt(scene,2600),'');
 const calls:string[]=[];
 const ctx=new Proxy({} as any,{get(t,k){return k==='measureText'?()=>({width:100}):(...args:any[])=>{if(k==='fillText')calls.push(args[0]);};},set(t,k,v){t[k]=v;return true;}});
 drawCanvasCaption(ctx,scene,1200,1280,720);assert.deepEqual(calls,['Mình về thôi.','Lan']);
 scene.dialogue[0]!.speaker='Người kể';calls.length=0;drawCanvasCaption(ctx,scene,1200,1280,720);assert.deepEqual(calls,['Mình về thôi.']);
 const project=createCanvasProject();project.sourcePrompt='Truyền thuyết Ma Da';assert.equal(hasCanvasCaptions(project),true);
});
