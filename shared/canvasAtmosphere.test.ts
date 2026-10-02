import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasLampLight,canvasWaterPhase} from './canvasAtmosphere';
import {evaluateObjectKeyframes} from '../src/canvasAnimationStudio/keyframes';
import {applyCanvasChoreographyState} from '../src/canvasAnimationStudio/choreography';
import {createCanvasObject,createCanvasScene} from './canvasAnimationStudio';
import {canvasCharacterHand} from '../src/canvasAnimationStudio/characters/characterStaging';
import {resolveCharacterModel} from '../src/canvasAnimationStudio/characters/characterModel';
import {resolveCharacterRig,segmentLength} from '../src/canvasAnimationStudio/characters/characterRig';

test('signal light goes two short and one long, without hiding the fixture',()=>{
  const lamp=createCanvasObject('prop',{variant:'lantern',lightSignal:{pattern:'distress'}});
  assert.deepEqual([200,600,1000,1800,3000,4200].map(t=>canvasLampLight(lamp,t)),[1,0,1,0,1,0]);
  assert.equal(lamp.opacity,1);
  const reply={...lamp,lightSignal:{pattern:'acknowledge' as const}};
  assert.deepEqual([1000,1800,2600,3000,3400,4000].map(t=>canvasLampLight(reply,t)),[1,0,1,0,1,0]);
  assert.equal(canvasLampLight({...lamp,lightSignal:{pattern:'distress',offsetMs:5200}},1000),canvasLampLight(lamp,1000));
});
test('light track is independent of opacity and water moves deterministically',()=>{
  const frames=[{atMs:0,lightLevel:1},{atMs:1000,lightLevel:0}];
  assert.equal(evaluateObjectKeyframes(frames,500).lightLevel,.5);
  assert.equal(evaluateObjectKeyframes(frames,1000).opacity,1);
  assert.equal(evaluateObjectKeyframes([{atMs:0,boxOpen:0},{atMs:1000,boxOpen:1}],500).boxOpen,.5);
  assert.notDeepEqual(canvasWaterPhase(0,3),canvasWaterPhase(1000,3));
  assert.deepEqual(canvasWaterPhase(1000,3),canvasWaterPhase(1000,3));
  assert.deepEqual(canvasWaterPhase(1000,3,0),{dx:0,dy:0});
});
test('seated legs bend without stretching and large wide-shot actors retain detail and stated age',()=>{
  const scene=createCanvasScene(0);scene.camera={shot:'wide',motion:'none',focusX:640,focusY:360,zoom:1};
  const actor=createCanvasObject('character',{pose:'sit',height:280,hair:'bun',designNotes:'woman, age 30'});
  const model=resolveCharacterModel(actor,scene),rig=resolveCharacterRig(actor,model,1000,false);
  assert.equal(model.lod,'medium');assert.equal(model.age,30);
  assert.ok(Math.abs(segmentLength(rig.hipR,rig.kneeR)-model.thighLength)<.001);
  assert.ok(Math.abs(segmentLength(rig.kneeR,rig.footR)-model.shinLength)<.001);
  assert.ok(rig.kneeR.x>rig.hipR.x+model.thighLength*.5);
  assert.equal(resolveCharacterModel({...actor,height:120},scene).lod,'far');
});
test('hand attachments follow authored travel and sitting is retained during speech',()=>{
  const scene=createCanvasScene(0);
  const actor=createCanvasObject('character',{id:'minh',pose:'idle',motion:'none',keyframes:[{atMs:0,dx:0},{atMs:1000,dx:180}]});
  scene.objects=[actor];scene.animationBeats=[];
  const start=canvasCharacterHand(actor,scene,0,false),end=canvasCharacterHand(actor,scene,1000,false);
  assert.ok(Math.abs(end.x-start.x-180)<2);
  scene.animationBeats=[{id:'voice-1',action:'talk',atMs:0,durationMs:2000,targetIds:['minh']}];
  assert.equal(applyCanvasChoreographyState({...actor,pose:'sit'},scene,1000).pose,'sit');
});
