import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCanvasMotionDirection} from './canvasMotionDirector';
import {createCanvasObject,type CanvasStudioProject,type CanvasStudioScene} from './canvasAnimationStudio';

const actor=()=>createCanvasObject('character',{id:'linh',characterKey:'linh',label:'Linh',role:'focal',visualStyle:'horror',pose:'idle'});
const project=(scene:CanvasStudioScene):CanvasStudioProject=>({
  version:1,id:'p',name:'p',sourcePrompt:'truyện ma kinh dị',width:1280,height:720,fps:30,scenes:[scene],
});
const scene=(narration:string,extra:Partial<CanvasStudioScene>={}):CanvasStudioScene=>({
  id:'s',name:'Cảnh',durationMs:7000,background:'room',backgroundRef:'bg:room-simple-night',
  template:'hero-left',narration,dialogue:[],objects:[actor()],...extra,
});

test('quiet suspense hold relies on moving-hold and does not fabricate gestures',()=>{
  const out=compileCanvasMotionDirection(project(scene('Linh đứng im, nín thở trong căn phòng tối.')));
  assert.deepEqual(out.scenes[0]!.animationBeats||[],[]);
});

test('trừng mắt does not match the English run token or invent travel',()=>{
  const out=compileCanvasMotionDirection(project(scene('Con ma trừng mắt nhìn xuống con mồi bất động.')));
  assert.ok(!(out.scenes[0]!.animationBeats||[]).some(beat=>beat.action==='run'));
});

test('recompiling removes only a stale inferred run, preserving authored movement',()=>{
  const s=scene('Con ma trừng mắt nhìn xuống con mồi bất động.');
  const authored={id:'authored-run',atMs:800,durationMs:600,action:'run' as const,targetIds:['linh']};
  s.animationBeats=[authored,{id:'motion-s-run',atMs:3000,durationMs:1200,action:'run',targetIds:['linh']}];
  assert.deepEqual(compileCanvasMotionDirection(project(s)).scenes[0]!.animationBeats,[authored]);
});

test('real Vietnamese and English running cues still receive motivated travel',()=>{
  for(const cue of ['Linh chạy khỏi phòng.','The traveler runs away.','The traveler is running.']){
    assert.ok(compileCanvasMotionDirection(project(scene(cue))).scenes[0]!.animationBeats?.some(beat=>beat.action==='run'));
  }
});

test('hearing or turning cue receives one restrained head beat',()=>{
  const out=compileCanvasMotionDirection(project(scene('Ba tiếng gõ vang lên. Linh ngẩng đầu và lắng nghe.')));
  const beats=out.scenes[0]!.animationBeats||[];
  assert.equal(beats.length,1);
  assert.equal(beats[0]!.action,'nod');
  assert.equal(beats[0]!.speechCue,'head-up','ngẩng đầu must be directed as head-up, not a generic nod');
  assert.ok((beats[0]!.intensity||1)<.5);
});

test('sound-only listening cue becomes a restrained listen turn toward the real doorway',()=>{
  const door=createCanvasObject('prop',{id:'door',label:'Cánh cửa',variant:'door',environmentAnchor:'doorway'});
  const out=compileCanvasMotionDirection(project(scene('Ba tiếng gõ vang lên sau cánh cửa.',{objects:[actor(),door]})));
  const beats=out.scenes[0]!.animationBeats||[];
  assert.equal(beats.length,1);
  assert.equal(beats[0]!.action,'nod');
  assert.equal(beats[0]!.speechCue,'listen');
  assert.equal(beats[0]!.focusTargetId,'door','listening actor should turn toward the actual sound source when it exists in the set');
});

test('brace targets a visible threat and step-back travels away from it',()=>{
  const ghost=createCanvasObject('prop',{id:'ghost',label:'Bóng mờ',variant:'ghost',x:980});
  const lamp=createCanvasObject('prop',{id:'lamp',label:'Đèn',variant:'lantern'});
  const lead=actor();lead.x=360;
  const out=compileCanvasMotionDirection(project(scene('Linh lùi lại khi bóng mờ tiến gần trong ánh đèn.',{objects:[lead,ghost,lamp]})));
  const beats=out.scenes[0]!.animationBeats||[];
  const step=beats.find(beat=>beat.speechCue==='step-back');
  const brace=beats.find(beat=>beat.action==='brace');
  assert.equal(step?.action,'run');
  assert.equal(brace?.focusTargetId,'ghost');
  const moved=out.scenes[0]!.objects.find(object=>object.id==='linh')!;
  const dx=moved.keyframes?.filter(frame=>frame.dx!==undefined).at(-1)?.dx||0;
  assert.ok(dx<0,'actor left of threat must physically travel farther left');
});

test('explicit refusal to turn suppresses look-at even while the body retreats',()=>{
  const ghost=createCanvasObject('prop',{id:'ghost',label:'Bóng sau lưng',variant:'ghost',x:980});
  const lamp=createCanvasObject('prop',{id:'lamp',label:'Đèn',variant:'lantern'});
  const lead=actor();lead.x=360;
  const out=compileCanvasMotionDirection(project(scene('Linh lùi lại. Bóng mờ xuất hiện sau lưng. Cô không quay lại. Đèn tắt.',{objects:[lead,ghost,lamp]})));
  const beats=out.scenes[0]!.animationBeats||[];
  const brace=beats.find(beat=>beat.action==='brace');
  assert.equal(brace?.focusTargetId,undefined,'body may brace while the head deliberately refuses the threat');
  assert.ok(beats.some(beat=>beat.speechCue==='step-back'),'refusing to look must not cancel physical retreat');
});

test('opening a door reaches toward the authored doorway',()=>{
  const door=createCanvasObject('prop',{id:'door',label:'Cửa phòng',variant:'door',environmentAnchor:'doorway',x:1040});
  const out=compileCanvasMotionDirection(project(scene('Linh hé cửa và nhìn ra hành lang.',{objects:[actor(),door]})));
  const beat=(out.scenes[0]!.animationBeats||[])[0]!;
  assert.equal(beat.action,'reach');
  assert.equal(beat.focusTargetId,'door');
});

test('peeking through a doorway turns the head toward a visible threat',()=>{
  const ghost=createCanvasObject('prop',{id:'ghost',label:'Bóng người',variant:'ghost',x:960});
  const out=compileCanvasMotionDirection(project(scene('Linh nhìn qua khe cửa và thấy bóng người ở cuối hành lang.',{objects:[actor(),ghost]})));
  const beat=(out.scenes[0]!.animationBeats||[])[0]!;
  assert.equal(beat.action,'nod');
  assert.equal(beat.speechCue,'head-turn');
  assert.equal(beat.focusTargetId,'ghost');
});

test('startle cue receives a single reaction instead of a decorative loop',()=>{
  const out=compileCanvasMotionDirection(project(scene('Linh giật mình khi tiếng động vang ngay sau lưng.')));
  const beats=out.scenes[0]!.animationBeats||[];
  assert.equal(beats.length,1);
  assert.equal(beats[0]!.action,'react');
  assert.ok(beats[0]!.durationMs<900);
});

test('existing physical action is never replaced or duplicated by auto acting',()=>{
  const s=scene('Linh giật mình rồi chạy khỏi phòng.');
  s.animationBeats=[{id:'authored',atMs:1000,durationMs:1800,action:'run',targetIds:['linh']}];
  const out=compileCanvasMotionDirection(project(s));
  assert.deepEqual(out.scenes[0]!.animationBeats,s.animationBeats);
});

test('long spoken line gets at most one restrained gesture when no stronger action exists',()=>{
  const s=scene('');
  s.dialogue=[{id:'line',speaker:'Linh',characterKey:'linh',text:'Tôi nghĩ chúng ta không nên mở cánh cửa này vào lúc này, vì có điều gì đó đang đứng ở phía bên kia.'}];
  const out=compileCanvasMotionDirection(project(s));
  const beats=out.scenes[0]!.animationBeats||[];
  assert.equal(beats.length,1);
  assert.equal(beats[0]!.action,'gesture');
  assert.equal(beats[0]!.dialogueId,'line');
});
