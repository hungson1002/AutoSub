import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCharacterModel, characterDrawingScale, blanketTopAt, resolveFaceParams } from './characterModel';
import { resolveCharacterRig, segmentLength, solveTwoBoneIk } from './characterRig';
import { createCanvasObject, type CanvasStudioScene } from '../../../shared/canvasAnimationStudio';
import {applyCanvasChoreographyState} from '../choreography';
import {canvasActorSpeechLevel,isCanvasActorSpeaking} from '../../../shared/canvasDialogue';
import {synchronizeCanvasPerformance} from '../../../shared/canvasPerformance';
import {resolveStageCharacterRig} from './characterStaging';

test('walking gait does not reset its distance origin when the spoken beat ends',()=>{
  const object=createCanvasObject('character',{id:'walker',pose:'run',width:180,height:320,keyframes:[
    {atMs:0,dx:0,pose:'run'},{atMs:4000,dx:160,pose:'run'}
  ]});
  const shot:CanvasStudioScene={id:'walk',name:'walk',durationMs:5000,background:'room',objects:[object],animationBeats:[
    {id:'walk-beat',atMs:1200,durationMs:1200,action:'run',targetIds:[object.id]}
  ]};
  const before=resolveStageCharacterRig(object,shot,2399,false).rig;
  const after=resolveStageCharacterRig(object,shot,2401,false).rig;
  for(const point of ['handL','handR','footL','footR'] as const){
    assert.ok(Math.hypot(after[point].x-before[point].x,after[point].y-before[point].y)<.2,`${point}: continuous gait at cue boundary`);
  }
});

test('physical close shots retain legs throughout action lead-in and recovery',()=>{
  for(const shot of ['close-up','extreme-close-up'] as const){
    for(const pose of ['tie','brace','run','aid','assist','reach','row','sit'] as const){
      const object=createCanvasObject('character',{id:'actor',pose:'idle',keyframes:[
        {atMs:0,pose:'idle'},{atMs:500,pose},{atMs:2000,pose:'idle'}
      ]});
      const actionScene:CanvasStudioScene={id:'body',name:'body',durationMs:3000,background:'room',objects:[object],camera:{shot,motion:'none',focusX:.5,focusY:.5,zoom:1}};
      for(const currentPose of ['idle',pose] as const){
        assert.equal(resolveCharacterModel({...object,pose:currentPose},actionScene).lod,'medium',`${shot}: ${pose}`);
      }
    }
    const helper=createCanvasObject('character',{id:'helper',pose:'idle'});
    const patient=createCanvasObject('character',{id:'patient',pose:'idle'});
    const actionScene:CanvasStudioScene={id:'aid',name:'aid',durationMs:3000,background:'room',objects:[helper,patient],camera:{shot,motion:'none',focusX:.5,focusY:.5,zoom:1},animationBeats:[
      {id:'treatment',atMs:500,durationMs:1500,action:'aid',targetIds:[helper.id],focusTargetId:patient.id}
    ]};
    assert.equal(resolveCharacterModel(helper,actionScene).lod,'medium');
    assert.equal(resolveCharacterModel(patient,actionScene).lod,'medium');
    assert.equal(resolveCharacterModel(helper,{...actionScene,animationBeats:[]}).lod,'close','dialogue-only portrait remains available');
  }
});

test('all action poses retain the same torso, collar and shoulder attachments',()=>{
  const object=createCanvasObject('character',{characterKey:'minh',height:320,width:205});
  const model=resolveCharacterModel(object,scene);
  for(const pose of ['idle','sit','aid','tie','wipe','write','assist','point','talk','run','row','brace','celebrate'] as const){
    for(const time of [0,300,1000,2400]){
      const rig=resolveCharacterRig({...object,pose},model,time,true,time,1,undefined,{x:35,y:32});
      assert.equal(rig.head.x,rig.neck.x,`${pose}: head must remain centered on its neck`);
      assert.ok(Math.abs(rig.head.y-rig.neck.y+(model.horror?16:20))<1e-9);
      assert.ok(Math.abs(rig.chest.y-rig.pelvis.y+26)<1e-9,`${pose}: no torso compression`);
      assert.ok(Math.abs(rig.shoulderL.x-rig.chest.x+model.shoulderWidth/2)<1e-9);
      assert.ok(Math.abs(rig.shoulderR.x-rig.chest.x-model.shoulderWidth/2)<1e-9);
      assert.ok(Math.abs(rig.shoulderL.y-rig.chest.y+2)<1e-9);
      for(const side of ['L','R'] as const){
        assert.ok(Math.abs(segmentLength(rig[`shoulder${side}`],rig[`elbow${side}`])-model.armLength)<.001);
        assert.ok(Math.abs(segmentLength(rig[`elbow${side}`],rig[`hand${side}`])-model.forearmLength)<.001);
        assert.ok(Math.abs(segmentLength(rig[`hip${side}`],rig[`knee${side}`])-model.thighLength)<.001);
        assert.ok(Math.abs(segmentLength(rig[`knee${side}`],rig[`foot${side}`])-model.shinLength)<.001);
      }
    }
  }
});

test('held telephone stays beside the cheek, leaving the mouth visible',()=>{
  const actor=createCanvasObject('character',{id:'minh',pose:'point',height:320,width:205});
  const phone=createCanvasObject('prop',{variant:'phone',heldBy:actor.id});
  const shot:CanvasStudioScene={id:'call',name:'call',durationMs:3000,background:'room',objects:[actor,phone]};
  const {rig,model}=resolveStageCharacterRig(actor,shot,1500,true);
  assert.ok(rig.handR.x>model.faceWidth*.45);
  assert.ok(rig.handR.y<rig.head.y+10);
  assert.ok(rig.elbowR.x>rig.shoulderR.x+5,'phone elbow must stay visibly outside the torso');
  assert.ok(rig.elbowR.y>rig.handR.y+5,'forearm rises from elbow to ear');
});

test('seated feet fall below both knees with symmetric vertical calves',()=>{
  for(const key of ['duy','minh','grandma']) {
    const object=actor(key,{pose:'sit'}),model=resolveCharacterModel(object,scene);
    const rig=resolveCharacterRig(object,model,800);
    for(const side of ['L','R'] as const){
      assert.ok(rig[`foot${side}`].y>rig[`knee${side}`].y+model.shinLength*.95);
      assert.ok(Math.abs(rig[`foot${side}`].x-rig[`knee${side}`].x)<.01);
      assert.ok(Math.abs(segmentLength(rig[`hip${side}`],rig[`knee${side}`])-model.thighLength)<.001);
    }
    assert.ok(rig.footL.x<rig.hipL.x && rig.footR.x>rig.hipR.x);
    assert.ok(Math.abs(rig.footL.y-rig.footR.y)<.001);
  }
});

test('injured sitting guards one leg instead of reusing the symmetric chair posture',()=>{
  for(const side of ['left','right'] as const){
    const object=actor('duy',{pose:'sit',sittingStyle:'injured',legBandage:side}),model=resolveCharacterModel(object,scene);
    const rig=resolveCharacterRig(object,model,800),chair=resolveCharacterRig({...object,sittingStyle:'chair',legBandage:undefined},model,800);
    const leg=side==='left'?'L':'R',other=side==='left'?'R':'L';
    assert.ok(Math.abs(rig[`foot${leg}`].x)>Math.abs(rig[`foot${other}`].x)+8);
    assert.notDeepEqual(rig.footR,chair.footR);
    for(const suffix of ['L','R'] as const){
      assert.ok(rig[`foot${suffix}`].y>rig[`knee${suffix}`].y);
      assert.ok(Math.abs(segmentLength(rig[`hip${suffix}`],rig[`knee${suffix}`])-model.thighLength)<.001);
      assert.ok(Math.abs(segmentLength(rig[`knee${suffix}`],rig[`foot${suffix}`])-model.shinLength)<.001);
    }
  }
});

test('phone attachment preserves its grip while talking, idling and facing either direction',()=>{
  for(const facing of ['left','right'] as const)for(const pose of ['idle','talk','point'] as const){
    const object=actor('minh',{id:'caller',pose,facing});
    const shot={...scene,objects:[object,createCanvasObject('prop',{variant:'phone',heldBy:object.id})]};
    for(const time of [0,500,2500]){
      const {rig,model}=resolveStageCharacterRig(object,shot,time,false);
      assert.ok(rig.elbowR.x>rig.shoulderR.x+5);
      assert.ok(rig.handR.y<rig.elbowR.y-5);
      assert.ok(Math.abs(segmentLength(rig.elbowR,rig.handR)-model.forearmLength)<.001);
    }
  }
});

test('Minh speaks while pointing, pauses close his mouth and listener stays silent',()=>{
  const minh=createCanvasObject('character',{characterKey:'minh',label:'Minh',pose:'point',expression:'afraid'});
  const listener=createCanvasObject('character',{characterKey:'lanh',label:'Bà Lành'});
  const shot:CanvasStudioScene={id:'speech',name:'speech',durationMs:2000,background:'room',objects:[minh,listener],animationBeats:[],dialogue:[
    {id:'line',speaker:'Minh',characterKey:'minh',text:'Bà ơi!',atMs:0,durationMs:2000,speechWindows:[{startMs:0,endMs:700},{startMs:1200,endMs:1800}],speechEnvelope:[{atMs:0,level:.6},{atMs:700,level:0},{atMs:1200,level:.8},{atMs:1800,level:0}]}]};
  synchronizeCanvasPerformance(shot);
  const once=structuredClone(shot);synchronizeCanvasPerformance(shot);assert.deepEqual(shot,once);
  const actor=applyCanvasChoreographyState(minh,shot,300),model=resolveCharacterModel(actor,shot);
  assert.equal(actor.pose,'point');assert.equal(actor.expression,'afraid');
  assert.ok(resolveFaceParams(actor,model,300,isCanvasActorSpeaking(shot,actor,300)!,canvasActorSpeechLevel(shot,actor,300)).mouthOpen>.15);
  assert.equal(resolveFaceParams(actor,model,900,isCanvasActorSpeaking(shot,actor,900)!,canvasActorSpeechLevel(shot,actor,900)).mouthOpen,0);
  assert.equal(canvasActorSpeechLevel(shot,listener,300),0);
  for(const pose of ['sit','run','row','brace'] as const)assert.equal(applyCanvasChoreographyState({...minh,pose},shot,300).pose,pose);
});

test('IK folds to a near shoulder target without stretching the forearm',()=>{
  const result=solveTwoBoneIk({x:0,y:0},{x:.01,y:.01},15,11,1);
  assert.ok(Math.abs(segmentLength({x:0,y:0},result.joint)-15)<.001);
  assert.ok(Math.abs(segmentLength(result.joint,result.end)-11)<.001);
});

test('stance foot stays planted as body advances, including reverse travel',()=>{
  const object=createCanvasObject('character',{pose:'run'}),model=resolveCharacterModel(object,scene);
  for(const direction of [1,-1]) {
    const a=resolveCharacterRig(object,model,1000,true,1000,1,2*direction);
    const b=resolveCharacterRig(object,model,1100,true,1100,1,4*direction);
    assert.ok(Math.abs(a.footL.x+2*direction-b.footL.x-4*direction)<.001);
    assert.ok(Math.abs(a.footL.y-b.footL.y)<.001);
    assert.ok(b.footR.y<b.footL.y,'other foot lifts during swing');
  }
});

const scene: CanvasStudioScene = {
  id:'scene', name:'horror test', durationMs:4000, background:'room', backgroundRef:'bg:room-stilt-house',
  template:'close-reaction', narration:'', camera:{shot:'close-up',motion:'none',focusX:640,focusY:360,zoom:1},
  effects:[], animationBeats:[], objects:[],
};

test('pointing arm follows the actual elevated target and stays connected',()=>{
  const object=createCanvasObject('character',{pose:'point'}),model=resolveCharacterModel(object,scene);
  const target={x:40,y:-55},rig=resolveCharacterRig(object,model,1000,true,1000,1,undefined,target);
  const arm={x:rig.handR.x-rig.shoulderR.x,y:rig.handR.y-rig.shoulderR.y};
  const direction={x:target.x-rig.shoulderR.x,y:target.y-rig.shoulderR.y};
  assert.ok(Math.abs(arm.x*direction.y-arm.y*direction.x)<.001);
  assert.ok(rig.handR.y<rig.shoulderR.y);
  assert.ok(Math.abs(segmentLength(rig.shoulderR,rig.elbowR)-model.armLength)<.001);
  assert.ok(Math.abs(segmentLength(rig.elbowR,rig.handR)-model.forearmLength)<.001);
});

function actor(key:string, overrides:Record<string,unknown>={}) {
  return createCanvasObject('character', {
    label:key, characterKey:key, archetype:'worker', hair:'short',
    role:'focal', x:640, y:380, width:240, height:360, scale:1, motion:'none',
    expression:'neutral', pose:'idle', ...overrides,
  } as any);
}

test('character identity stays deterministic for the same key', () => {
  const a=resolveCharacterModel(actor('main'), scene);
  const b=resolveCharacterModel(actor('main'), scene);
  assert.deepEqual(a,b);
});

test('different character keys generate visibly different anatomy', () => {
  const a=resolveCharacterModel(actor('main-a'), scene);
  const b=resolveCharacterModel(actor('main-b'), scene);
  const signature=(m:ReturnType<typeof resolveCharacterModel>) => [m.faceShape,m.faceWidth,m.faceHeight,m.eyeSpacing,m.asymmetryX];
  assert.notDeepEqual(signature(a),signature(b));
});

test('horror character eyes remain restrained', () => {
  const model=resolveCharacterModel(actor('horror'), scene);
  assert.equal(model.horror,true);
  assert.ok(model.eyeScale < .84);
});

test('two-bone IK keeps authored segment lengths', () => {
  const upper=15, lower=14;
  const root={x:0,y:0};
  const result=solveTwoBoneIk(root,{x:20,y:5},upper,lower,1);
  assert.ok(Math.abs(segmentLength(root,result.joint)-upper)<.001);
  assert.ok(Math.abs(segmentLength(result.joint,result.end)-lower)<.001);
});

test('pose rig keeps both arms connected to shoulders', () => {
  const object=actor('pose',{pose:'point'});
  const model=resolveCharacterModel(object,scene);
  const rig=resolveCharacterRig(object,model,900);
  assert.ok(segmentLength(rig.shoulderR,rig.elbowR)>10);
  assert.ok(segmentLength(rig.elbowR,rig.handR)>10);
});

test('large medium actors retain full anatomy and uniformly fit their bounds', () => {
  const object=actor('minh',{width:220,height:400});
  const model=resolveCharacterModel(object,{...scene,camera:{...scene.camera!,shot:'medium'}});
  assert.equal(model.lod,'medium');
  const scale=characterDrawingScale(object,model);
  assert.ok(scale*68<=object.width && scale*100<=object.height);
  const rig=resolveCharacterRig(object,model,500);
  const hipToFoot=segmentLength(rig.hipL,rig.footL);
  assert.ok(hipToFoot>(model.thighLength+model.shinLength)*.99,'idle stance must not squat');
});

test('sleeping and silent fear have closed mouths; covering raises the blanket from the pose event', () => {
  const sleeping=actor('minh',{pose:'lie-down',expression:'neutral'});
  const model=resolveCharacterModel(sleeping,scene);
  assert.equal(model.lod,'medium');
  assert.ok(resolveFaceParams(sleeping,model,500,false).eyesOpen<.1);
  const covering=actor('minh',{pose:'cover-face',expression:'afraid',keyframes:[{atMs:1000,pose:'cover-face'}]});
  assert.equal(resolveFaceParams(covering,model,1500,true).mouthOpen,0);
  const speaking={...covering,pose:'talk' as const};
  assert.ok(resolveFaceParams(speaking,model,500,true).mouthOpen>0);
  assert.equal(resolveFaceParams(speaking,model,500,false).mouthOpen,0);
  assert.equal(blanketTopAt(covering,1000),-8);
  assert.equal(blanketTopAt(covering,1900),-26);
  assert.ok(blanketTopAt(covering,1450)<-8);
  const rig=resolveCharacterRig(covering,model,1900);
  assert.ok(Number.isFinite(rig.handR.x) && Number.isFinite(rig.handL.y));
});

test('speech gestures keep one hand at rest and settle during pauses and long lines', () => {
  const object=actor('minh',{pose:'talk'});
  const model=resolveCharacterModel(object,scene);
  const idle=resolveCharacterRig({...object,pose:'idle'},model,700);
  const speaking=resolveCharacterRig(object,model,700,true,700);
  assert.deepEqual(speaking.handL,idle.handL);
  assert.ok(idle.elbowL.x<idle.shoulderL.x);
  assert.ok(idle.elbowR.x>idle.shoulderR.x);
  assert.ok(speaking.handR.x < idle.handR.x,'gesture moves toward the chest, not sideways');
  assert.deepEqual(resolveCharacterRig(object,model,700,false,700).handR,idle.handR);
  assert.deepEqual(resolveCharacterRig(object,model,700,true,4200).handR,idle.handR);
  assert.deepEqual(resolveCharacterRig(object,model,700,true,0).handR,idle.handR);
});

test('defensive hands stay in front of the torso instead of a horizontal T pose', () => {
  const object=actor('minh',{pose:'brace'});
  const model=resolveCharacterModel(object,scene);
  const rig=resolveCharacterRig(object,model,700);
  for(const hand of [rig.handL,rig.handR]) {
    assert.ok(Math.abs(hand.x)<model.shoulderWidth/2);
    assert.ok(hand.y>rig.shoulderL.y);
  }
});

test('action envelopes return limbs to rest and locomotion alternates feet', () => {
  const object=actor('minh',{pose:'run'}),model=resolveCharacterModel(object,scene);
  const idle=resolveCharacterRig({...object,pose:'idle'},model,400);
  const rest=resolveCharacterRig(object,model,400,true,400,0);
  for(const joint of ['handL','handR','footL','footR'] as const) assert.deepEqual(rest[joint],idle[joint]);
  const stride=resolveCharacterRig(object,model,400,true,190*Math.PI/2,1);
  assert.ok(stride.footL.x>idle.footL.x);
  assert.ok(stride.footR.x<idle.footR.x);
  assert.ok(stride.footL.y>idle.footL.y-5,'stride must not turn into a deep squat');
});
