import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCanvasCamera, evaluateCanvasObject, projectDurationMs, resolveProjectTime } from './runtime';
import { createCanvasObject, createCanvasScene } from './types';
import { applyCanvasChoreographyState, canvasActingTiming, evaluateCanvasChoreographyOffset } from './choreography';
import {evaluateObjectKeyframes} from './keyframes';

test('an assisting actor follows patient travel without drifting apart or duplicating authored travel',()=>{
  const scene=createCanvasScene(),patient=createCanvasObject('character',{id:'patient',x:600,keyframes:[{atMs:0,dx:0},{atMs:3000,dx:120}]}),helper=createCanvasObject('character',{id:'helper',x:480});
  scene.objects=[patient,helper];scene.animationBeats=[{id:'help',action:'assist',targetIds:['helper'],focusTargetId:'patient',atMs:0,durationMs:3000}];
  assert.equal(evaluateCanvasObject(helper,scene,1500).x,540);
  assert.equal(evaluateCanvasObject(patient,scene,1500).x-evaluateCanvasObject(helper,scene,1500).x,120);
  helper.motion='walk-right';
  assert.equal(evaluateCanvasObject(helper,scene,1500).x,540,'walk preset must not add a second independent travel');
  helper.motion='none';
  helper.keyframes=[{atMs:0,dx:0},{atMs:3000,dx:120}];
  assert.equal(evaluateCanvasObject(helper,scene,1500).x,540);
  scene.animationBeats.push({id:'cycle',action:'assist',targetIds:['patient'],focusTargetId:'helper',atMs:0,durationMs:3000});
  assert.ok(Number.isFinite(evaluateCanvasObject(helper,scene,1500).x));
});

test('speech does not override authored point/run and listeners follow the speaker',()=>{
  const scene=createCanvasScene(),actor=createCanvasObject('character',{characterKey:'a'}),listener=createCanvasObject('character');
  scene.objects=[actor,listener];scene.dialogue=[{id:'l',speaker:'A',characterKey:'a',text:'Look',atMs:0,durationMs:2000}];
  scene.animationBeats=[{id:'point',action:'point',atMs:0,durationMs:1000,targetIds:[actor.id],focusTargetId:'lamp'},
    {id:'voice-l',action:'talk',atMs:0,durationMs:2000,targetIds:[actor.id]}];
  assert.equal(applyCanvasChoreographyState(actor,scene,500).pose,'point');
  assert.equal(applyCanvasChoreographyState(actor,scene,500).lookAtId,'lamp');
  assert.equal(applyCanvasChoreographyState(listener,scene,500).lookAtId,actor.id);
});

test('door aperture interpolates and holds across sparse frames without translating the prop',()=>{
  const frames=[{atMs:0,doorOpen:1},{atMs:1000,doorOpen:0},{atMs:1500,facing:'left' as const}];
  assert.equal(evaluateObjectKeyframes(frames,500).doorOpen,.5);
  assert.equal(evaluateObjectKeyframes(frames,1300).doorOpen,0);
  assert.equal(evaluateObjectKeyframes(frames,500).dx,0);
});

test('slide-left enters from the left and finishes at authored position', () => {
  const scene = createCanvasScene();
  const object = createCanvasObject('character', { x: 400, motion: 'slide-left' });
  const atStart = evaluateCanvasObject(object, scene, 0);
  const afterEntrance = evaluateCanvasObject(object, scene, 800);
  assert.ok(atStart.x < 200);
  assert.equal(Math.round(afterEntrance.x), 400);
  assert.equal(Math.round(afterEntrance.opacity * 100), 100);
});

test('staggered entrance stays hidden until its authored delay', () => {
  const scene = createCanvasScene();
  const object = createCanvasObject('character', {
    motion: 'slide-left',
    delayMs: 300,
    motionDurationMs: 400,
    motionCurve: 'cinematic',
  });
  const before = evaluateCanvasObject(object, scene, 200);
  const during = evaluateCanvasObject(object, scene, 420);
  const after = evaluateCanvasObject(object, scene, 800);
  assert.equal(before.opacity, 0);
  assert.ok(during.opacity > 0 && during.opacity < 1);
  assert.equal(Math.round(after.opacity * 100), 100);
});

test('camera shot and push-in increase visual scale over a scene', () => {
  const scene = createCanvasScene();
  scene.camera = { shot: 'close-up', motion: 'push-in', focusX: 400, focusY: 300, zoom: 1 };
  const start = evaluateCanvasCamera(scene, 0, 1280, 720);
  const end = evaluateCanvasCamera(scene, scene.durationMs, 1280, 720);
  assert.ok(start.scale > 1.2);
  assert.ok(end.scale > start.scale);
  assert.equal(start.focusX, 400);
  assert.equal(start.focusY, 300);
});

function assertCameraCoversFrame(camera: ReturnType<typeof evaluateCanvasCamera>, width: number, height: number) {
  const angle = -camera.rotation * Math.PI / 180;
  for (const [x, y] of [[0, 0], [width, 0], [0, height], [width, height]] as Array<[number, number]>) {
    const dx = x - camera.offsetX - camera.focusX;
    const dy = y - camera.offsetY - camera.focusY;
    const worldX = camera.focusX + (dx * Math.cos(angle) - dy * Math.sin(angle)) / camera.scale;
    const worldY = camera.focusY + (dx * Math.sin(angle) + dy * Math.cos(angle)) / camera.scale;
    assert.ok(worldX >= -1e-7 && worldX <= width + 1e-7, `exposed horizontal edge at ${worldX}`);
    assert.ok(worldY >= -1e-7 && worldY <= height + 1e-7, `exposed vertical edge at ${worldY}`);
  }
}

test('Ma Da off-center pans keep the background covering the frame and retain movement', () => {
  for (const motion of ['pan-left', 'pan-right'] as const) {
    const scene = createCanvasScene();
    scene.camera = { shot: 'wide', motion, focusX: 371.2, focusY: 439.2, zoom: 1.05 };
    const start = evaluateCanvasCamera(scene, 0, 1280, 720);
    const end = evaluateCanvasCamera(scene, scene.durationMs, 1280, 720);
    for (let time = 0; time <= scene.durationMs; time += 40) {
      assertCameraCoversFrame(evaluateCanvasCamera(scene, time, 1280, 720), 1280, 720);
    }
    assertCameraCoversFrame(end, 1280, 720);
    assert.ok(motion === 'pan-left' ? end.offsetX > start.offsetX : end.offsetX < start.offsetX);
  }
});

test('zoom out, follow and camera shake never expose edges at different aspect ratios and focus positions', () => {
  for (const [width, height] of [[1280, 720], [720, 1280], [640, 640]] as Array<[number, number]>) {
    for (const motion of ['none', 'push-in', 'pull-out', 'pan-left', 'pan-right', 'follow', 'impact'] as const) {
      for (const zoom of [.8, 1, 1.5]) {
        for (const [focusX, focusY] of [[0, 0], [width / 2, height / 2], [width, height]] as Array<[number, number]>) {
          const scene = createCanvasScene();
          scene.camera = { shot: 'wide', motion, focusX, focusY, zoom };
          for (let time = 0; time <= scene.durationMs; time += 40) {
            assertCameraCoversFrame(evaluateCanvasCamera(scene, time, width, height), width, height);
          }
        }
      }
    }
  }
});

test('impact motion produces a stronger transform near impact than at start', () => {
  const scene = createCanvasScene();
  const object = createCanvasObject('ship', { motion: 'hit', rotation: 0 });
  const start = evaluateCanvasObject(object, scene, 0);
  const impact = evaluateCanvasObject(object, scene, scene.durationMs * .48);
  assert.ok(Math.abs(impact.rotation) > Math.abs(start.rotation));
  assert.ok(impact.scale > start.scale);
});

test('project timeline resolves local scene time', () => {
  const first = createCanvasScene(0);
  first.durationMs = 1000;
  const second = createCanvasScene(1);
  second.durationMs = 1500;
  const scenes = [first, second];
  assert.equal(projectDurationMs(scenes), 2500);
  const resolved = resolveProjectTime(scenes, 1250);
  assert.ok(resolved.scene);
  assert.equal(resolved.scene.id, second.id);
  assert.equal(resolved.sceneIndex, 1);
  assert.equal(resolved.localTimeMs, 250);
});


test('object keyframes create deterministic multi-stage motion over semantic layout', () => {
  const scene = createCanvasScene();
  scene.durationMs = 3000;
  const actor = createCanvasObject('character', {
    x: 400,
    y: 420,
    motion: 'none',
    keyframes: [
      { atMs: 0, dx: 0, dy: 0, scale: 1, rotation: 0, opacity: 1, pose: 'idle' },
      { atMs: 1000, dx: 240, dy: -40, scale: 1.08, rotation: -5, pose: 'run', easing: 'ease-in-out' },
      { atMs: 2000, dx: 300, dy: 80, scale: .96, rotation: 18, pose: 'brace', expression: 'surprised', easing: 'snappy' },
    ],
  });
  scene.objects = [actor];

  const start = evaluateCanvasObject(actor, scene, 0);
  const middle = evaluateCanvasObject(actor, scene, 1000);
  const end = evaluateCanvasObject(actor, scene, 2000);
  assert.equal(Math.round(start.x), 400);
  assert.equal(Math.round(middle.x), 640);
  assert.equal(Math.round(end.x), 700);
  assert.equal(Math.round(end.y), 500);
  assert.equal(applyCanvasChoreographyState(actor, scene, 1200).pose, 'run');
  assert.equal(applyCanvasChoreographyState(actor, scene, 2200).pose, 'brace');
  assert.equal(applyCanvasChoreographyState(actor, scene, 2200).expression, 'surprised');
});

test('travel ends at its destination and never duplicates explicit keyframe travel', () => {
  const actor=createCanvasObject('character',{facing:'right',motion:'none'});
  const scene=createCanvasScene();
  scene.animationBeats=[{id:'travel',action:'run',atMs:100,durationMs:1000,targetIds:[actor.id],intensity:1}];
  assert.equal(evaluateCanvasChoreographyOffset(actor,scene,1100).x,58);
  assert.equal(evaluateCanvasChoreographyOffset(actor,scene,1101).x,58);
  const keyed={...actor,keyframes:[{atMs:0,dx:0},{atMs:1100,dx:170}]};
  assert.equal(evaluateCanvasChoreographyOffset(keyed,scene,800).x,0);
  assert.equal(evaluateCanvasChoreographyOffset(keyed,scene,1300).x,0);
});

test('authored actions ease from rest and settle before the pose changes', () => {
  const actor=createCanvasObject('character',{pose:'point'});
  const scene=createCanvasScene();
  scene.animationBeats=[{id:'point',action:'point',atMs:500,durationMs:1800,targetIds:[actor.id],intensity:1}];
  assert.equal(canvasActingTiming(actor,scene,500).weight,0);
  assert.equal(canvasActingTiming(actor,scene,1400).weight,1);
  assert.equal(canvasActingTiming(actor,scene,2300).weight,0);
});

test('completed gestures do not restart and held contact does not dip then snap back',()=>{
  const actor=createCanvasObject('character',{pose:'aid',keyframes:[{atMs:0,pose:'aid'}]});
  const scene=createCanvasScene();scene.objects=[actor];
  scene.animationBeats=[{id:'aid',action:'aid',targetIds:[actor.id],atMs:500,durationMs:1800}];
  for(const time of [2299,2300,2301,4000])assert.equal(canvasActingTiming(actor,scene,time).weight,1);
  assert.equal(canvasActingTiming(actor,scene,4000).localMs,1800,'finished action time is held rather than looped');
  actor.pose='talk';actor.keyframes=undefined;scene.animationBeats[0]!.action='talk';
  for(const time of [2300,2301,4000])assert.equal(canvasActingTiming(actor,scene,time).weight,0,'completed phrase gesture remains at rest');
  actor.pose='run';actor.keyframes=[{atMs:0,dx:0,pose:'run'},{atMs:4000,dx:100,pose:'run'}];scene.animationBeats[0]!.action='run';
  assert.equal(canvasActingTiming(actor,scene,3000).weight,1,'authored walking continues while travel outlasts its spoken cue');
});

test('reaction is one smooth recoil instead of rapid alternating tremors',()=>{
  const actor=createCanvasObject('character'),scene=createCanvasScene();scene.objects=[actor];
  scene.animationBeats=[{id:'reaction',action:'react',targetIds:[actor.id],atMs:0,durationMs:800,intensity:1}];
  let previous=0;
  for(let time=0;time<=800;time+=16){
    const offset=evaluateCanvasChoreographyOffset(actor,scene,time);
    assert.ok(offset.x<=.001&&offset.x>=-4.001);
    assert.ok(Math.abs(offset.x-previous)<.3,'no frame-to-frame tremor');previous=offset.x;
  }
});

test('physical close shots keep feet in frame even with stacked zoom tracks',()=>{
  const actor=createCanvasObject('character',{id:'doctor',x:740,y:440,width:185,height:381,role:'focal',keyframes:[{atMs:0,dx:0,dy:0},{atMs:3000,dx:10,dy:15}]}),
    patient=createCanvasObject('character',{id:'patient',x:860,y:440,width:185,height:381,role:'support',pose:'sit'});
  const scene=createCanvasScene();scene.template='close-reaction';scene.durationMs=5000;scene.objects=[actor,patient];
  scene.animationBeats=[{id:'aid',action:'aid',targetIds:[actor.id],focusTargetId:patient.id,atMs:0,durationMs:3000}];
  scene.camera={shot:'extreme-close-up',motion:'push-in',focusX:860,focusY:440,zoom:1.3,keyframes:[{atMs:0,zoom:1.3},{atMs:3000,zoom:1.4}]};
  for(const time of [0,1000,3000,4999]){
    const camera=evaluateCanvasCamera(scene,time,1280,720);
    for(const person of scene.objects){
      const position=evaluateCanvasObject(person,scene,time),footY=position.y+Math.min(person.width/68,person.height/100)*60;
      const screenY=camera.focusY+(footY-camera.focusY)*camera.scale+camera.offsetY;
      assert.ok(screenY>=0&&screenY<=696,`feet must remain visible at ${time}ms (${screenY})`);
    }
  }
});

test('camera keyframes interpolate relative pan zoom and rotation without exposing frame edges', () => {
  const scene = createCanvasScene();
  scene.durationMs = 2400;
  scene.camera = {
    shot: 'wide',
    motion: 'none',
    focusX: 640,
    focusY: 360,
    zoom: 1,
    keyframes: [
      { atMs: 0, dx: 0, dy: 0, zoom: 1, rotation: 0 },
      { atMs: 1200, dx: -90, dy: 20, zoom: 1.15, rotation: 1.5, easing: 'ease-in-out' },
      { atMs: 2400, dx: 70, dy: -15, zoom: 1.24, rotation: -.8, easing: 'ease-out' },
    ],
  };
  const start = evaluateCanvasCamera(scene, 0, 1280, 720);
  const middle = evaluateCanvasCamera(scene, 1200, 1280, 720);
  const end = evaluateCanvasCamera(scene, 2400, 1280, 720);
  assert.ok(middle.scale > start.scale);
  assert.ok(end.scale > middle.scale);
  assert.notEqual(Math.round(middle.offsetX), Math.round(start.offsetX));
  for (let time = 0; time <= scene.durationMs; time += 40) {
    assertCameraCoversFrame(evaluateCanvasCamera(scene, time, 1280, 720), 1280, 720);
  }
});

test('scene choreography changes pose and adds independent impact motion inside the beat window', () => {
  const scene = createCanvasScene();
  const actor = createCanvasObject('character', { id: 'actor', pose: 'idle', motion: 'none', x: 500 });
  scene.objects = [actor];
  scene.animationBeats = [
    { id: 'point-beat', atMs: 300, durationMs: 900, action: 'point', targetIds: ['actor'], intensity: 1 },
    { id: 'react-beat', atMs: 1400, durationMs: 700, action: 'react', targetIds: ['actor'], intensity: 1 },
  ];

  assert.equal(applyCanvasChoreographyState(actor, scene, 100).pose, 'idle');
  assert.equal(applyCanvasChoreographyState(actor, scene, 600).pose, 'point');
  assert.equal(applyCanvasChoreographyState(actor, scene, 1700).expression, 'surprised');

  const before = evaluateCanvasObject(actor, scene, 100);
  const duringReaction = evaluateCanvasObject(actor, scene, 1700);
  assert.notEqual(Math.round(duringReaction.x * 10), Math.round(before.x * 10));
});
