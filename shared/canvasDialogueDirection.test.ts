import assert from 'node:assert/strict';
import test from 'node:test';
import {createCanvasObject,createCanvasProject,createCanvasScene} from './canvasAnimationStudio';
import {compileCanvasProjectLayout,compileCanvasSceneLayout} from './canvasLayoutCompiler';
import {evaluateCanvasVisualQuality} from './canvasVisualQuality';
import {directCanvasProject} from './canvasCinematicDirection';
import {applyCanvasChoreographyState,evaluateCanvasChoreographyOffset} from '../src/canvasAnimationStudio/choreography';
import {resolveStageCharacterRig} from '../src/canvasAnimationStudio/characters/characterStaging';
import {canvasConversationKey} from './canvasDialogueDirection';

test('narrated tense speaker turns preserve the first wide shot without merging audio or physical inserts',()=>{
  const project=conversation();
  for(const [i,scene] of project.scenes.entries()){
    scene.camera={shot:i===0?'wide':'medium',motion:'none',focusX:640,focusY:468,zoom:1};
    scene.animationBeats=[];
    scene.dialogue!.unshift({id:`n-${i}`,speaker:'Narrator',text:'Beside the river.',durationMs:1000});
  }
  project.scenes[0]!.dialogue![1]!.emotion='tense';
  project.scenes[2]!.objects=project.scenes[2]!.objects.filter(o=>o.kind!=='character');
  project.scenes[2]!.dialogue=project.scenes[2]!.dialogue!.filter(l=>!l.characterKey);
  const result=compileCanvasProjectLayout(project);
  assert.deepEqual(result.scenes[1]!.camera,result.scenes[0]!.camera);
  assert.equal(result.scenes[1]!.camera!.shot,'wide');
  assert.equal(canvasConversationKey(result.scenes[0]!),canvasConversationKey(result.scenes[1]!));
  assert.equal(canvasConversationKey(result.scenes[2]!),undefined);
  assert.equal(result.scenes[2]!.camera!.shot,'medium');
  assert.equal(result.scenes.length,project.scenes.length);
  assert.deepEqual(result.scenes.map(s=>s.dialogue),project.scenes.map(s=>s.dialogue));
  assert.deepEqual(compileCanvasProjectLayout(result),result);
});

function conversation(){
  const project=createCanvasProject();
  project.scenes=Array.from({length:3},(_,i)=>{
    const a=createCanvasObject('character',{id:`a-${i}`,label:'Minh',characterKey:'minh',assetRef:'character:villager',motion:'none',pose:i%2?'idle':'talk',slot:'hero-left'});
    const b=createCanvasObject('character',{id:`b-${i}`,label:'Lan',characterKey:'lan',assetRef:'character:villager',motion:'none',pose:i%2?'talk':'idle',slot:'hero-right'});
    const scene=createCanvasScene();
    return {...scene,durationMs:6000,template:i%2?'hero-right' as const:'two-shot' as const,background:'room' as const,backgroundRef:'bg:room-stilt-day',
      camera:{shot:i%2?'close-up' as const:'medium' as const,motion:'push-in' as const,focusX:640,focusY:360,zoom:1.3},
      dialogue:[{id:`line-${i}`,speaker:i%2?'Lan':'Minh',characterKey:i%2?'lan':'minh',text:'Ngày mai mình gặp nhau nhé.',durationMs:5200}],
      objects:[a,b,createCanvasObject('prop',{label:'Bàn',variant:'table',assetRef:'prop:table',role:'support',slot:'mid-center',motion:'none'}),...(i===0?[createCanvasObject('prop',{label:'Ấm trà',variant:'teapot',assetRef:'prop:teapot',role:'support',slot:'mid-center',motion:'none'})]:[])],
      animationBeats:[{id:`point-${i}`,action:'point' as const,targetIds:[i%2?b.id:a.id],atMs:1200,durationMs:2000},
        {id:`react-${i}`,action:'react' as const,targetIds:[i%2?a.id:b.id],atMs:4000,durationMs:1000}],
    };
  });
  return project;
}

test('dialogue turns keep the stage, anatomy, furniture and camera stable across repeated compilation',()=>{
  const original=conversation(),snapshot=structuredClone(original);
  let directed=compileCanvasProjectLayout(original);
  assert.deepEqual(original,snapshot,'never mutate the input project/checkpoint');
  const geometry=(key:string)=>directed.scenes.map(s=>{const a=s.objects.find(o=>o.characterKey===key)!;return [a.x,a.y,a.width,a.height,a.scale,a.facing];});
  for(const key of ['minh','lan'])assert.ok(geometry(key).every(g=>JSON.stringify(g)===JSON.stringify(geometry(key)[0])));
  assert.ok(directed.scenes.every(s=>s.camera?.shot==='medium'&&s.camera.motion==='none'&&!s.camera.keyframes));
  assert.ok(directed.scenes.every(s=>s.objects.some(o=>o.variant==='teapot')));
  for(const scene of directed.scenes){
    const preview=compileCanvasSceneLayout(scene,directed.width,directed.height);
    assert.deepEqual(preview.objects,scene.objects,'per-frame renderer must retain the compiled production stage');
  }
  const first=structuredClone(directed);
  for(let i=0;i<3;i++)directed=compileCanvasProjectLayout(directed);
  assert.deepEqual(directed,first,'production export and preview must not drift');
});

test('QC permits an intentional conversation hold, while retaining action and asset validation',()=>{
  const project=conversation();
  const report=evaluateCanvasVisualQuality(project);
  assert.ok(!report.issues.some(i=>i.code==='missing-semantic-focal'||i.code==='repeated-composition'||i.code==='large-overlap'),JSON.stringify(report.issues));
  const broken=conversation();broken.scenes.forEach(s=>{s.dialogue=undefined;s.animationBeats=[];});
  assert.ok(!evaluateCanvasVisualQuality(broken).issues.some(i=>i.code==='low-choreography-density'),'quiet holds do not require a gesture quota');
  broken.scenes[0]!.objects.find(o=>o.kind==='prop')!.heldBy='missing-holder';
  assert.ok(evaluateCanvasVisualQuality(broken).issues.some(i=>i.code==='invalid-physical-attachment'),'actual attachment errors still block production');
});

test('present daylight takes precedence over a future sunset mentioned in the visual brief',()=>{
  const project=conversation();
  project.scenes[1]!.visualBrief='Ánh sáng ban ngày chiếu vào phòng. Lan nhắc Minh mang áo khoác cho chuyến đi lúc hoàng hôn.';
  const directed=compileCanvasProjectLayout(project);
  assert.equal(directed.scenes[1]!.atmosphere?.timeOfDay,'day');
  assert.ok(directed.scenes[1]!.objects.some(o=>o.variant==='teapot'));
});

test('AI zero-state keyframes preserve static furnishings and do not cancel directed acting',()=>{
  const project=conversation();
  for(const scene of project.scenes)for(const object of scene.objects)object.keyframes=[{atMs:0,dx:0,dy:0,scale:1,rotation:0,opacity:1,pose:'idle'}];
  const directed=compileCanvasProjectLayout(project),scene=directed.scenes[0]!;
  const table=scene.objects.find(o=>o.variant==='table')!,teapot=scene.objects.find(o=>o.variant==='teapot')!;
  assert.ok(teapot.y<table.y-table.height*.1,'teapot rests above the tabletop instead of in front of its legs');
  assert.ok(directed.scenes[1]!.objects.some(o=>o.variant==='teapot'),'zero keyframes are static set dressing');
  const speaker=scene.objects.find(o=>o.characterKey==='minh')!,listener=scene.objects.find(o=>o.characterKey==='lan')!;
  assert.equal(applyCanvasChoreographyState(speaker,scene,1800).pose,'gesture');
  const acknowledgement=scene.animationBeats!.find(b=>b.action==='nod'&&b.targetIds.includes(listener.id))!;
  assert.ok(acknowledgement.durationMs>=700);
  assert.equal(applyCanvasChoreographyState(listener,scene,acknowledgement.atMs+400).pose,'nod');
});

test('a swapped AI shot never reverses established screen direction or partner gaze',()=>{
  const project=conversation();
  project.scenes[1]!.objects[0]!.slot='hero-right';project.scenes[1]!.objects[1]!.slot='hero-left';
  const directed=compileCanvasProjectLayout(project);
  for(const scene of directed.scenes){
    const minh=scene.objects.find(o=>o.characterKey==='minh')!,lan=scene.objects.find(o=>o.characterKey==='lan')!;
    assert.ok(minh.x<lan.x);assert.equal(minh.facing,'right');assert.equal(lan.facing,'left');
    assert.equal(minh.lookAtId,lan.id);assert.equal(lan.lookAtId,minh.id);
  }
});

test('routine listening uses one nod with planted feet, and speaking uses a restrained gesture',()=>{
  const project=compileCanvasProjectLayout(conversation()),scene=project.scenes[0]!;
  assert.ok(scene.animationBeats!.some(b=>b.action==='gesture'));
  assert.ok(scene.animationBeats!.some(b=>b.action==='nod'));
  assert.ok(!scene.animationBeats!.some(b=>b.action==='react'||b.action==='celebrate'));
  const listener=scene.objects.find(o=>o.characterKey==='lan')!;
  const rest=resolveStageCharacterRig(listener,scene,0,false).rig;
  for(const t of [4000,4200,4500,4800,5001]){
    const actor=applyCanvasChoreographyState(listener,scene,t),rig=resolveStageCharacterRig(actor,scene,t,false).rig;
    assert.ok(Math.abs(rig.footL.y-rest.footL.y)<.3);
    assert.deepEqual(evaluateCanvasChoreographyOffset(listener,scene,t),{x:0,y:0,scale:1,rotation:0,opacity:1});
  }
});

test('physical action, location changes and tense scenes retain authored staging; no future prop appears early',()=>{
  const project=conversation();
  project.scenes[1]!.objects.push(createCanvasObject('prop',{label:'Giỏ mới',variant:'basket',motion:'none'}));
  project.scenes[2]!.animationBeats!.push({id:'walk',action:'run',targetIds:['a-2'],atMs:0,durationMs:2000});
  const directed=directCanvasProject(project);
  assert.ok(!directed.scenes[0]!.objects.some(o=>o.variant==='basket'));
  assert.notEqual(directed.scenes[2]!.objects[0]!.x,directed.scenes[0]!.objects[0]!.x);
  const tense=conversation();tense.scenes[1]!.dialogue![0]!.emotion='tense';
  assert.ok(directCanvasProject(tense).scenes[1]!.animationBeats!.some(b=>b.action==='react'));
});
