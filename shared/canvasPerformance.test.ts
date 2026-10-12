import assert from 'node:assert/strict';
import test from 'node:test';
import {createCanvasScene,createCanvasObject} from './canvasAnimationStudio';
import {synchronizeCanvasPerformance} from './canvasPerformance';

test('a pickup follows its measured sentence after a dramatic pause and its transaction uses that same timing',()=>{
  const scene=createCanvasScene();scene.durationMs=8500;
  scene.dialogue=[{id:'narrator',speaker:'Người kể',text:'Trên bờ có đôi dép nhỏ. Minh nhặt chúng lên. Bên kia có bóng người.',durationMs:8100,
    speechWindows:[{startMs:0,endMs:1440},{startMs:2540,endMs:2980},{startMs:3080,endMs:3540},{startMs:4560,endMs:5080},{startMs:5380,endMs:7280}]}];
  scene.objects=[createCanvasObject('prop',{id:'sandals',variant:'sandals',handling:{actorId:'minh',kind:'pick-up',atMs:1273,durationMs:2000}})];
  scene.animationBeats=[{id:'pick',action:'reach',targetIds:['minh'],focusTargetId:'sandals',speechCue:'Minh nhặt chúng lên.',atMs:1273,durationMs:2000}];
  synchronizeCanvasPerformance(scene);
  assert.equal(scene.animationBeats[0]!.atMs,2540);
  assert.equal(scene.objects[0]!.handling!.atMs,2540);
  const once=structuredClone(scene);synchronizeCanvasPerformance(scene);assert.deepEqual(scene,once);
});

test('quiet dialogue never generates listener movement and preserves explicit acknowledgements',()=>{
  const scene=createCanvasScene();scene.durationMs=15000;scene.dialogueLayout=true;
  scene.objects=[createCanvasObject('character',{id:'a',characterKey:'a'}),createCanvasObject('character',{id:'b',characterKey:'b'})];
  scene.dialogue=[{id:'line',speaker:'A',characterKey:'a',text:'Hello',durationMs:6000}];
  scene.animationBeats=[{id:'listen-old',action:'nod',targetIds:['b'],atMs:4000,durationMs:850},
    {id:'authored',action:'nod',targetIds:['b'],atMs:8000,durationMs:1000}];
  synchronizeCanvasPerformance(scene);
  assert.deepEqual(scene.animationBeats.filter(b=>b.action==='nod').map(b=>b.id),['authored']);
  const once=structuredClone(scene);synchronizeCanvasPerformance(scene);assert.deepEqual(scene,once);
});

test('pre-TTS character dialogue gets a provisional talk beat that measured audio can replace',()=>{
  const scene=createCanvasScene();scene.durationMs=10000;
  scene.objects=[createCanvasObject('character',{id:'tu',label:'Ông Tư',characterKey:'ong-tu'})];
  scene.dialogue=[
    {id:'narrator',speaker:'Người kể',text:'Ngoài sân có tiếng động.'},
    {id:'tu-line',speaker:'Ông Tư',characterKey:'ong-tu',text:'Chỗ nhà ai lại đi bằng hai chân sau mà chống gậy? Cấm bước ra sân!'},
  ];
  synchronizeCanvasPerformance(scene);
  const planned=scene.animationBeats!.find(beat=>beat.id==='voice-tu-line')!;
  assert.equal(planned.action,'talk');
  assert.deepEqual(planned.targetIds,['tu']);
  assert.equal(planned.dialogueId,'tu-line');
  assert.ok(planned.atMs>0&&planned.durationMs>0);
  assert.ok(planned.speechCue?.startsWith('Chỗ nhà ai lại đi bằng hai chân sau'));

  scene.dialogue[1]!.atMs=7200;scene.dialogue[1]!.durationMs=2400;
  synchronizeCanvasPerformance(scene);
  const measured=scene.animationBeats!.find(beat=>beat.id==='voice-tu-line')!;
  assert.equal(measured.atMs,7200);
  assert.equal(measured.durationMs,2400);
  assert.equal(scene.animationBeats!.filter(beat=>beat.id==='voice-tu-line').length,1);
});

test('phrase cue aligns after TTS across a silent gap and is idempotent',()=>{
  const scene=createCanvasScene(0);scene.durationMs=6000;
  scene.dialogue=[{id:'line',speaker:'Minh',text:'Minh nhìn chiếc đèn',atMs:1000,durationMs:3000,audioUrl:'existing.wav',
    speechWindows:[{startMs:200,endMs:1000},{startMs:2000,endMs:2800}]}];
  scene.animationBeats=[{id:'point',action:'point',atMs:0,durationMs:700,targetIds:['actor'],speechCue:'chiếc đèn',dialogueId:'line'}];
  synchronizeCanvasPerformance(scene);
  const at=scene.animationBeats[0]!.atMs;assert.ok(at>=3000&&at<3800);
  const once=structuredClone(scene);synchronizeCanvasPerformance(scene);assert.deepEqual(scene,once);
  assert.equal(scene.dialogue[0]!.audioUrl,'existing.wav');
});

test('visual beat speech cues retime only their derived object and camera frames after TTS',()=>{
  const scene=createCanvasScene(0);scene.durationMs=7000;
  const ghost=createCanvasObject('prop',{id:'ghost',variant:'ghost',keyframes:[
    {atMs:0,opacity:0,easing:'hold'},
    {atMs:900,opacity:0,visualBeatId:'vb',visualBeatPhase:'start',easing:'hold'},
    {atMs:1500,opacity:1,visualBeatId:'vb',visualBeatPhase:'end',easing:'ease-out'},
  ]});
  scene.objects=[ghost];
  scene.dialogue=[{id:'n',speaker:'Người kể',text:'Căn phòng im lặng. Bóng người hiện ra ở cửa.',atMs:0,durationMs:6200,
    speechWindows:[{startMs:0,endMs:1600},{startMs:3600,endMs:5600}]}];
  scene.visualBeats=[{id:'vb',action:'reveal-layer',atMs:900,durationMs:600,targetIds:['ghost'],speechCue:'Bóng người hiện ra'}];
  scene.camera={shot:'medium',motion:'none',focusX:640,focusY:360,zoom:1,keyframes:[
    {atMs:0,zoom:1},
    {atMs:900,zoom:1,visualBeatId:'vb',visualBeatPhase:'start'},
    {atMs:1500,zoom:1.015,visualBeatId:'vb',visualBeatPhase:'end'},
  ]};
  synchronizeCanvasPerformance(scene);
  const beat=scene.visualBeats[0]!;
  assert.ok(beat.atMs>=3500&&beat.atMs<5000,'visual event follows the measured second spoken phrase');
  assert.equal(ghost.keyframes?.find(frame=>frame.visualBeatPhase==='start')?.atMs,beat.atMs);
  assert.equal(ghost.keyframes?.find(frame=>frame.visualBeatPhase==='end')?.atMs,beat.atMs+beat.durationMs);
  assert.equal(scene.camera.keyframes?.find(frame=>frame.visualBeatPhase==='start')?.atMs,beat.atMs);
  const once=structuredClone(scene);synchronizeCanvasPerformance(scene);assert.deepEqual(scene,once);
});

test('unmatched, partial-word and punctuation-only cues preserve authored timing',()=>{
  const scene=createCanvasScene(0);scene.dialogue=[{id:'a',speaker:'A',text:'đèn sáng',durationMs:1000}];
  scene.animationBeats=['không có','sán','...'].map((speechCue,index)=>({id:String(index),action:'point',atMs:350,durationMs:500,targetIds:['a'],speechCue}));
  synchronizeCanvasPerformance(scene);assert.ok(scene.animationBeats.every(beat=>beat.atMs===350));
});
