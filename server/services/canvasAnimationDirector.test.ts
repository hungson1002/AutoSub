import assert from 'node:assert/strict';
import test from 'node:test';
import { CANVAS_STUDIO_VERSION } from '../../shared/canvasAnimationStudio';
import { parsePlan,repairCanvasPlanJsonText, splitNarration,wrapCanvasSceneRepair } from './canvasAnimationDirector';
import {defaultCanvasAssetRef} from '../../shared/canvasAssetRegistry';
import {applyCanvasChoreographyState} from '../../src/canvasAnimationStudio/choreography';
import {resolveStageCharacterRig,canvasCharacterHand} from '../../src/canvasAnimationStudio/characters/characterStaging';
import {characterDrawingScale} from '../../src/canvasAnimationStudio/characters/characterModel';

test('one-scene visual repairs accept scene envelopes without losing scene content',()=>{
  const scene={name:'Phone',narration:'Minh nghe điện thoại.',objects:[{kind:'character',label:'Minh',characterKey:'minh'}]};
  for(const reply of [scene,{scene},{name:'Film',scenes:[scene]},{brief:'request',project:{name:'Film',scenes:[scene]}}]){
    const project=parsePlan(wrapCanvasSceneRepair(JSON.stringify(reply)),'story');
    assert.equal(project.scenes.length,1);assert.equal(project.scenes[0]!.narration,scene.narration);
  }
  assert.equal(wrapCanvasSceneRepair('{"pass":false}'),'{"pass":false}','an audit report is not a scene');
});

test('AI walk aliases survive object, keyframe and beat normalization',()=>{
  const p=parsePlan(JSON.stringify({scenes:[{narration:'Minh đi chậm.',objects:[{kind:'character',label:'Minh',characterKey:'minh',pose:'walk',keyframes:[{atMs:0,pose:'walk'},{atMs:3000,dx:80,pose:'walk'}]}],animationBeats:[{action:'walk',targets:['minh'],atMs:0,durationMs:3000,speechCue:'đi chậm'}]}]}),'story');
  assert.equal(p.scenes[0]!.objects[0]!.pose,'run');
  assert.ok(p.scenes[0]!.objects[0]!.keyframes?.every(frame=>frame.pose==='run'));
  assert.equal(p.scenes[0]!.animationBeats?.[0]?.action,'run');
});

test('declared shirt colors survive procedural palette defaults and stay consistent across shots',()=>{
  const p=parsePlan(JSON.stringify({scenes:[{narration:'Minh đến thăm bác.',objects:[
    {kind:'character',label:'Minh',characterKey:'minh',archetype:'villager',designNotes:'Minh mặc áo sơ mi cộc tay màu xanh lam.'},
    {kind:'character',label:'Duy',characterKey:'duy',archetype:'villager',designNotes:'Duy mặc áo nâu.'},
  ]},{narration:'Minh kiểm tra chân.',objects:[{kind:'character',label:'Minh',characterKey:'minh',archetype:'villager'}]}]}),'story');
  assert.notEqual(p.scenes[0]!.objects[0]!.color,p.scenes[0]!.objects[1]!.color);
  assert.equal(p.scenes[0]!.objects[0]!.color,'#607b8c');
  assert.equal(p.scenes[1]!.objects[0]!.color,p.scenes[0]!.objects[0]!.color);
});

test('untreated, wrapping and treated injury states survive normalization and timed playback',()=>{
  const p=parsePlan(JSON.stringify({name:'Treatment',scenes:[{
    name:'Treatment',durationMs:4000,narration:'Minh kiểm tra rồi băng chân cho bác Duy.',background:'room',
    objects:[{kind:'character',label:'Duy',characterKey:'duy',pose:'sit',sittingStyle:'injured',legBandage:'right',bandageProgress:0,
      keyframes:[{atMs:0,bandageProgress:0},{atMs:1500,bandageProgress:0},{atMs:3000,bandageProgress:1},{atMs:3500,expression:'happy'}]}],animationBeats:[],
  }]}),'horror');
  const scene=p.scenes[0]!,patient=scene.objects[0]!;
  assert.equal(patient.bandageProgress,0);
  assert.equal(applyCanvasChoreographyState(patient,scene,1000).bandageProgress,0);
  assert.equal(applyCanvasChoreographyState(patient,scene,2250).bandageProgress,.5);
  assert.equal(applyCanvasChoreographyState(patient,scene,3900).bandageProgress,1);
  assert.equal(applyCanvasChoreographyState(patient,scene,1000).sittingStyle,'injured');
  const repaired=parsePlan(JSON.stringify(p),'horror');
  assert.deepEqual(repaired.scenes[0]!.objects[0]!.keyframes,patient.keyframes);
  assert.equal(applyCanvasChoreographyState({...patient,bandageProgress:undefined,keyframes:undefined},scene,1000).bandageProgress,undefined,'old bandaged characters keep the renderer default');
});

test('production stages real manual contact and preserves interaction references on a repair pass',()=>{
  for(const [action,variant] of [['wipe','lantern'],['write','note'],['tie','rope']] as const){
    const p=parsePlan(JSON.stringify({name:'Contact',scenes:[{name:action,background:'room',backgroundRef:'bg:room-stilt-house',narration:'Minh làm việc.',animationBeats:[{action,targets:['minh'],focusTargetId:variant,speechCue:'làm việc',atMs:0,durationMs:2600}],objects:[
      {kind:'character',label:'Minh',characterKey:'minh',role:'focal',sizeClass:'large'},
      {kind:'prop',label:variant,variant,role:'support'},
      {kind:'prop',label:'Phone',variant:'phone',heldBy:'minh'},
    ]}]}),'horror story');
    const scene=p.scenes[0]!,actor=applyCanvasChoreographyState(scene.objects[0]!,scene,1000),target=scene.objects[1]!;
    const hand=canvasCharacterHand(actor,scene,1000,false),{model}=resolveStageCharacterRig(actor,scene,1000,false);
    const fit=characterDrawingScale(actor,model);
    // Remove phone attachment for the physical contact check; it intentionally
    // constrains the same hand and cannot be performed concurrently.
    scene.objects=scene.objects.filter(o=>o.variant!=='phone');
    const physicalHand=canvasCharacterHand(actor,scene,1000,false);
    assert.ok(Math.hypot(physicalHand.x-target.x,physicalHand.y-target.y)<fit*4);
    if(action!=='tie')assert.notDeepEqual(resolveStageCharacterRig(actor,scene,600,false).rig.handR,resolveStageCharacterRig(actor,scene,1400,false).rig.handR);
    assert.ok(Number.isFinite(hand.x));
    const repaired=parsePlan(JSON.stringify(p),p.sourcePrompt!);
    assert.equal(repaired.scenes[0]!.animationBeats![0]!.focusTargetId,target.id);
  }
});

test('repair normalization retains heldBy ids and the explicit injured sitting style',()=>{
  const p=parsePlan(JSON.stringify({name:'Call',scenes:[{name:'Call',narration:'Bác Duy đang gọi.',background:'room',objects:[
    {kind:'character',label:'Duy',characterKey:'duy',pose:'sit',sittingStyle:'injured'},
    {kind:'prop',label:'Phone',variant:'phone',heldBy:'duy'},
  ],animationBeats:[]}]}),'horror');
  const repaired=parsePlan(JSON.stringify(p),'horror');
  assert.equal(repaired.scenes[0]!.objects[1]!.heldBy,p.scenes[0]!.objects[0]!.id);
  assert.equal(repaired.scenes[0]!.objects[0]!.sittingStyle,'injured');
});

test('caregiver is beside the guarded knee rather than overlapping the patient',()=>{
  for(const legBandage of ['left','right']){
    const p=parsePlan(JSON.stringify({name:'Aid',scenes:[{name:'Aid',narration:'Họ kiểm tra chân.',background:'room',backgroundRef:'bg:room-stilt-house',objects:[
      {kind:'character',label:'Doctor',characterKey:'doctor',role:'focal',sizeClass:'large'},
      {kind:'character',label:'Patient',characterKey:'patient',role:'support',pose:'sit',sittingStyle:'injured',legBandage,sizeClass:'large'},
    ],animationBeats:[{action:'aid',targets:['doctor'],focusTargetId:'patient',speechCue:'kiểm tra chân',atMs:0,durationMs:2600}]}]}),'horror');
    const scene=p.scenes[0]!,doctor=applyCanvasChoreographyState(scene.objects[0]!,scene,1000),patient=scene.objects[1]!;
    const {rig,model}=resolveStageCharacterRig(patient,scene,1000,false),scale=characterDrawingScale(patient,model),knee=legBandage==='left'?rig.kneeL:rig.kneeR;
    const hand=canvasCharacterHand(doctor,scene,1000,false);
    assert.ok(Math.abs(doctor.x-patient.x)>scale*35,'faces/torso must remain separated');
    assert.ok(Math.hypot(hand.x-patient.x-knee.x*scale,hand.y-patient.y-knee.y*scale)<scale*3,'hands must inspect the actual knee');
  }
});

test('held examination keeps the actual knee contact after its spoken cue finishes',()=>{
  const p=parsePlan(JSON.stringify({scenes:[{name:'Examination',narration:'Minh kiểm tra chân bác Duy.',durationMs:5000,background:'room',objects:[
    {kind:'character',label:'Minh',characterKey:'minh',pose:'aid',keyframes:[{atMs:0,pose:'aid'},{atMs:4200,pose:'idle'}]},
    {kind:'character',label:'Duy',characterKey:'duy',pose:'sit',sittingStyle:'injured',legBandage:'right',bandageProgress:0},
  ],animationBeats:[{action:'aid',targets:['minh'],focusTargetId:'duy',speechCue:'kiểm tra chân',atMs:200,durationMs:1500}]}]}),'story');
  const scene=p.scenes[0]!,actor=applyCanvasChoreographyState(scene.objects[0]!,scene,3000),patient=scene.objects[1]!;
  assert.equal(actor.lookAtId,patient.id);
  const hand=canvasCharacterHand(actor,scene,3000,false),{rig,model}=resolveStageCharacterRig(patient,scene,3000,false),scale=characterDrawingScale(patient,model);
  assert.ok(Math.hypot(hand.x-patient.x-rig.kneeR.x*scale*(patient.facing==='left'?-1:1),hand.y-patient.y-rig.kneeR.y*scale)<scale*3);
  assert.equal(applyCanvasChoreographyState(scene.objects[0]!,scene,4500).pose,'idle','explicit release still ends the held contact');
});

test('production chooses a real wooden ferry and does not fabricate surprise or reveal',()=>{
  const p=parsePlan(JSON.stringify({name:'River',scenes:[{name:'Waiting',narration:'Minh chờ bên con đò.',background:'river',template:'two-shot',objects:[
    {kind:'character',label:'Minh',characterKey:'minh',pose:'idle',role:'focal'},
    {kind:'ship',label:'Con đò gỗ',role:'support',designNotes:'ferry with a wooden paddle'},
  ]}]}),'A quiet river story');
  assert.equal(p.scenes[0]!.objects.find(o=>o.kind==='ship')!.assetRef,'ship:wooden-ferry');
  assert.equal(p.scenes[0]!.animationBeats?.length,0);
  assert.equal(defaultCanvasAssetRef({kind:'ship',label:'Chiến thuyền quân Nguyên'}),'ship:historical-warship');
});
test('pouring uses a real actor, held teapot and resolved bowl target',()=>{
  const p=parsePlan(JSON.stringify({name:'Tea',scenes:[{name:'Tea',narration:'Bà rót nước nóng.',background:'room',objects:[
    {kind:'character',label:'Bà Lành',characterKey:'lanh'},
    {kind:'prop',label:'Tách trà',variant:'bowl'},
    {kind:'prop',label:'Ấm trà',variant:'teapot',heldBy:'lanh',pouringInto:'Tách trà'},
  ],animationBeats:[]}]}),'A quiet tea scene');
  const scene=p.scenes[0]!,pot=scene.objects.find(o=>o.variant==='teapot')!;
  assert.equal(pot.assetRef,'prop:teapot');assert.equal(pot.heldBy,scene.objects.find(o=>o.characterKey==='lanh')!.id);
  assert.equal(pot.pouringInto,scene.objects.find(o=>o.variant==='bowl')!.id);
});

test('physical signal, held props, rain and injured sitting state survive production parsing',()=>{
  const project=parsePlan(JSON.stringify({name:'Rescue',scenes:[{name:'Bank',durationMs:5000,background:'night',backgroundRef:'bg:night-rescue-banks',template:'two-shot',narration:'A ferryman waits on the bank.',
    atmosphere:{rainIntensity:.6,waterIntensity:1.4},objects:[null,{kind:'unknown',label:'invalid'},
      {kind:'character',label:'Duy',characterKey:'duy',role:'focal',pose:'sit',legBandage:'right'},
      {kind:'prop',label:'Lamp',variant:'lantern',heldBy:'duy',lightSignal:{pattern:'distress'},keyframes:[{atMs:0,lightLevel:1},{atMs:1000,lightLevel:0}]},
      {kind:'prop',label:'Note',variant:'note',text:'two short, one long'},
    ]}]}),'a rescue story');
  const scene=project.scenes[0]!,actor=scene.objects.find(o=>o.characterKey==='duy')!,lamp=scene.objects.find(o=>o.variant==='lantern')!;
  assert.equal(actor.pose,'sit');assert.equal(actor.legBandage,'right');assert.equal(lamp.heldBy,actor.id);
  assert.equal(lamp.lightSignal?.pattern,'distress');assert.equal(lamp.keyframes?.[1]?.lightLevel,0);
  assert.equal(lamp.opacity,1);assert.equal(scene.atmosphere?.rainIntensity,.6);
  assert.equal(scene.objects.find(o=>o.variant==='note')?.text,'two short, one long');
});

test('AI production preserves a single phrase action, resolves its gaze target and avoids automatic entrances',()=>{
  const project=parsePlan(JSON.stringify({name:'Scene',scenes:[{name:'Lamp',durationMs:3000,background:'room',template:'two-shot',narration:'Minh nhìn chiếc đèn.',
    dialogue:[{id:'line',speaker:'Narrator',text:'Minh nhìn chiếc đèn.'}],
    objects:[{kind:'character',label:'Minh',characterKey:'minh',role:'focal',slot:'hero-left'},
      {kind:'prop',label:'Đèn',variant:'lantern',slot:'mid-right',role:'support'},
      {kind:'prop',label:'Cửa',variant:'door',role:'background',doorOpen:.5,keyframes:[{atMs:0,doorOpen:.5},{atMs:2000,doorOpen:0}]}],
    animationBeats:[{action:'point',targets:['minh'],atMs:500,durationMs:1000,speechCue:'chiếc đèn',dialogueId:'line',focusTargetId:'Đèn'}]}]}),'a story');
  const scene=project.scenes[0]!,beat=scene.animationBeats![0]!;
  assert.equal(scene.animationBeats!.length,1);assert.equal(beat.speechCue,'chiếc đèn');assert.equal(beat.dialogueId,'line');
  assert.equal(beat.focusTargetId,scene.objects.find(object=>object.label==='Đèn')!.id);
  assert.ok(scene.objects.every(object=>object.motion==='none'&&object.delayMs===0));
  assert.equal(scene.objects.find(object=>object.variant==='door')!.keyframes![1]!.doorOpen,0);
});

test('Canvas Studio schema version remains stable', () => {
  assert.equal(CANVAS_STUDIO_VERSION, 1);
});

test('narration splitting respects whitespace and creates short visual beats', () => {
  const input = 'Đây là một câu mở đầu có nhiều từ để kiểm tra việc chia cảnh. Đây là câu thứ hai tiếp tục giải thích về con nước và bãi cọc.';
  const chunks = splitNarration(input, 12);
  assert.ok(chunks.length >= 2);
  assert.ok(chunks.every((chunk) => chunk.split(/\s+/).filter(Boolean).length <= 12));
  assert.equal(chunks.join(' ').replace(/\s+/g, ' '), input.replace(/\s+/g, ' '));
});


test('repairs a missing comma between adjacent array objects', () => {
  const malformed = '{"name":"demo","scenes":[{"name":"one","narration":"a","objects":[]} {"name":"two","narration":"b","objects":[]}]}';
  const repaired = repairCanvasPlanJsonText(malformed);
  const parsed = JSON.parse(repaired) as { scenes: Array<{ name: string }> };
  assert.equal(parsed.scenes.length, 2);
  assert.deepEqual(parsed.scenes.map((scene) => scene.name), ['one', 'two']);
});

test('removes trailing commas without touching commas inside strings', () => {
  const malformed = '{"name":"a, b","scenes":[{"name":"one","narration":"x","objects":[],},],}';
  const repaired = repairCanvasPlanJsonText(malformed);
  const parsed = JSON.parse(repaired) as { name: string; scenes: unknown[] };
  assert.equal(parsed.name, 'a, b');
  assert.equal(parsed.scenes.length, 1);
});
