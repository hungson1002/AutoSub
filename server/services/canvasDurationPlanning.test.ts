import assert from 'node:assert/strict';
import test from 'node:test';
import {createCanvasProject,createCanvasScene,createCanvasObject} from '../../shared/canvasAnimationStudio';
import {applyCanvasDurationScript} from './canvasDurationPlanning';
import {normalizeVectorAssets,normalizeVectorScene} from '../../shared/canvasVectorScene';

test('runtime revision retains ending, cast and action cues while invalidating changed audio',()=>{
  const project=createCanvasProject();
  const first=createCanvasScene();first.durationMs=10000;
  first.dialogue=[{id:'line',speaker:'An',characterKey:'an',voice:'voice-a',text:'An đưa tay, mở cửa rồi bước ra ngoài.',audioUrl:'/old.wav',audioKey:'old',durationMs:9500}];
  first.animationBeats=[{id:'open',action:'reach',targetIds:['an'],speechCue:'mở cửa',dialogueId:'line',atMs:2000,durationMs:1000}];
  first.objects=[createCanvasObject('character',{id:'an',keyframes:[{atMs:0},{atMs:10000,dx:100}]})];
  const end=createCanvasScene();end.durationMs=10000;end.dialogue=[{id:'end',speaker:'Narrator',text:'Mọi người trở về bình an.',voice:'narrator'}];
  project.scenes=[first,end];project.castVoices={an:'voice-a'};
  const edits=[{id:first.id,dialogue:[{id:'line',text:'An mở cửa.'}]},{id:end.id,dialogue:[{id:'end',text:'Mọi người bình an.'}]}];
  const revised=applyCanvasDurationScript(project,edits,12000);
  assert.equal(revised.scenes.reduce((sum,s)=>sum+s.durationMs,0),12000);
  assert.deepEqual(revised.scenes.map(s=>s.id),project.scenes.map(s=>s.id));
  assert.equal(revised.scenes[0]!.dialogue![0]!.voice,'voice-a');assert.equal(revised.scenes[0]!.dialogue![0]!.audioUrl,undefined);
  assert.equal(revised.scenes[0]!.animationBeats![0]!.atMs,1200);
  assert.equal(revised.scenes[0]!.objects[0]!.keyframes![1]!.atMs,6000);
  assert.deepEqual(revised.castVoices,project.castVoices);
  assert.equal(project.scenes[0]!.dialogue![0]!.audioUrl,'/old.wav');
  assert.throws(()=>applyCanvasDurationScript(project,edits.slice(0,1),12000),/every scene/);
  assert.throws(()=>applyCanvasDurationScript(project,[{...edits[0]!,dialogue:[{id:'line',text:'An ra ngoài.'}]},edits[1]!],12000),/action cue/);
});

test('a vector duration revision keeps drawings and all reach, direction and prop-release speech cues',()=>{
  const project=createCanvasProject(),scene=createCanvasScene();
  scene.durationMs=208000;scene.narration='He slowly raises the lamp, waits, then drops it.';
  scene.dialogue=[{id:'voice',speaker:'Narrator',text:scene.narration,audioUrl:'/original.wav',audioKey:'old',durationMs:208000}];
  project.vectorAssets=normalizeVectorAssets({human:{rig:'simple-human'}});
  scene.vectorScene=normalizeVectorScene({width:720,height:1280,nodes:[{id:'person',type:'instance',asset:'human'}],tracks:[
    {target:'person/arm-r',cue:'raises the lamp',start:0,end:1,frames:[{t:0,rotation:0},{t:1,rotation:-40}]},
  ]},project.vectorAssets,scene.narration);
  scene.vectorBeats=[{cue:'waits',targets:['person']}];
  scene.vectorDirection={purpose:'Act',location:'room',shot:{size:'action',focus:'person',include:[]},beats:[
    {cue:'raises the lamp',kind:'motion',targets:['person'],motionTargets:['person/arm-r'],before:'lowered',after:'raised'},
  ],propEvents:[{prop:'lamp',action:'release',cue:'drops it'}]};
  project.scenes=[scene];const before=structuredClone(project);
  const edited='He raises the lamp, waits, then drops it.';
  const apply=(text:string)=>applyCanvasDurationScript(project,[{id:scene.id,dialogue:[{id:'voice',text}]}],180000);
  const revised=apply(edited);
  assert.deepEqual(revised.scenes[0]!.vectorScene,scene.vectorScene);
  assert.deepEqual(revised.scenes[0]!.vectorDirection,scene.vectorDirection);
  assert.equal(revised.scenes[0]!.durationMs,180000);
  assert.equal(revised.scenes[0]!.dialogue![0]!.audioUrl,undefined);
  for(const cue of ['raises the lamp','waits','drops it'])assert.throws(()=>apply(edited.replace(cue,'acts')),/action cue/);
  assert.deepEqual(project,before);
});
