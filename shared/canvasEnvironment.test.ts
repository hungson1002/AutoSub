import assert from 'node:assert/strict';
import test from 'node:test';
import {createCanvasScene,createCanvasObject} from './canvasAnimationStudio';
import {compileCanvasSceneLayout} from './canvasLayoutCompiler';
import {canvasEnvironmentDoorway,CANVAS_DOOR_PANEL} from './canvasEnvironment';
import {evaluateCanvasObject} from '../src/canvasAnimationStudio/runtime';
import {applyCanvasChoreographyState} from '../src/canvasAnimationStudio/choreography';

test('opening/reach choreography never relocates the architectural panel beside an actor',()=>{
  const scene=createCanvasScene();scene.template='two-shot';scene.backgroundRef='bg:room-stilt-house';
  scene.objects=[createCanvasObject('character',{id:'actor',role:'focal'}),createCanvasObject('prop',{id:'door',variant:'door'})];
  scene.animationBeats=[{id:'open',action:'reveal',targetIds:['door'],atMs:0,durationMs:900},
    {id:'reach',action:'reach',targetIds:['actor'],focusTargetId:'door',atMs:0,durationMs:1000}];
  const compiled=compileCanvasSceneLayout(scene,1280,720),door=compiled.objects[1]!;
  const opening=canvasEnvironmentDoorway(scene.backgroundRef,1280,720)!;
  assert.equal(door.x-CANVAS_DOOR_PANEL.width*.5*door.width/100,opening.x);
  assert.equal(applyCanvasChoreographyState(door,compiled,1000).doorOpen,.72);
  assert.deepEqual(compileCanvasSceneLayout(compiled,1280,720),compiled);
});

test('door panel exactly covers its background opening when closed at multiple resolutions and in raw/semantic layouts',()=>{
  for(const [width,height] of [[1280,720],[1920,1080],[720,1280]] as Array<[number,number]>)for(const semantic of [false,true]) {
    const scene=createCanvasScene(0);scene.backgroundRef='bg:room-stilt-house';
    scene.template=semantic?'prop-focus':undefined;
    scene.objects=[createCanvasObject('prop',{variant:'door',x:1060,y:395,width:150,height:300,doorOpen:0})];
    const snapshot=structuredClone(scene),compiled=compileCanvasSceneLayout(scene,width,height),door=compiled.objects[0]!;
    const opening=canvasEnvironmentDoorway(scene.backgroundRef,width,height)!;
    assert.ok(Math.abs(door.x+CANVAS_DOOR_PANEL.left*door.width/100-opening.x)<1e-6);
    assert.ok(Math.abs(door.y+CANVAS_DOOR_PANEL.top*door.height/100-opening.y)<1e-6);
    assert.ok(Math.abs(CANVAS_DOOR_PANEL.width*door.width/100-opening.width)<1e-6);
    assert.ok(Math.abs(CANVAS_DOOR_PANEL.height*door.height/100-opening.height)<1e-6);
    assert.deepEqual(scene,snapshot,'input project remains intact');
    assert.deepEqual(compileCanvasSceneLayout(compiled,width,height),compiled,'recompilation is stable');
  }
});

test('hinge stays at the same jamb during authored translation, impact and closing',()=>{
  const scene=createCanvasScene(0);scene.backgroundRef='bg:room-stilt-day';
  const door=createCanvasObject('prop',{variant:'door',doorOpen:1,motion:'shake',rotation:8,
    keyframes:[{atMs:0,doorOpen:1,dx:20},{atMs:1000,doorOpen:0,dx:100,scale:1.4,rotation:15}]});
  scene.objects=[door];scene.animationBeats=[{id:'hit',action:'impact',atMs:0,durationMs:1200,targetIds:[door.id]}];
  const compiled=compileCanvasSceneLayout(scene,1280,720),attached=compiled.objects[0]!;
  const opening=canvasEnvironmentDoorway(scene.backgroundRef,1280,720)!;
  for(const time of [0,250,500,750,1000]) {
    const animated=applyCanvasChoreographyState(attached,compiled,time),transform=evaluateCanvasObject(animated,compiled,time);
    assert.equal(transform.rotation,0);assert.equal(transform.scale,1);
    assert.ok(Math.abs(transform.x-30*attached.width/100-opening.x)<1e-6);
    assert.equal(animated.doorOpen,1-time/1000);
  }
  assert.deepEqual(attached.keyframes,door.keyframes,'original tracks are retained');
});

test('free doors, image plates and unrelated environments retain authored placement',()=>{
  for(const mode of ['free','plate','other']) {
    const scene=createCanvasScene(0);scene.backgroundRef=mode==='other'?'bg:room-study':'bg:room-stilt-house';
    scene.template=undefined;
    if(mode==='plate')scene.backgroundImageUrl='plate.png';
    scene.objects=[createCanvasObject('prop',{variant:'door',x:700,y:400,...(mode==='free'?{environmentAnchor:'free' as const}:{})})];
    assert.deepEqual(compileCanvasSceneLayout(scene,1280,720),scene);
  }
});
