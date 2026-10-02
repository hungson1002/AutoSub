import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCanvasObject,
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
