import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCanvasObject,
  createCanvasProject,
  createCanvasScene,
  type CanvasStudioProject,
  type CanvasStudioScene,
} from './canvasAnimationStudio';
import {
  canvasLayoutFingerprint,
  compileCanvasProjectLayout,
  compileCanvasSceneLayout,
} from './canvasLayoutCompiler';
import { evaluateCanvasVisualQuality } from './canvasVisualQuality';
import {resolveCanvasAuthoredBackground} from './canvasAssetRegistry';
import {evaluateCanvasObject} from '../src/canvasAnimationStudio/runtime';
import {applyCanvasChoreographyState} from '../src/canvasAnimationStudio/choreography';

test('story cuts start with a complete stage instead of replaying presentation entrances',()=>{
  const source=createCanvasScene();source.template='two-shot';source.background='room';source.backgroundRef='bg:room-stilt-house';
  source.objects=[createCanvasObject('character',{id:'actor',motion:'slide-left',delayMs:300}),
    createCanvasObject('prop',{id:'box',variant:'box',motion:'pop',delayMs:200})];
  source.animationBeats=[{id:'intro',action:'reveal',targetIds:['actor','box'],atMs:400,durationMs:2400}];
  const scene=compileCanvasSceneLayout(source,1280,720);
  for(const object of scene.objects){
    const initial=evaluateCanvasObject(object,scene,0);
    assert.equal(initial.opacity,1);assert.equal(initial.x,object.x);assert.equal(initial.scale,object.scale);
    assert.deepEqual(evaluateCanvasObject(object,scene,400),initial);
  }
});

test('room furnishings retain their world anchors across cuts and reclining actors are grounded',()=>{
  const project=createCanvasProject();
  const first=createCanvasScene();first.template='two-shot';first.background='room';first.backgroundRef='bg:room-stilt-house';
  first.objects=[createCanvasObject('prop',{id:'cabinet-1',label:'Cabinet',variant:'box',slot:'background-left',motion:'none',role:'background'})];
  const second={...structuredClone(first),id:'sleep',template:'hero-left' as const,objects:[
    createCanvasObject('prop',{id:'cabinet-2',label:'Dark cabinet',variant:'box',slot:'background-right',motion:'none',role:'background'}),
    createCanvasObject('prop',{id:'bed',variant:'bed',slot:'background-left',sizeClass:'medium',motion:'none'}),
    createCanvasObject('character',{id:'sleeper',characterKey:'worker',pose:'lie-down',slot:'hero-left',motion:'none'}),
  ]};
  const third={...structuredClone(second),id:'close',template:'close-reaction' as const};
  third.objects[1]!.slot='hero';third.objects[1]!.sizeClass='hero';
  project.scenes=[first,second,third];
  const result=compileCanvasProjectLayout(project),cabinet=result.scenes[0]!.objects[0]!;
  for(const scene of result.scenes.slice(1)){
    const prop=scene.objects.find(o=>o.variant==='box')!,bed=scene.objects.find(o=>o.variant==='bed')!,actor=scene.objects.find(o=>o.kind==='character')!;
    assert.deepEqual([prop.x,prop.y,prop.width,prop.height],[cabinet.x,cabinet.y,cabinet.width,cabinet.height]);
    assert.ok(bed.y>project.height*.65,'mattress must be on the floor, not on the wall');
    assert.ok(bed.width>=project.width*.3,'bed must accommodate the recurring actor');
    assert.equal(actor.x,bed.x);assert.equal(actor.y,bed.y-bed.height*.2);
  }
  const a=result.scenes[1]!.objects.find(o=>o.variant==='bed')!,b=result.scenes[2]!.objects.find(o=>o.variant==='bed')!;
  assert.deepEqual([a.x,a.y,a.width,a.height],[b.x,b.y,b.width,b.height]);
  assert.deepEqual(compileCanvasProjectLayout(result),result,'export recompilation must not move the set');
});

test('flat interior depth maps character scale to a believable floor contact plane',()=>{
  const project=createCanvasProject();
  const scene=createCanvasScene();
  scene.template='wide-establishing';scene.background='room';scene.backgroundRef='bg:room-simple-night';
  scene.objects=[
    createCanvasObject('character',{id:'near',characterKey:'near',role:'focal',slot:'hero-left',motion:'none'}),
    createCanvasObject('character',{id:'far',characterKey:'far',role:'support',slot:'background-right',motion:'none'}),
  ];
  project.scenes=[scene];
  const compiled=compileCanvasProjectLayout(project).scenes[0]!;
  const near=compiled.objects.find(o=>o.id==='near')!,far=compiled.objects.find(o=>o.id==='far')!;
  const foot=(object:typeof near)=>object.y+Math.min(object.width/68,object.height/100)*46.8;
  const floorY=project.height*.76;
  assert.ok(foot(near)>floorY&&foot(far)>floorY,'both actors must stand on the floor plane');
  assert.ok(foot(far)<foot(near)-10,'smaller background actor must contact the floor closer to the horizon');
  assert.ok(far.height<near.height,'depth must still be expressed through scale');
  assert.deepEqual(compileCanvasProjectLayout({...project,scenes:[compiled]}).scenes[0],compiled,'perspective grounding stays idempotent');
});

test('stage furniture survives intervening clean inserts without adopting insert coordinates',()=>{
  const project=createCanvasProject();
  const room=createCanvasScene();
  room.stageId='room-7';room.template='hero-left';room.background='room';room.backgroundRef='bg:room-simple-night';
  room.objects=[
    createCanvasObject('character',{id:'linh-a',characterKey:'linh',slot:'hero-left',motion:'none'}),
    createCanvasObject('prop',{id:'table-a',label:'Bàn',variant:'table',slot:'mid-center',motion:'none',role:'support'}),
    createCanvasObject('prop',{id:'door-a',label:'Cửa',variant:'door',slot:'background-right',motion:'none',role:'support'}),
  ];
  const hall=createCanvasScene();
  hall.stageId='hall';hall.template='close-reaction';hall.background='city';hall.backgroundRef='bg:city-hallway';
  hall.objects=[createCanvasObject('character',{id:'linh-h',characterKey:'linh',slot:'hero-left',motion:'none'})];
  const insert=createCanvasScene();
  insert.stageId='room-7';insert.template='prop-focus';insert.background='room';insert.backgroundRef='bg:room-simple-night';
  insert.camera={shot:'close-up',motion:'none',focusX:640,focusY:390,zoom:1.2};
  insert.objects=[
    createCanvasObject('prop',{id:'note',label:'Mảnh giấy',variant:'note',role:'focal',slot:'hero'}),
    createCanvasObject('prop',{id:'door-insert',label:'Cửa',variant:'door',role:'support',slot:'support-left',motion:'none'}),
  ];
  const reaction=createCanvasScene();
  reaction.stageId='room-7';reaction.template='close-reaction';reaction.background='room';reaction.backgroundRef='bg:room-simple-night';
  reaction.camera={shot:'close-up',motion:'none',focusX:390,focusY:360,zoom:1.12};
  reaction.objects=[createCanvasObject('character',{id:'linh-b',characterKey:'linh',slot:'hero-left',motion:'none'})];
  project.scenes=[room,hall,insert,reaction];
  const result=compileCanvasProjectLayout(project);
  const baseDoor=result.scenes[0]!.objects.find(o=>o.variant==='door')!;
  const returnDoor=result.scenes[3]!.objects.find(o=>o.variant==='door')!;
  const baseTable=result.scenes[0]!.objects.find(o=>o.variant==='table')!;
  const returnTable=result.scenes[3]!.objects.find(o=>o.variant==='table')!;
  assert.deepEqual(
    [returnDoor.x,returnDoor.y,returnDoor.width,returnDoor.height,returnDoor.slot],
    [baseDoor.x,baseDoor.y,baseDoor.width,baseDoor.height,baseDoor.slot],
    'clean insert door cannot redefine the physical room door',
  );
  assert.deepEqual(
    [returnTable.x,returnTable.y,returnTable.width,returnTable.height,returnTable.slot],
    [baseTable.x,baseTable.y,baseTable.width,baseTable.height,baseTable.slot],
  );
  assert.deepEqual(compileCanvasProjectLayout(result),result,'stage registry must remain idempotent after recompilation');
});

test('prop-focus floor clue stays hero-sized and idempotent across export recompilation',()=>{
  const project=createCanvasProject();
  const room=createCanvasScene();
  room.stageId='room-7';room.template='hero-left';room.background='room';room.backgroundRef='bg:room-simple-night';
  room.objects=[createCanvasObject('prop',{id:'door',label:'Cửa',variant:'door',slot:'background-right',motion:'none',role:'support'})];
  const clue=createCanvasScene();
  clue.stageId='room-7';clue.template='prop-focus';clue.background='room';clue.backgroundRef='bg:room-simple-night';
  clue.narration='Một mảnh giấy nằm dưới khe cửa.';
  clue.camera={shot:'close-up',motion:'none',focusX:640,focusY:390,zoom:1.1};
  clue.objects=[
    createCanvasObject('prop',{id:'note',label:'Mảnh giấy',variant:'note',role:'focal',slot:'hero',sizeClass:'hero'}),
    createCanvasObject('prop',{id:'door-close',label:'Cửa',variant:'door',role:'support',slot:'support-left',motion:'none'}),
  ];
  project.scenes=[room,clue];
  const first=compileCanvasProjectLayout(project);
  const note=first.scenes[1]!.objects.find(o=>o.id==='note')!;
  assert.ok(note.width>=project.width*.28,'floor grounding must not shrink the focal close insert');
  const second=compileCanvasProjectLayout(first);
  const note2=second.scenes[1]!.objects.find(o=>o.id==='note')!;
  assert.deepEqual([note2.x,note2.y,note2.width,note2.height],[note.x,note.y,note.width,note.height]);
});

test('quiet narration holds keep recurring actors on their established sides',()=>{
  const project=createCanvasProject(),first=createCanvasScene();first.template='two-shot';first.background='room';first.backgroundRef='bg:room-stilt-house';
  first.narration='The two workers wait quietly.';
  first.objects=[createCanvasObject('character',{id:'a',characterKey:'a',slot:'hero-left',pose:'idle',motion:'none'}),
    createCanvasObject('character',{id:'b',characterKey:'b',slot:'hero-right',pose:'idle',motion:'none'})];
  const next=structuredClone(first);next.id='next';next.objects[0]!.slot='hero-right';next.objects[1]!.slot='hero-left';
  project.scenes=[first,next];const result=compileCanvasProjectLayout(project);
  for(const [i,actor] of result.scenes[0]!.objects.entries())assert.equal(result.scenes[1]!.objects[i]!.x,actor.x);
  assert.deepEqual(compileCanvasProjectLayout(result),result);
});

test('dimming a lamp changes emitted light without fading or shrinking its physical frame',()=>{
  const scene=createCanvasScene();scene.template='two-shot';scene.background='room';scene.backgroundRef='bg:room-stilt-house';
  scene.objects=[createCanvasObject('prop',{variant:'lantern',motion:'none',keyframes:[
    {atMs:0,lightLevel:1,opacity:1,scale:1},{atMs:1500,lightLevel:0,opacity:.3,scale:.96},
  ]})];
  const compiled=compileCanvasSceneLayout(scene,1280,720),lamp=compiled.objects[0]!;
  assert.equal(evaluateCanvasObject(lamp,compiled,1500).opacity,1);
  assert.equal(evaluateCanvasObject(lamp,compiled,1500).scale,1);
  assert.equal(applyCanvasChoreographyState(lamp,compiled,1500).lightLevel,0);
});

test('a narrated sleeping actor rests on the mattress instead of standing behind it',()=>{
  const scene=createCanvasScene();scene.template='hero-left';scene.background='room';scene.backgroundRef='bg:room-stilt-house';
  scene.narration='The worker is asleep on the bed.';
  scene.objects=[createCanvasObject('prop',{variant:'bed',slot:'hero-left',motion:'none'}),
    createCanvasObject('character',{pose:'idle',slot:'mid-left',motion:'none',keyframes:[{atMs:0,pose:'idle'}]})];
  const result=compileCanvasSceneLayout(scene,1280,720),actor=result.objects[1]!,bed=result.objects[0]!;
  assert.equal(actor.pose,'lie-down');assert.equal(actor.keyframes![0]!.pose,'lie-down');
  assert.equal(actor.x,bed.x);assert.ok(actor.zIndex>bed.zIndex);
});

test('manual raw stages and ambiguous duplicate furniture never inherit another object anchor',()=>{
  const project=createCanvasProject(),first=createCanvasScene();first.objects=[createCanvasObject('prop',{variant:'box',motion:'none',x:200})];
  first.template=undefined;
  const second=structuredClone(first);second.id='second';second.objects[0]!.x=900;
  project.scenes=[first,second];const raw=compileCanvasProjectLayout(project);
  assert.deepEqual(raw.scenes.map(scene=>scene.objects[0]!.x),[200,900]);
  first.template='two-shot';first.objects=[createCanvasObject('prop',{variant:'box',motion:'none',label:'Box',slot:'background-left'}),
    createCanvasObject('prop',{variant:'box',motion:'none',label:'Box',slot:'background-right'})];
  project.scenes=[first];const duplicated=compileCanvasProjectLayout(project).scenes[0]!;
  assert.ok(duplicated.objects[0]!.x<duplicated.objects[1]!.x);
});

test('two occupied ferries receive separate hulls and retain their own passengers',()=>{
  const scene=createCanvasScene();scene.template='two-shot';scene.background='river';
  scene.objects=[createCanvasObject('ship',{id:'boat-a',assetRef:'ship:wooden-ferry'}),createCanvasObject('ship',{id:'boat-b',assetRef:'ship:wooden-ferry'}),
    createCanvasObject('character',{id:'an',onBoat:'boat-a'}),createCanvasObject('character',{id:'villager',onBoat:'boat-b'})];
  const result=compileCanvasSceneLayout(scene,1280,720),[a,b]=result.objects;
  assert.ok(a!.x+a!.width/2<b!.x-b!.width/2);
  assert.equal(result.objects[2]!.x,a!.x);assert.equal(result.objects[3]!.x,b!.x);
  assert.deepEqual(compileCanvasSceneLayout(result,1280,720).objects,result.objects);
});

test('aid owns staging after reach and assist never stages the patient against itself',()=>{
  for(const facing of ['left','right'] as const){
    const patient=createCanvasObject('character',{id:'patient',facing,pose:'sit',sittingStyle:'injured',legBandage:'right',role:'support',slot:'hero-right'});
    const helper=createCanvasObject('character',{id:'helper',facing:'right',role:'focal',slot:'hero-left'});
    const beat=(action:'reach'|'aid'|'assist',targetIds=['helper'])=>({id:action,action,targetIds,focusTargetId:'patient',atMs:0,durationMs:1000,intensity:1});
    const source:CanvasStudioScene={id:'aid',name:'aid',durationMs:3000,background:'room',template:'two-shot',objects:[helper,patient],animationBeats:[beat('reach'),beat('aid')]};
    const compiled=compileCanvasSceneLayout(source,1280,720);
    assert.deepEqual(compiled.objects,compileCanvasSceneLayout({...source,animationBeats:[beat('aid')]},1280,720).objects);
    const assisted=compileCanvasSceneLayout({...source,animationBeats:[beat('assist',['helper','patient'])]},1280,720);
    const a=assisted.objects[0]!,b=assisted.objects[1]!;
    assert.ok(Math.abs(a.x-b.x)>b.width*.55,'helper stays beside patient, not inside torso');
    assert.equal(b.x,compiled.objects[1]!.x,'patient stays at its own anchor');
    assert.deepEqual(assisted,compileCanvasSceneLayout(assisted,1280,720));
  }
});

test('physical cues infer unambiguous phone ownership and rope tree attachment',()=>{
  const actor=createCanvasObject('character',{id:'actor',role:'focal',slot:'hero-left'});
  const phone=createCanvasObject('prop',{id:'phone',variant:'phone'});
  const rope=createCanvasObject('prop',{id:'rope',variant:'rope'});
  const tree=createCanvasObject('prop',{id:'tree',variant:'tree',depth:'background'});
  const source:CanvasStudioScene={id:'contact',name:'contact',durationMs:3000,background:'field',backgroundRef:'bg:field-open',template:'prop-focus',objects:[actor,phone,rope,tree],animationBeats:[
    {id:'call',action:'reach',targetIds:['actor'],speechCue:'tiếng chuông điện thoại',atMs:0,durationMs:1000,intensity:1},
    {id:'tie',action:'tie',targetIds:['actor'],focusTargetId:'rope',atMs:1500,durationMs:1000,intensity:1},
  ]};
  const result=compileCanvasSceneLayout(source,1280,720);
  assert.equal(result.objects[1]!.heldBy,'actor');assert.equal(result.objects[2]!.tiedTo,'tree');
  assert.ok(result.objects[1]!.width<result.objects[0]!.width*.15);
  assert.ok(resolveCanvasAuthoredBackground(result),'background must support the chosen template');
  assert.equal(phone.heldBy,undefined);assert.equal(rope.tiedTo,undefined);
});

test('reciprocal assistance anchors the injured patient and cannot drag the pair off stage',()=>{
  const helper=createCanvasObject('character',{id:'helper',role:'focal',slot:'hero-left',facing:'right',keyframes:[{atMs:0,facing:'right',pose:'assist'}]});
  const patient=createCanvasObject('character',{id:'patient',role:'support',slot:'hero-right',pose:'sit',legBandage:'right',facing:'left',keyframes:[{atMs:0,facing:'left',pose:'sit'},{atMs:1000,pose:'assist'}]});
  const beats=[
    {id:'hold',action:'assist' as const,targetIds:['helper','patient'],focusTargetId:'helper',atMs:0,durationMs:1000},
    {id:'rise',action:'assist' as const,targetIds:['helper','patient'],focusTargetId:'patient',atMs:1000,durationMs:1500},
  ];
  const source:CanvasStudioScene={id:'rise',name:'rise',durationMs:3000,background:'room',template:'two-shot',objects:[helper,patient],animationBeats:beats};
  const result=compileCanvasSceneLayout(source,1280,720);
  assert.equal(result.objects[1]!.x,compileCanvasSceneLayout({...source,animationBeats:[]},1280,720).objects[1]!.x);
  assert.ok(result.objects[0]!.x>500,'pair remains beside its original patient anchor');
  assert.equal(applyCanvasChoreographyState(result.objects[1]!,result,1500).lookAtId,'helper','patient targets companion rather than own shoulder');
  assert.deepEqual(result,compileCanvasSceneLayout(result,1280,720));
});

test('close examination frames the knee and does not inflate only the caregiver',()=>{
  const source:CanvasStudioScene={id:'detail',name:'detail',durationMs:3000,background:'room',template:'close-reaction',camera:{shot:'extreme-close-up',motion:'none',focusX:640,focusY:360,zoom:1.3},objects:[
    createCanvasObject('character',{id:'helper',role:'focal',sizeClass:'hero'}),
    createCanvasObject('character',{id:'patient',role:'support',sizeClass:'large',pose:'sit',sittingStyle:'injured',legBandage:'right'}),
  ],animationBeats:[{id:'aid',action:'aid',targetIds:['helper'],focusTargetId:'patient',atMs:0,durationMs:3000}]};
  const result=compileCanvasSceneLayout(source,1280,720),patient=result.objects[1]!;
  assert.ok(result.objects[0]!.height<=patient.height*1.121);
  assert.ok(result.camera!.focusY>patient.y+patient.height*.2,'camera frames the lower-body interaction');
  assert.deepEqual(result,compileCanvasSceneLayout(result,1280,720));
});

test('held phone follows actor proportions rather than semantic prop slot size',()=>{
  const actor=createCanvasObject('character',{id:'caller',width:200,height:320});
  const phone=createCanvasObject('prop',{variant:'phone',heldBy:'caller',width:180,height:180});
  for(const template of [undefined,'two-shot'] as const){
    const source:CanvasStudioScene={id:'call',name:'call',durationMs:3000,background:'room',template,objects:[actor,phone]};
    const compiled=compileCanvasSceneLayout(source,1280,720),holder=compiled.objects[0]!,held=compiled.objects[1]!;
    assert.ok(held.width<holder.width*.15);
    assert.ok(held.height<holder.height*.23);
    assert.ok(held.height>held.width*2);
    assert.deepEqual(compiled,compileCanvasSceneLayout(compiled,1280,720));
    assert.equal(phone.width,180,'source plan is preserved');
  }
});

test('ferry passenger sits inside the hull and follows the moving vessel',()=>{
  const boat=createCanvasObject('ship',{id:'boat',assetRef:'ship:wooden-ferry',x:700,y:500,width:430,height:120,motion:'drift-right',zIndex:15});
  const person=createCanvasObject('character',{id:'rower',onBoat:'boat',boatSeat:-.2,pose:'row',height:190,zIndex:30});
  const scene:CanvasStudioScene={id:'ferry',name:'ferry',durationMs:5000,background:'river',objects:[boat,person]};
  const compiled=compileCanvasSceneLayout(scene,1280,720),actor=compiled.objects.find(o=>o.id==='rower')!,vessel=compiled.objects.find(o=>o.id==='boat')!;
  assert.equal(actor.pose,'row');assert.equal(actor.x,614);assert.ok(actor.y<boat.y);assert.ok(vessel.zIndex>actor.zIndex);
  const a=evaluateCanvasObject(actor,compiled,1000),b=evaluateCanvasObject(actor,compiled,3000);
  const va=evaluateCanvasObject(vessel,compiled,1000),vb=evaluateCanvasObject(vessel,compiled,3000);
  assert.ok(Math.abs((b.x-a.x)-(vb.x-va.x))<.001);
  assert.deepEqual(compiled,compileCanvasSceneLayout(compiled,1280,720));
});

test('night shoreline is a registered nighttime establishing/detail environment',()=>{
  for(const template of ['wide-establishing','close-reaction'] as const) {
    const asset=resolveCanvasAuthoredBackground({background:'night',backgroundRef:'bg:night-river-shoreline',template});
    assert.ok(asset&&asset.detailScore>=9);
  }
  assert.equal(resolveCanvasAuthoredBackground({background:'river',backgroundRef:'bg:night-river-shoreline'}),undefined);
});

function scene(overrides: Partial<CanvasStudioScene> = {}): CanvasStudioScene {
  return {
    id: 'scene-test',
    name: 'Semantic layout',
    durationMs: 3000,
    template: 'hero-left',
    background: 'field',
    backgroundRef: 'bg:field-open',
    narration: 'Narration',
    camera: { shot: 'medium', motion: 'push-in', focusX: 640, focusY: 360, zoom: 1 },
    effects: [],
    objects: [
      createCanvasObject('character', {
        id: 'hero',
        role: 'focal',
        slot: 'hero-left',
        depth: 'midground',
        sizeClass: 'large',
        x: 999,
        y: 999,
      }),
      createCanvasObject('prop', {
        id: 'support',
        role: 'support',
        slot: 'support-right',
        depth: 'midground',
        sizeClass: 'medium',
        variant: 'shield',
        x: 10,
        y: 10,
      }),
    ],
    ...overrides,
  };
}

test('semantic layout compiler owns authored pixels when template/slot are present', () => {
  const compiled = compileCanvasSceneLayout(scene(), 1280, 720);
  const hero = compiled.objects.find((object) => object.id === 'hero')!;
  const support = compiled.objects.find((object) => object.id === 'support')!;
  assert.equal(compiled.template, 'hero-left');
  assert.ok(hero.x < 500);
  assert.ok(hero.y < 600);
  assert.ok(hero.height > 300);
  assert.ok(support.x > 700);
  assert.equal(compiled.camera?.focusX, hero.x);
  assert.equal(compiled.camera?.focusY, hero.y);
});

test('legacy raw layout remains untouched when no semantic layout fields exist', () => {
  const legacy = scene({
    template: undefined,
    objects: [
      createCanvasObject('character', {
        id: 'legacy',
        role: 'focal',
        slot: undefined,
        depth: undefined,
        sizeClass: undefined,
        x: 222,
        y: 333,
        width: 155,
        height: 277,
      }),
    ],
  });
  const compiled = compileCanvasSceneLayout(legacy, 1280, 720);
  assert.equal(compiled.objects[0]!.x, 222);
  assert.equal(compiled.objects[0]!.y, 333);
  assert.equal(compiled.objects[0]!.height, 277);
});

test('visual quality rejects repeated compositions and missing semantic focal', () => {
  const repeated = scene({
    objects: [
      createCanvasObject('text', {
        id: 'only-text',
        role: 'focal',
        slot: 'caption-top',
        text: 'A title card that is much too long for this engine',
      }),
    ],
  });
  const project: CanvasStudioProject = {
    version: 1,
    id: 'quality-project',
    name: 'Quality',
    width: 1280,
    height: 720,
    fps: 30,
    scenes: Array.from({ length: 6 }, (_, index) => ({
      ...repeated,
      id: `bad-${index}`,
      name: `Bad ${index}`,
    })),
  };
  const report = evaluateCanvasVisualQuality(project);
  assert.equal(report.pass, false);
  assert.ok(report.issues.some((issue) => issue.code === 'missing-semantic-focal'));
  assert.ok(report.issues.some((issue) => issue.code === 'repeated-composition'));
  assert.ok(report.issues.some((issue) => issue.code === 'low-template-variety'));
});

test('layout fingerprint changes when template or slot arrangement changes', () => {
  const a = compileCanvasSceneLayout(scene(), 1280, 720);
  const b = compileCanvasSceneLayout(scene({
    id: 'b',
    template: 'two-shot',
    objects: [
      createCanvasObject('character', { id: 'left', role: 'focal', slot: 'hero-left' }),
      createCanvasObject('character', { id: 'right', role: 'support', slot: 'hero-right' }),
    ],
  }), 1280, 720);
  assert.notEqual(canvasLayoutFingerprint(a), canvasLayoutFingerprint(b));
});

test('project compiler is deterministic', () => {
  const project: CanvasStudioProject = {
    version: 1,
    id: 'p',
    name: 'p',
    width: 1280,
    height: 720,
    fps: 30,
    scenes: [scene()],
  };
  assert.deepEqual(compileCanvasProjectLayout(project), compileCanvasProjectLayout(project));
});


test('visual quality requires authored asset coverage for semantic props', () => {
  const unsupported = scene({
    id: 'unsupported-asset-scene',
    objects: [
      createCanvasObject('character', {
        id: 'hero-supported',
        role: 'focal',
        slot: 'hero-left',
        assetRef: 'character:narrator',
        archetype: 'narrator',
      }),
      createCanvasObject('prop', {
        id: 'unsupported-prop',
        role: 'support',
        slot: 'support-right',
        variant: 'factory',
        assetRef: 'prop:factory',
      }),
    ],
  });
  const project: CanvasStudioProject = {
    version: 1,
    id: 'unsupported-coverage',
    name: 'Unsupported Coverage',
    width: 1280,
    height: 720,
    fps: 30,
    scenes: [unsupported],
  };
  const report = evaluateCanvasVisualQuality(project);
  assert.equal(report.pass, false);
  assert.ok(report.issues.some((issue) => issue.code === 'unsupported-authored-asset'));
  assert.equal(report.stats.authoredCoverage < 1, true);
});


test('visual quality rejects background refs that do not match scene family/template', () => {
  const badBackground = scene({
    id: 'bad-background-scene',
    background: 'field',
    backgroundRef: 'bg:room-study',
    template: 'hero-left',
  });
  const project: CanvasStudioProject = {
    version: 1,
    id: 'bad-background-project',
    name: 'Bad Background',
    width: 1280,
    height: 720,
    fps: 30,
    scenes: [badBackground],
  };
  const report = evaluateCanvasVisualQuality(project);
  assert.equal(report.pass, false);
  assert.ok(report.issues.some((issue) => issue.code === 'unsupported-authored-background'));
  assert.equal(report.stats.backgroundCoverage, 0);
});

test('five-toed anatomy is compiled from animal descriptions without overriding explicit ordinary pigs',()=>{
 const p=createCanvasProject(),s=createCanvasScene();p.sourcePrompt='Sự tích heo năm móng';
 s.objects=[createCanvasObject('prop',{variant:'pig',label:'Năm'}),createCanvasObject('prop',{variant:'pig-hoof',designNotes:'Bàn chân heo có năm móng.'}),createCanvasObject('prop',{variant:'pig',hoofCount:4})];
 p.scenes=[s];const result=compileCanvasProjectLayout(p);
 assert.deepEqual(result.scenes[0]!.objects.map(o=>o.hoofCount),[5,5,4]);
 assert.deepEqual(compileCanvasProjectLayout(result),result);
});

test('a passive animal is grounded and moved clear of actors without moving a real contact target',()=>{
 const p=createCanvasProject(),s=createCanvasScene();s.template='two-shot';s.background='field';s.backgroundRef='bg:field-open';
 s.objects=[createCanvasObject('character',{id:'an',slot:'hero-left',role:'focal'}),createCanvasObject('character',{id:'mai',slot:'mid-center',role:'support'}),createCanvasObject('prop',{id:'pig',variant:'pig',slot:'hero-right',role:'support'})];
 p.scenes=[s];const result=compileCanvasProjectLayout(p);
 assert.ok(!evaluateCanvasVisualQuality(result).issues.some(i=>i.code==='large-overlap'));
 assert.deepEqual(compileCanvasProjectLayout(result),result);
 s.animationBeats=[{id:'wipe',action:'wipe',targetIds:['an'],focusTargetId:'pig',atMs:0,durationMs:1000}];
 const contact=compileCanvasProjectLayout(p).scenes[0]!;
 assert.ok(Math.abs(contact.objects[2]!.x-contact.objects[0]!.x)<150,'contact target remains within arm reach');
});

test('horror QC rejects standing actors and floor furniture without a physical floor contact',()=>{
  const project=createCanvasProject();
  project.sourcePrompt='truyện ma kinh dị trong phòng trọ';
  const s=createCanvasScene();
  s.id='missing-ground';s.name='Missing ground';s.stageId='room-a';
  s.background='room';s.backgroundRef='bg:room-simple-night';s.template='hero-left';
  s.objects=[
    createCanvasObject('character',{id:'actor',characterKey:'linh',label:'Linh',visualStyle:'horror',role:'focal',slot:'hero-left',assetRef:'character:villager'}),
    createCanvasObject('prop',{id:'table',label:'Bàn',variant:'table',role:'support',slot:'mid-center',assetRef:'prop:table'}),
  ];
  project.scenes=[s];
  const report=evaluateCanvasVisualQuality(project);
  const grounding=report.issues.filter(issue=>issue.code==='missing-ground-contact');
  assert.ok(grounding.some(issue=>/actor Linh/i.test(issue.message)));
  assert.ok(grounding.some(issue=>/Floor prop Bàn/i.test(issue.message)));
});

test('horror QC accepts grounded actors, grounded furniture and valid tabletop attachments',()=>{
  const project=createCanvasProject();
  project.sourcePrompt='truyện ma kinh dị trong phòng trọ';
  const s=createCanvasScene();
  s.id='grounded-set';s.name='Grounded set';s.stageId='room-a';
  s.background='room';s.backgroundRef='bg:room-simple-night';s.template='hero-left';
  s.objects=[
    createCanvasObject('character',{id:'actor',characterKey:'linh',label:'Linh',visualStyle:'horror',role:'focal',slot:'hero-left',assetRef:'character:villager',groundY:598}),
    createCanvasObject('prop',{id:'table',label:'Bàn',variant:'table',role:'support',slot:'mid-center',assetRef:'prop:table',groundY:598}),
    createCanvasObject('prop',{id:'lamp',label:'Đèn',variant:'lantern',role:'support',slot:'support-right',assetRef:'prop:lantern',restingOn:'table'}),
  ];
  project.scenes=[s];
  const report=evaluateCanvasVisualQuality(project);
  assert.ok(!report.issues.some(issue=>issue.code==='missing-ground-contact'));
  assert.ok(!report.issues.some(issue=>issue.code==='invalid-physical-attachment'&&/restingOn/.test(issue.message)));
});

test('reference-style benchmark reaches 9/10 for restrained horror pacing and internal visual events',()=>{
  const project=createCanvasProject();
  project.sourcePrompt='truyện ma đô thị';
  project.scenes=Array.from({length:7},(_,index)=>{
    const s=createCanvasScene(index);
    s.durationMs=8000;
    s.stageId='apartment-room';
    s.background='room';
    s.backgroundRef='bg:room-study';
    s.template=(['hero-left','two-shot','close-reaction','hero-right','prop-focus','two-shot','close-reaction'] as const)[index]!;
    s.camera={shot:s.template==='prop-focus'||s.template==='close-reaction'?'close-up':'medium',motion:'none',focusX:640,focusY:360,zoom:1,
      keyframes:[{atMs:0,zoom:1,dx:0,dy:0},{atMs:8000,zoom:1.015,dx:0,dy:-3,easing:'ease-in-out'}]};
    s.atmosphere={timeOfDay:'night',filmGrain:.2,shadowBreath:.18,dustMotes:.1,lampBreath:.12,wind:.06};
    const actor=createCanvasObject('character',{id:`actor-${index}`,characterKey:'linh',label:'Linh',role:'focal',slot:'hero-left',motion:'none',assetRef:'character:villager'});
    const lamp=createCanvasObject('prop',{id:`lamp-${index}`,label:'Đèn',variant:'lantern',role:'support',slot:'support-right',motion:'none',assetRef:'prop:lantern'});
    s.objects=[actor,lamp];
    s.visualBeats=[{id:`vb-${index}`,atMs:3200,durationMs:500,action:'expression-change',targetIds:[actor.id],expression:'afraid'}];
    s.narration='Linh đứng im trong căn phòng tối và nhận ra có điều gì đó không ổn.';
    return s;
  });
  const report=evaluateCanvasVisualQuality(project);
  assert.ok(report.stats.referenceStyleScore>=90,`score=${report.stats.referenceStyleScore}`);
  assert.ok(report.stats.majorShotsPerMinute>=7&&report.stats.majorShotsPerMinute<=8.5);
  assert.ok(report.stats.visualEventsPerMinute>=12);
});

test('reference-style benchmark rejects busy camera, decorative loops and empty long holds',()=>{
  const project=createCanvasProject();
  project.sourcePrompt='truyện ma kinh dị';
  project.scenes=Array.from({length:3},(_,index)=>{
    const s=createCanvasScene(index);
    s.durationMs=15000;
    s.background='room';s.backgroundRef='bg:room-study';s.template='hero-left';
    s.camera={shot:'medium',motion:'none',focusX:640,focusY:360,zoom:1,keyframes:[{atMs:0,zoom:1},{atMs:15000,zoom:1.16,dx:80,dy:35}]};
    s.objects=[createCanvasObject('character',{id:`busy-${index}`,characterKey:`busy-${index}`,role:'focal',slot:'hero-left',motion:'bounce',assetRef:'character:villager'})];
    s.narration='Nhân vật đứng yên rất lâu trong bóng tối nhưng khung hình lại rung và chuyển động trang trí liên tục.';
    s.atmosphere=undefined;s.stageId=undefined;s.visualBeats=[];s.animationBeats=[];
    return s;
  });
  const report=evaluateCanvasVisualQuality(project);
  assert.ok(report.stats.referenceStyleScore<78,`score=${report.stats.referenceStyleScore}`);
  assert.ok(report.issues.some(issue=>issue.code==='reference-style-gap'));
  assert.equal(report.pass,false);
});
