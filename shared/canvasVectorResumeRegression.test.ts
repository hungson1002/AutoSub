import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasProject,type CanvasStudioScene} from './canvasAnimationStudio';
import {compileVectorProject,normalizeVectorAssets,normalizeVectorScene,evaluateVectorPart} from './canvasVectorScene';

test('short puppet reactions retain their displacement within and across cuts; travel retains its absolute destination',()=>{
  const assets=normalizeVectorAssets({hero:{rig:'simple-puppet'}});
  for(const acrossCut of [false,true])for(const kind of ['motion','travel'] as const){
    const p=createCanvasProject();p.width=1280;p.height=720;p.vectorAssets=assets;
    const shot=(id:string):CanvasStudioScene=>({...p.scenes[0]!,id,durationMs:6000,narration:'retreat',vectorStageId:'room',
      vectorDirection:{purpose:'React in place',location:'room',visibleCast:['person'],heldProps:[],shot:{size:'action',focus:'person',include:[]},
        beats:[{cue:'retreat',kind,targets:['person'],motionTargets:['person'],before:'standing',after:'a short step backward'}]},
      vectorScene:normalizeVectorScene({width:1280,height:720,nodes:[{id:'person',type:'instance',asset:'hero',x:400,y:240}],tracks:[]},assets)});
    const move=shot('move');
    move.vectorScene!.tracks=[...(!acrossCut?[{target:'person',start:0,end:.01,frames:[{t:0,dx:140,scaleX:-1}]}]:[]),
      {target:'person',start:.6,end:.9,cue:'retreat',frames:[{t:0,dx:0},{t:.4,dx:-20},{t:1,dx:-35}]}];
    if(acrossCut){const held=shot('held');held.vectorDirection!.beats=[];held.vectorScene!.tracks=[{target:'person',start:0,end:1,frames:[{t:0,dx:140}]}];p.scenes=[held,move];}
    else p.scenes=[move];
    const original=structuredClone(p),fixed=compileVectorProject(p),last=fixed.scenes.at(-1)!;
    assert.equal(evaluateVectorPart('person',last,6000).dx,kind==='motion'?105:-35,`${kind}, across cut=${acrossCut}`);
    assert.deepEqual(compileVectorProject(fixed),fixed);assert.deepEqual(p,original);
  }
});

test('grounding preserves an authored floor and does not recreate deleted soil on resume',()=>{
  const authored=normalizeVectorScene({width:720,height:1280,nodes:[
    {id:'background',type:'rect',width:720,height:1280,fill:'#857561'},
    {id:'physical-ground-plane',type:'rect',y:980,width:720,height:1280,fill:'#a3977c'},
  ],ground:{y:980},tracks:[]},{});
  assert.ok(!authored.nodes.some(n=>n.id.startsWith('physical-soil-')),'an indoor/designed floor needs no automatic dirt');
  const fallback=normalizeVectorScene({width:720,height:1280,nodes:[{id:'sky',type:'rect',width:720,height:1280,fill:'#657885'}],ground:{y:980},tracks:[]},{});
  assert.ok(fallback.nodes.some(n=>n.id==='physical-ground-plane'),'keep the fallback support');
  assert.ok(fallback.nodes.some(n=>n.id==='physical-soil-0'),'fallback land can retain its contours');
  const repaired={...fallback,nodes:fallback.nodes.filter(n=>!n.id.startsWith('physical-soil-'))};
  assert.ok(!normalizeVectorScene(repaired,{}).nodes.some(n=>n.id.startsWith('physical-soil-')),'respect a saved removal');
});
