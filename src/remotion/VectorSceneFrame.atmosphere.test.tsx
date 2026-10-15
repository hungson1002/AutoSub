import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';
import sharp from 'sharp';import {renderToStaticMarkup} from 'react-dom/server';
import {createCanvasProject} from '../../shared/canvasAnimationStudio';import {normalizeVectorScene,normalizeVectorAssets,compileVectorProject} from '../../shared/canvasVectorScene';
import {vectorAtmospherePuffs} from '../../shared/canvasVectorAtmosphere';
import {VectorSceneFrame} from './VectorSceneFrame';import {settingScenery} from '../../server/services/canvasScenerySetting';
(globalThis as any).React=React;
test('actual renderer softens only atmosphere and leaves the caption region untouched',async()=>{
 const scene={...createCanvasProject().scenes[0]!,narration:'',durationMs:8000,vectorScene:normalizeVectorScene({width:640,height:480,nodes:[
  {id:'sky',type:'rect',width:640,height:480,fill:'#344c47'},
  {id:'mist',type:'group',bounds:{x:0,y:200,width:640,height:280},atmosphere:{kind:'fog',density:1,seed:99,speed:1}}
 ],tracks:[]},{})};
 const render=async(timeMs:number)=>{
  const markup=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene,timeMs,width:640,height:480}));
  assert.ok(markup.includes('feGaussianBlur')&&markup.includes('feDisplacementMap'));
  assert.ok(!markup.includes('<animate')&&!markup.includes('animation:'));
  return sharp(Buffer.from(markup.match(/<svg.*<\/svg>/)![0])).removeAlpha().raw().toBuffer();
 };
 const a=await render(0),b=await render(2000);
 assert.deepEqual(a.subarray(0,640*150*3),b.subarray(0,640*150*3));
 let softened=0,changed=0;for(let i=640*220*3;i<a.length;i+=3){if(a[i]!>52)softened++;if(Math.abs(a[i]!-b[i]!)>0)changed++;}
 assert.ok(softened>1000&&changed>1000,'fog must be visible and animate in actual pixels');
});
test('native smoke belongs to its source and fog is split into distant and near layers',()=>{
 const p=settingScenery({place:'village',atmosphere:'fog',smoke:true});
 const nodes=normalizeVectorScene(p.stage,normalizeVectorAssets(p.assets)).nodes;
 assert.equal(nodes.find(n=>n.id==='cooking-smoke')!.parent,'cooking-fire');
 assert.equal(nodes.find(n=>n.id==='cooking-smoke')!.atmosphere!.kind,'smoke');
 assert.equal(nodes.find(n=>n.id==='distant-haze')!.atmosphere!.kind,'fog');
 assert.equal(nodes.find(n=>n.id==='ground-mist')!.atmosphere!.kind,'fog');
 const fire=nodes.find(n=>n.id==='cooking-fire')!.bounds!,gate=nodes.find(n=>n.id==='village-gate')!.bounds!;
 assert.ok(fire.x>gate.x+gate.width,'the hearth must not project onto the foreground wooden gate roof');
});

test('the atmosphere clock continues through scene cuts instead of restarting the smoke',()=>{
 const p=createCanvasProject(),base=p.scenes[0]!,drawing=normalizeVectorScene({width:1280,height:720,nodes:[{id:'fog',type:'group',bounds:{x:0,y:200,width:1280,height:400},atmosphere:{kind:'smoke',seed:17,density:.5,speed:1}}],tracks:[]},{});
 const scenes=[{...base,id:'cut-1',durationMs:3000,narration:'',vectorScene:drawing},{...base,id:'cut-2',durationMs:3000,narration:'',vectorScene:structuredClone(drawing)}];
 const compiled=compileVectorProject({...p,scenes}),a=compiled.scenes[0]!,b=compiled.scenes[1]!,node=b.vectorScene!.nodes.find(n=>n.id==='fog')!;
 assert.equal(a.atmosphere!.timeOffsetMs,0);assert.equal(b.atmosphere!.timeOffsetMs,3000);
 assert.deepEqual(vectorAtmospherePuffs(node.atmosphere!,node.bounds!,a.durationMs+a.atmosphere!.timeOffsetMs!),vectorAtmospherePuffs(node.atmosphere!,node.bounds!,b.atmosphere!.timeOffsetMs!));
});
