import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCharacterModel, characterDrawingScale, blanketTopAt, resolveFaceParams } from './characterModel';
import { resolveCharacterRig, segmentLength, solveTwoBoneIk } from './characterRig';
import { createCanvasObject, type CanvasStudioScene } from '../../../shared/canvasAnimationStudio';
import {applyCanvasChoreographyState} from '../choreography';
import {canvasActorSpeechLevel,isCanvasActorSpeaking} from '../../../shared/canvasDialogue';
import {synchronizeCanvasPerformance} from '../../../shared/canvasPerformance';
import {canvasCharacterLocalGroundOffset,resolveStageCharacterRig} from './characterStaging';

const horrorTorsoSpan=(model:ReturnType<typeof resolveCharacterModel>)=>Math.max(23.5,Math.min(25.8,model.torsoHeight*.645));
const horrorHeadSpan=(model:ReturnType<typeof resolveCharacterModel>)=>Math.max(11.4,Math.min(13.2,model.faceHeight*.36));

test('quiet horror actors hold one pose between authored beats',()=>{
  const actor=createCanvasObject('character',{pose:'idle',motion:'none',visualStyle:'horror'});
  const scene:CanvasStudioScene={id:'quiet',name:'quiet',durationMs:12000,background:'room',backgroundRef:'bg:room-stilt-house',objects:[actor]};
  const model=resolveCharacterModel(actor,scene);
  assert.equal(model.horror,true);
  const initial=resolveCharacterRig(actor,model,0,false);
  for(const time of [500,2000,8000]){
    const rig=resolveCharacterRig(actor,model,time,false);
    assert.deepEqual(rig,initial,'horror body must stay on the held pose until an authored beat changes it');
    assert.ok(Math.abs(rig.head.x-rig.neck.x)<1e-9,'head remains locked to neck');
    assert.ok(Math.abs(rig.head.y-rig.neck.y+horrorHeadSpan(model))<1e-9,'short model-derived head/neck hierarchy stays attached');
  }
});

test('ground offset follows the resolved shoe-bottom joint instead of a magic layout constant',()=>{
  const actor=createCanvasObject('character',{characterKey:'grounded',visualStyle:'horror',pose:'idle',width:210,height:330});
  const shot:CanvasStudioScene={id:'grounded',name:'grounded',durationMs:4000,background:'room',backgroundRef:'bg:room-simple-night',objects:[actor]};
  const {model,rig}=resolveStageCharacterRig(actor,shot,0,false);
  const expected=(Math.max(rig.footL.y,rig.footR.y)+3.15)*characterDrawingScale(actor,model);
  assert.ok(Math.abs(canvasCharacterLocalGroundOffset(actor,shot,0)-expected)<1e-9);
});

test('fear expression changes the face without inventing a body pose',()=>{
  const neutral=createCanvasObject('character',{characterKey:'minh',visualStyle:'horror',pose:'idle',expression:'neutral'});
  const afraid={...neutral,expression:'afraid' as const};
  const shot:CanvasStudioScene={id:'fear-face',name:'fear face',durationMs:4000,background:'room',backgroundRef:'bg:room-stilt-house',objects:[neutral]};
  const model=resolveCharacterModel(neutral,shot);
  const a=resolveCharacterRig(neutral,model,1000,false);
  const b=resolveCharacterRig(afraid,model,1000,false);
  for(const joint of ['pelvis','chest','neck','head','shoulderL','elbowL','handL','shoulderR','elbowR','handR','hipL','kneeL','footL','hipR','kneeR','footR'] as const)
    assert.deepEqual(b[joint],a[joint],`${joint}: facial fear must not invent body acting`);
});

test('horror head beats overlay a seated pose without re-solving arms or legs',()=>{
  const actor=createCanvasObject('character',{id:'seated',characterKey:'seated',visualStyle:'horror',pose:'sit',sittingStyle:'chair',motion:'none'});
  const base:CanvasStudioScene={id:'head-overlay',name:'head overlay',durationMs:4000,background:'room',backgroundRef:'bg:room-stilt-house',objects:[actor],animationBeats:[]};
  const directed={...base,animationBeats:[{id:'look-up',action:'nod' as const,atMs:1000,durationMs:800,targetIds:[actor.id],speechCue:'head-up'}]};
  const before=resolveStageCharacterRig(actor,base,1300,false).rig;
  const state=applyCanvasChoreographyState(actor,directed,1300);
  const during=resolveStageCharacterRig(state,directed,1300,false).rig;
  assert.equal(state.pose,'sit','head-only acting must preserve the seated body pose');
  for(const joint of ['handL','handR','elbowL','elbowR','hipL','hipR','kneeL','kneeR','footL','footR'] as const)
    assert.deepEqual(during[joint],before[joint],`${joint}: head overlay must not pop the body rig`);
});

test('seated upper-body gestures blend from the seated base pose without popping legs',()=>{
  const actor=createCanvasObject('character',{id:'seat-gesture',characterKey:'seat-gesture',visualStyle:'horror',pose:'sit',sittingStyle:'chair',motion:'none'});
  const base:CanvasStudioScene={id:'seat-gesture-scene',name:'seat gesture',durationMs:4000,background:'room',backgroundRef:'bg:room-stilt-house',objects:[actor],animationBeats:[]};
  const directed={...base,animationBeats:[{id:'gesture',action:'gesture' as const,atMs:1000,durationMs:900,targetIds:[actor.id]}]};
  const idle=resolveStageCharacterRig(actor,base,1000,false).rig;
  const startState=applyCanvasChoreographyState(actor,directed,1000);
  const start=resolveStageCharacterRig(startState,directed,1000,false).rig;
  assert.equal(startState.pose,'gesture');
  for(const joint of ['footL','footR','kneeL','kneeR'] as const)assert.deepEqual(start[joint],idle[joint]);
  assert.ok(Math.hypot(start.handR.x-idle.handR.x,start.handR.y-idle.handR.y)<.01,'gesture must start from the seated hand position');
  const midState=applyCanvasChoreographyState(actor,directed,1450);
  const mid=resolveStageCharacterRig(midState,directed,1450,false).rig;
  assert.ok(Math.hypot(mid.handR.x-idle.handR.x,mid.handR.y-idle.handR.y)>1,'gesture should become visible after anticipation');
  for(const joint of ['footL','footR','kneeL','kneeR'] as const)assert.deepEqual(mid[joint],idle[joint]);
});

test('silent horror face stays fully closed without actor voice activity',()=>{
  const actor=createCanvasObject('character',{characterKey:'minh',visualStyle:'horror',pose:'idle',expression:'neutral'});
  const horrorScene:CanvasStudioScene={id:'silent-horror',name:'silent horror',durationMs:4000,background:'room',backgroundRef:'bg:room-stilt-house',objects:[actor],dialogue:[]};
  const model=resolveCharacterModel(actor,horrorScene);
  for(const time of [0,120,900,2400,3999])assert.equal(resolveFaceParams(actor,model,time,false,0).mouthOpen,0);
});

test('silent surprised listeners never borrow the speaker mouth opening',()=>{
  const actor=createCanvasObject('character',{expression:'surprised'});
  const model=resolveCharacterModel(actor,{id:'talk',name:'talk',durationMs:3000,background:'room',objects:[actor]});
  assert.equal(resolveFaceParams(actor,model,700,false,1).mouthOpen,0);
  assert.ok(resolveFaceParams(actor,model,700,true,1).mouthOpen>.3);
});

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
      assert.ok(Math.abs(rig.head.y-rig.neck.y+(model.horror?horrorHeadSpan(model):20))<(model.horror?2.5:1e-9),`${pose}: head/neck distance stays anatomically locked through authored nods`);
      assert.ok(Math.abs(rig.chest.y-rig.pelvis.y+(model.horror?horrorTorsoSpan(model):26))<(model.horror?2.4:.12),`${pose}: acting may lean the ribcage but cannot stretch the torso`);
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

test('a seated horror reaction can brace its upper body without standing up',()=>{
  const seated=actor('minh',{pose:'sit',sittingStyle:'ground'}),model=resolveCharacterModel(seated,scene);
  const sitting=resolveCharacterRig(seated,model,800);
  const braced=resolveCharacterRig({...seated,pose:'brace'},model,800);
  for(const side of ['L','R'] as const){
    assert.ok(braced[`foot${side}`].y>braced[`knee${side}`].y+model.shinLength*.95);
    assert.ok(Math.abs(braced[`foot${side}`].x-braced[`knee${side}`].x)<.01);
    assert.ok(Math.abs(braced[`foot${side}`].x-sitting[`foot${side}`].x)<.01);
    assert.ok(Math.abs(braced[`foot${side}`].y-sitting[`foot${side}`].y)<.01);
  }
  assert.notDeepEqual(braced.handR,sitting.handR,'reaction changes the arms while the seated base stays planted');
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

test('horror anatomy stays compact across character seeds and archetypes',()=>{
  const archetypes=['worker','villager','warrior','doctor'] as const;
  for(let i=0;i<16;i++){
    const model=resolveCharacterModel(actor(`compact-${i}`,{archetype:archetypes[i%archetypes.length]}),scene);
    const torso=horrorTorsoSpan(model);
    const armRatio=(model.armLength+model.forearmLength)/torso;
    const legRatio=(model.thighLength+model.shinLength)/torso;
    const shoulderWaist=model.shoulderWidth/model.waistWidth;
    const headRatio=horrorHeadSpan(model)/torso;
    assert.ok(armRatio>=.95&&armRatio<=1.20,`arm/torso ${armRatio.toFixed(2)} must stay compact`);
    assert.ok(legRatio>=1.00&&legRatio<=1.20,`leg/torso ${legRatio.toFixed(2)} must not become long-legged`);
    assert.ok(shoulderWaist>=1.16&&shoulderWaist<=1.48,`shoulder/waist ${shoulderWaist.toFixed(2)} must remain one style family`);
    assert.ok(headRatio>=.43&&headRatio<=.56,`head/torso ${headRatio.toFixed(2)} must remain editorial, not mannequin-like`);
  }
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

test('reaction lead-in, recoil and recovery use one body scale in a close shot',()=>{
  const object=actor('minh',{pose:'idle'});
  const shot={...scene,camera:{...scene.camera!,shot:'close-up' as const},objects:[object],animationBeats:[{id:'recoil',action:'react' as const,atMs:1200,durationMs:900,targetIds:[object.id]}]};
  const scales=[0,1200,1600,2100,3200].map(t=>{
    const state=applyCanvasChoreographyState(object,shot,t),model=resolveCharacterModel(state,shot);
    assert.equal(model.lod,'medium');return characterDrawingScale(state,model);
  });
  assert.ok(scales.every(scale=>scale===scales[0]));
});

test('speech gestures keep one hand at rest and settle during pauses and long lines', () => {
  const object=actor('minh',{pose:'talk'});
  const model=resolveCharacterModel(object,scene);
  const idle=resolveCharacterRig({...object,pose:'idle'},model,700);
  const speaking=resolveCharacterRig(object,model,700,true,700);
  assert.deepEqual(speaking.handL,idle.handL);
  assert.ok(idle.elbowL.x<idle.shoulderL.x);
  assert.ok(idle.elbowR.x>idle.shoulderR.x);
  assert.deepEqual(speaking.handR,idle.handR,'speech alone must not invent an arm gesture');
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
    assert.ok(hand.y<rig.pelvis.y,'protective hands must read on the torso, not hang beside the hips');
  }
});

test('startle brace uses a distinct asymmetric silhouette from defensive brace',()=>{
  const defensive=actor('minh',{pose:'brace',expression:'neutral'});
  const startled=actor('minh',{pose:'brace',expression:'surprised'});
  const model=resolveCharacterModel(defensive,scene);
  const a=resolveCharacterRig(defensive,model,700);
  const b=resolveCharacterRig(startled,model,700);
  assert.ok(b.handR.y<a.handR.y-3,'startle hand should flash closer to the face');
  assert.ok(b.handL.y>a.handL.y+2,'opposite hand remains lower than a two-hand defensive guard');
  assert.notDeepEqual([b.handL,b.handR],[a.handL,a.handR]);
});

test('action envelopes return limbs to rest and locomotion alternates feet', () => {
  const object=actor('minh',{pose:'run'}),model=resolveCharacterModel(object,scene);
  const idle=resolveCharacterRig({...object,pose:'idle'},model,400);
  const rest=resolveCharacterRig(object,model,400,true,400,0);
  for(const joint of ['handL','handR'] as const)
    assert.ok(Math.hypot(rest[joint].x-idle[joint].x,rest[joint].y-idle[joint].y)<.12,`${joint}: zero-weight action returns to the moving-hold silhouette`);
  for(const joint of ['footL','footR'] as const) assert.deepEqual(rest[joint],idle[joint]);
  const stride=resolveCharacterRig(object,model,400,true,190*Math.PI/2,1);
  assert.ok(stride.footL.x>idle.footL.x);
  assert.ok(stride.footR.x<idle.footR.x);
  assert.ok(stride.footL.y>idle.footL.y-5,'stride must not turn into a deep squat');
});


test('a supporting hand reaches up from its elbow in either facing direction',()=>{
  for(const facing of ['left','right'] as const){
    const object=actor('supporter',{pose:'assist',facing}),model=resolveCharacterModel(object,scene);
    const rig=resolveCharacterRig(object,model,0,false,0,1,undefined,{x:38,y:-12});
    assert.ok(rig.elbowR.y>rig.handR.y,'elbow is below the shoulder contact');
    assert.ok(Math.abs(segmentLength(rig.shoulderR,rig.elbowR)-model.armLength)<.001);
    assert.ok(Math.abs(segmentLength(rig.elbowR,rig.handR)-model.forearmLength)<.001);
  }
});


test('raised contact lead-in keeps elbows continuous and stationary assistance has planted feet',()=>{
  const object=actor('helper',{pose:'assist'}),model=resolveCharacterModel(object,scene);
  let previous=resolveCharacterRig(object,model,0,false,0,0,undefined,{x:38,y:-12});
  for(let i=1;i<=200;i++){
    const current=resolveCharacterRig(object,model,0,false,0,i/200,undefined,{x:38,y:-12});
    assert.ok(segmentLength(previous.elbowR,current.elbowR)<2,'elbow cannot teleport when changing bend direction');
    assert.ok(segmentLength(previous.handR,current.handR)<2);
    previous=current;
  }
  const start=resolveCharacterRig(object,model,0,false,0),later=resolveCharacterRig(object,model,1000,false,1000);
  assert.ok(segmentLength(start.footL,later.footL)<.3,'stationary support does not invent a walking gait');
});
