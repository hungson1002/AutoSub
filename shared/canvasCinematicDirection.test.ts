import assert from 'node:assert/strict';
import test from 'node:test';
import {createCanvasScene,createCanvasObject,createCanvasProject} from './canvasAnimationStudio';
import {directCanvasScene,directCanvasProject} from './canvasCinematicDirection';
import {evaluateCanvasObject} from '../src/canvasAnimationStudio/runtime';
import {applyCanvasChoreographyState} from '../src/canvasAnimationStudio/choreography';
import {canvasCharacterHand,resolveStageCharacterRig} from '../src/canvasAnimationStudio/characters/characterStaging';
import {characterDrawingScale} from '../src/canvasAnimationStudio/characters/characterModel';
import {resolveCharacterModel} from '../src/canvasAnimationStudio/characters/characterModel';

function waterScene(){
  const scene=createCanvasScene();scene.background='river';scene.backgroundRef='bg:river-establishing';scene.durationMs=10000;
  scene.visualBrief='Khúc sông ban đêm, bóng đêm phủ kín.';
  scene.narration='Ma Da túm chặt lấy cổ chân người bơi, lôi ghì xuống vực sâu.';
  scene.objects=[createCanvasObject('prop',{id:'ghost',variant:'ghost',slot:'hero-left'}),createCanvasObject('character',{id:'swimmer',characterKey:'swimmer',pose:'brace',designNotes:'Người bơi sông',slot:'hero-left'})];
  return scene;
}
test('night direction, physical ghost and before/during/after water staging are idempotent',()=>{
  const scene=directCanvasScene(waterScene(),1280,720);
  assert.equal(scene.backgroundRef,'bg:night-river-shoreline');
  assert.equal(scene.objects[0]!.appearance,'water-spirit');assert.equal(scene.objects[0]!.kind,'character');
  assert.ok(scene.animationBeats!.some(b=>b.action==='grab'&&b.focusTargetId==='swimmer'));
  assert.ok(scene.animationBeats!.some(b=>b.action==='sink'&&b.targetIds.includes('swimmer')));
  assert.deepEqual(directCanvasScene(scene,1280,720),scene);
  const sink=scene.animationBeats!.find(b=>b.action==='sink'&&b.targetIds.includes('swimmer'))!;
  const swimmer=scene.objects[1]!;
  const before=evaluateCanvasObject(swimmer,scene,sink.atMs),after=evaluateCanvasObject(swimmer,scene,sink.atMs+sink.durationMs);
  assert.ok(after.y>before.y+swimmer.height*.40);assert.equal(after.opacity,before.opacity,'sink uses actual depth, not a fade');
});
test('ghost grip reaches the same ankle anchor while both bodies sink',()=>{
  const scene=directCanvasScene(waterScene(),1280,720),ghost=scene.objects[0]!,victim=scene.objects[1]!;
  const grab=scene.animationBeats!.find(b=>b.action==='grab')!;
  for(const time of [grab.atMs+400,grab.atMs+1500,9000]){
    const state=applyCanvasChoreographyState(ghost,scene,time),hand=canvasCharacterHand(state,scene,time,false);
    const position=evaluateCanvasObject(victim,scene,time),{rig,model}=resolveStageCharacterRig(victim,scene,time,false);
    const scale=characterDrawingScale(victim,model)*position.scale;
    const foot={x:position.x+rig.footL.x*scale,y:position.y+rig.footL.y*scale};
    assert.ok(Math.hypot(hand.x-foot.x,hand.y-foot.y)<8,`grip must remain on ankle at ${time}ms`);
  }
});
test('exposed bodies retain identity and no treatment is invented for a future command',()=>{
  const scene=waterScene();scene.narration='Đừng túm chặt lấy cổ chân người bơi.';
  assert.ok(!directCanvasScene(scene,1280,720).animationBeats?.some(b=>b.action==='grab'));
  scene.narration='Hôm sau, xác người dạt vào bãi bồi.';scene.objects[1]!.pose='lie-down';
  const result=directCanvasScene(scene,1280,720);
  assert.equal(result.objects[1]!.pose,'float-body');assert.equal(result.objects[1]!.recliningStyle,'exposed');
  assert.equal(result.objects[1]!.waterlineY,undefined,'a washed-ashore body is fully exposed on the bank');
  const project=createCanvasProject();project.scenes=[result,structuredClone(result)];project.scenes[1]!.objects[1]!.hair='bald';
  assert.equal(directCanvasProject(project).scenes[1]!.objects[1]!.hair,project.scenes[0]!.objects[1]!.hair);
});

test('a narrator describing what will happen to a swimmer receives a physical grip and descent',()=>{
  const scene=waterScene();
  scene.narration='Chỉ cần một phút bất cẩn, một bàn tay nhớp nháp, lạnh toát sẽ bất thần túm chặt lấy cổ chân người bơi, lôi ghì xuống vực sâu không đáy.';
  const directed=directCanvasScene(scene,1280,720);
  assert.ok(directed.animationBeats?.some(b=>b.action==='grab'));
  assert.equal(directed.animationBeats?.filter(b=>b.action==='sink').length,2);
});

test('water emergence stays below the surface before its event and rises continuously instead of blinking',()=>{
  const scene=waterScene();scene.narration='Một bóng đen lặng lẽ xuất hiện.';
  scene.animationBeats=[{id:'old-icon-reveal',action:'reveal',targetIds:['ghost'],atMs:3000,durationMs:1500}];
  const directed=directCanvasScene(scene,1280,720),ghost=directed.objects[0]!;
  assert.equal(directed.animationBeats![0]!.action,'surface');
  const before=evaluateCanvasObject(ghost,directed,2999),start=evaluateCanvasObject(ghost,directed,3000),end=evaluateCanvasObject(ghost,directed,4500);
  assert.ok(Math.abs(before.y-start.y)<.1);assert.ok(end.y<start.y-ghost.height*.7);
  assert.equal(end.scale,start.scale);assert.equal(end.opacity,start.opacity);
});

test('cast anatomy remains consistent across day and dark house scenery and walking is not overwritten by idle keyframes',()=>{
  const project=createCanvasProject();project.sourcePrompt='Một câu chuyện 2D bình thường.';
  const scene=createCanvasScene();scene.objects=[createCanvasObject('character',{characterKey:'lan',hair:'bun',motion:'walk-right',pose:'idle',keyframes:[{atMs:0,dx:0,pose:'idle'},{atMs:3000,dx:100,pose:'idle'}]})];
  scene.animationBeats=[{id:'walk',action:'run',targetIds:[scene.objects[0]!.id],atMs:0,durationMs:900}];
  const dark=structuredClone(scene);dark.backgroundRef='bg:room-stilt-house';
  project.scenes=[scene,dark];const compiled=directCanvasProject(project);
  const a=compiled.scenes[0]!,b=compiled.scenes[1]!;
  assert.equal(a.objects[0]!.pose,'run');assert.equal(a.animationBeats![0]!.durationMs,3000);
  assert.equal(applyCanvasChoreographyState(a.objects[0]!,a,2500).pose,'run');
  const daylight=resolveCharacterModel(a.objects[0]!,a),night=resolveCharacterModel(b.objects[0]!,b);
  assert.equal(daylight.faceWidth,night.faceWidth);assert.equal(daylight.faceHeight,night.faceHeight);
  assert.ok(daylight.age<55,'a hair bun does not mean an elderly character');
});

test('next morning overrides inherited night and retains supported backgrounds and sandals',()=>{
  const project=createCanvasProject(),night=waterScene(),morning=createCanvasScene();
  morning.background='night';morning.backgroundRef='bg:night-river-shoreline';morning.template='wide-establishing';
  morning.atmosphere={timeOfDay:'night'};
  morning.visualBrief='Tr\u1eddi v\u1eeba h\u1eedng s\u00e1ng m\u1edd m\u1ecbt s\u01b0\u01a1ng lam';
  morning.narration='S\u00e1ng h\u00f4m sau, kh\u00fac s\u00f4ng l\u1ea1i ph\u1eb3ng l\u1eb7ng sau m\u1ed9t \u0111\u00eam.';
  morning.objects=[createCanvasObject('prop',{assetRef:'prop:sandals',variant:'box',label:'doi-dep-vo-chu'})];
  const later=structuredClone(morning);later.visualBrief='The same river bank';later.narration='The river is calm.';
  project.scenes=[night,morning,later];
  const result=directCanvasProject(project);
  assert.equal(result.scenes[0]!.background,'night');
  for(const scene of result.scenes.slice(1)){
    assert.equal(scene.background,'river');assert.equal(scene.atmosphere!.timeOfDay,'day');
    assert.equal(scene.backgroundRef,'bg:river-shoreline');
    assert.equal(scene.objects[0]!.variant,'sandals');
  }
  assert.deepEqual(directCanvasProject(result),result);
});
test('a character mentioning tomorrow does not turn a night house into daylight or a river',()=>{
  const scene=createCanvasScene();scene.background='night';scene.backgroundRef='bg:night-stilt-house';
  scene.visualBrief='A timber house at night';scene.atmosphere={timeOfDay:'night'};
  scene.dialogue=[{id:'speech',speaker:'Minh',characterKey:'minh',text:'Bu\u1ed5i s\u00e1ng mai ch\u00fang ta s\u1ebd \u0111i.',atMs:0,durationMs:2000}];
  const result=directCanvasScene(scene,1280,720);
  assert.equal(result.backgroundRef,'bg:night-stilt-house');assert.equal(result.atmosphere!.timeOfDay,'night');
});

test('morning mist and dawn light override metaphorical night in the narration',()=>{
  for(const visualBrief of ['Bến sông trong sương sớm.', 'Ánh ban mai chiếu lên bờ sông.']){
    const scene=createCanvasScene();scene.background='night';scene.backgroundRef='bg:night-river-shoreline';
    scene.template='over-shoulder';scene.atmosphere={timeOfDay:'night'};
    scene.visualBrief=visualBrief;scene.narration='Bến sông vẫn giữ kín bí mật của màn đêm.';
    const result=directCanvasScene(scene,1280,720);
    assert.equal(result.background,'river');assert.equal(result.atmosphere!.timeOfDay,'day');
    assert.equal(result.backgroundRef,'bg:river-shoreline');
    assert.deepEqual(directCanvasScene(result,1280,720),result);
  }
});
