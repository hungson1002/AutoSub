import assert from 'node:assert/strict';
import test from 'node:test';
import {createCanvasScene,createCanvasObject,createCanvasProject} from './canvasAnimationStudio';
import {directCanvasScene,directCanvasProject} from './canvasCinematicDirection';
import {evaluateCanvasObject} from '../src/canvasAnimationStudio/runtime';
import {applyCanvasChoreographyState} from '../src/canvasAnimationStudio/choreography';
import {canvasCharacterHand,resolveStageCharacterRig} from '../src/canvasAnimationStudio/characters/characterStaging';
import {characterDrawingScale} from '../src/canvasAnimationStudio/characters/characterModel';
import {resolveCharacterModel} from '../src/canvasAnimationStudio/characters/characterModel';
import {compileCanvasProjectLayout} from './canvasLayoutCompiler';

test('Vietnamese đem is not đêm and cannot overwrite a repaired daytime scene',()=>{
  const scene=createCanvasScene();scene.background='field';scene.atmosphere={timeOfDay:'day'};
  scene.visualBrief='Ông Tư muốn đem con heo ra bãi bần.';
  scene.narration='Mọi người đem con heo đến sân đình.';
  assert.equal(directCanvasScene(scene,1280,720).atmosphere!.timeOfDay,'day');
  scene.visualBrief='Trong đêm, mọi người đem đèn ra bờ sông.';
  assert.equal(directCanvasScene(scene,1280,720).atmosphere!.timeOfDay,'night');
});

test('generic midday legend retains the dusk river and recompilation preserves the physical grip',()=>{
  const project=createCanvasProject(),establish=waterScene(),grip=waterScene();
  establish.template='foreground-pov';establish.background='night';establish.backgroundRef='bg:night-river-shoreline';
  establish.visualBrief='Nhìn mặt sông lúc chạng vạng.';establish.narration='Khi chập choạng tối hay giữa trưa vắng lặng, chúng trồi lên.';
  grip.background='night';grip.backgroundRef='bg:night-river-shoreline';grip.template='two-shot';
  project.scenes=[establish,grip];
  for(let i=0;i<3;i++){
    project.scenes=compileCanvasProjectLayout(project).scenes;
    assert.equal(project.scenes[0]!.atmosphere!.timeOfDay,'dusk');
    assert.equal(project.scenes[1]!.backgroundRef,'bg:night-river-shoreline');
    const victim=project.scenes[1]!.objects.find(o=>o.characterKey==='swimmer')!;
    assert.equal(victim.x,1280*.54);assert.equal(victim.y,720*.4);
  }
});
import {evaluateAttachedProp,resolveCanvasLight} from '../src/canvasAnimationStudio/propAttachment';

test('standing fear never becomes a blanket pose, while a bed retains covering',()=>{
  const scene=createCanvasScene();scene.objects=[createCanvasObject('character',{pose:'cover-face',keyframes:[{atMs:1200,pose:'cover-face'}]})];
  const standing=directCanvasScene(scene,1280,720);
  assert.equal(standing.objects[0]!.pose,'brace');assert.equal(standing.objects[0]!.keyframes![0]!.pose,'brace');
  scene.objects.push(createCanvasObject('prop',{variant:'bed'}));
  assert.equal(directCanvasScene(scene,1280,720).objects[0]!.pose,'cover-face');
});

test('repeated clause reactions do not restart the same actor gesture',()=>{
  const scene=createCanvasScene();scene.objects=[createCanvasObject('character',{id:'minh'})];
  scene.animationBeats=[0,1800,3000].map((atMs,i)=>({id:`react-${i}`,action:'react' as const,atMs,durationMs:900,targetIds:['minh']}));
  const result=directCanvasScene(scene,1280,720);
  assert.equal(result.animationBeats!.length,1);assert.equal(result.animationBeats![0]!.atMs,0);
  assert.deepEqual(directCanvasScene(result,1280,720),result);
});

test('a light follows the held lantern flame through travel and rotation; orphan halos are removed',()=>{
  const scene=createCanvasScene();scene.objects=[createCanvasObject('character',{id:'holder',keyframes:[{atMs:0,dx:0},{atMs:3000,dx:120}]}),createCanvasObject('prop',{id:'lamp',variant:'lantern',heldBy:'holder',rotation:12})];
  scene.effects=[{id:'light',type:'glow',x:640,y:360,scale:1}];
  const directed=directCanvasScene(scene,1280,720),lamp=directed.objects[1]!,effect=directed.effects![0]!;
  assert.equal(effect.sourceObjectId,lamp.id);
  for(const t of [0,600,1700,3000]){
    const prop=evaluateAttachedProp(lamp,directed,t),light=resolveCanvasLight(effect,directed,t);
    const angle=prop.rotation*Math.PI/180,pivot=lamp.height*.51*prop.scale;
    assert.ok(Math.abs(light.x-(prop.x-Math.sin(angle)*(pivot+lamp.height*.02*prop.scale)))<1e-8);
    assert.ok(Math.abs(light.y-(prop.y-pivot+Math.cos(angle)*(pivot+lamp.height*.02*prop.scale)))<1e-8);
  }
  assert.notEqual(resolveCanvasLight(effect,directed,0).x,resolveCanvasLight(effect,directed,3000).x);
  lamp.keyframes=[{atMs:0,lightLevel:1},{atMs:1000,lightLevel:0}];
  assert.equal(resolveCanvasLight(effect,directed,1000).intensity,0);
  scene.objects=[];assert.equal(directCanvasScene(scene,1280,720).effects!.length,0);
});

test('production direction holds most quiet shots and is idempotent',()=>{
  const project=createCanvasProject();project.scenes=Array.from({length:14},()=>({...createCanvasScene(),template:'two-shot' as const,camera:{shot:'medium' as const,motion:'push-in' as const,focusX:640,focusY:360,zoom:1.1,keyframes:[{atMs:0,zoom:1.1},{atMs:3000,zoom:1.4}]}}));
  const result=directCanvasProject(project);
  assert.equal(result.scenes.filter(s=>s.camera?.keyframes?.length).length,4);
  assert.ok(result.scenes.every(s=>s.camera?.motion==='none'));
  assert.deepEqual(directCanvasProject(result),result);
});

test('horror direction preserves authored restrained camera creeps instead of generic cadence deleting them',()=>{
  const project=createCanvasProject();project.sourcePrompt='truyện ma xó kinh dị';
  project.scenes=Array.from({length:6},(_,index)=>({
    ...createCanvasScene(),
    name:`Horror ${index}`,
    template:'two-shot' as const,
    background:'room' as const,
    backgroundRef:'bg:room-stilt-house',
    camera:{shot:'medium' as const,motion:'none' as const,focusX:640,focusY:360,zoom:1,keyframes:[{atMs:0,zoom:1},{atMs:6000,zoom:1.055,dy:-7,easing:'ease-in-out' as const}]},
  }));
  const result=directCanvasProject(project);
  assert.ok(result.scenes.every(scene=>scene.camera?.motion==='none'));
  assert.ok(result.scenes.every(scene=>scene.camera?.keyframes?.length===2));
  assert.deepEqual(directCanvasProject(result),result);
});

test('a speaking actor in a mislabeled insert is framed instead of the sandals',()=>{
  const scene=createCanvasScene();scene.template='prop-focus';
  scene.objects=[createCanvasObject('prop',{id:'sandals',variant:'sandals',role:'focal'}),createCanvasObject('character',{id:'minh',role:'support'})];
  scene.animationBeats=[{id:'speech',action:'talk',atMs:0,durationMs:2000,targetIds:['minh']}];
  const result=directCanvasScene(scene,1280,720);
  assert.equal(result.template,'hero-left');assert.equal(result.objects[1]!.role,'focal');
  assert.equal(result.camera!.focusX,result.objects[1]!.x);
  assert.deepEqual(directCanvasScene(result,1280,720),result);
});

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

test('an explicit daytime repair survives earlier night and repeated production compilation',()=>{
 const p=createCanvasProject(),a=createCanvasScene(),b=createCanvasScene();
 a.visualBrief='Một đêm bên sông.';a.atmosphere={timeOfDay:'night'};
 b.background='river';b.backgroundRef='bg:river-shoreline';b.atmosphere={timeOfDay:'day'};
 b.visualBrief='Bến sông trong buổi sớm mai thanh bình.';
 b.narration='Chú heo chào tạm biệt người đã cứu mình trong đêm giông bão.';
 p.scenes=[a,b];
 const result=directCanvasProject(p);
 assert.equal(result.scenes[1]!.atmosphere?.timeOfDay,'day');
 assert.equal(result.scenes[1]!.background,'river');
 assert.deepEqual(directCanvasProject(result),result);
});

test('day metadata takes precedence over inherited night when no time is spoken',()=>{
 const p=createCanvasProject(),a=createCanvasScene(),b=createCanvasScene();
 a.visualBrief='Ban đêm.';a.atmosphere={timeOfDay:'night'};
 b.atmosphere={timeOfDay:'day'};b.visualBrief='Mọi người đứng bàn chuyện ở sân đình.';
 p.scenes=[a,b];assert.equal(directCanvasProject(p).scenes[1]!.atmosphere?.timeOfDay,'day');
});

test('an explicit dusk correction is preserved after an earlier night legend',()=>{
 const p=createCanvasProject(),a=createCanvasScene(),b=createCanvasScene();
 a.visualBrief='Ban đêm.';a.atmosphere={timeOfDay:'night'};
 b.atmosphere={timeOfDay:'dusk'};b.visualBrief='Mọi người đứng bàn chuyện ở sân đình.';
 p.scenes=[a,b];const result=directCanvasProject(p);
 assert.equal(result.scenes[1]!.atmosphere?.timeOfDay,'dusk');
 assert.deepEqual(directCanvasProject(result),result);
});

test('daylight in a long-story ending survives metaphorical darkness and repeated compilation',()=>{
  const project=createCanvasProject();
  project.scenes=Array.from({length:25},(_,index)=>{
    const scene=createCanvasScene();scene.durationMs=12000;
    scene.template='two-shot';scene.background='room';scene.backgroundRef='bg:room-stilt-house';
    scene.visualBrief='Gian nha trong dem khuya.';scene.atmosphere={timeOfDay:'night'};
    scene.narration=`Loi ke canh ${index}.`;scene.audioUrl=`retained-audio-${index}`;
    return scene;
  });
  const dawn=project.scenes[23]!;
  dawn.visualBrief='Tia nang som dau tien chieu xuyen qua khe vach vao gian nha go.';
  dawn.narration='Tiếng gà gáy rạng sáng, ánh nắng rọi qua khe liếp.';
  const ending=project.scenes[24]!;ending.template='wide-establishing';ending.background='field';ending.backgroundRef='bg:field-open';
  ending.visualBrief='Toan canh ngoi nha san yen binh khi mat troi da len cao. Bong toi cua su mat mat van han sau trong doi mat nguoi song sot.';
  ending.narration='Gia đình Thanh thoát nạn trong gang tấc.';
  ending.atmosphere={timeOfDay:'day'};
  const original=structuredClone(project);
  let result=project;
  for(let pass=0;pass<4;pass++){
    result=compileCanvasProjectLayout(result);
    assert.equal(result.scenes[23]!.atmosphere?.timeOfDay,'day');
    assert.equal(result.scenes[23]!.backgroundRef,'bg:room-stilt-day');
    assert.equal(result.scenes[24]!.atmosphere?.timeOfDay,'day');
    assert.equal(result.scenes.length,25);
    assert.equal(result.scenes.reduce((sum,scene)=>sum+scene.durationMs,0),300000);
    assert.deepEqual(result.scenes.map(scene=>[scene.id,scene.narration,scene.audioUrl]),original.scenes.map(scene=>[scene.id,scene.narration,scene.audioUrl]));
  }
  assert.deepEqual(project,original);
});

test('unaccented dawn switches the same house to daylight and a later night remains night',()=>{
  const project=createCanvasProject(),night=createCanvasScene(),dawn=createCanvasScene(),later=createCanvasScene();
  for(const scene of [night,dawn,later]){
    scene.template='two-shot';scene.background='room';scene.backgroundRef='bg:room-stilt-house';scene.atmosphere={timeOfDay:'night'};
  }
  night.visualBrief='Gian nha trong dem toi.';
  dawn.visualBrief='Rang sang ngay thu ba cua dam tang. Gia dinh dung ben ban tra.';
  dawn.narration='Chưa đầy ba ngày sau, đại hoạ lại tới.';
  later.visualBrief='Con duong vao dem khuya.';later.narration='Ngay trong đêm, họ đi tìm thầy.';
  project.scenes=[night,dawn,later];
  const result=compileCanvasProjectLayout(project);
  assert.deepEqual(result.scenes.map(scene=>scene.atmosphere?.timeOfDay),['night','day','night']);
  assert.equal(result.scenes[1]!.backgroundRef,'bg:room-stilt-day');
  assert.equal(result.scenes[2]!.backgroundRef,'bg:room-stilt-house');
  assert.deepEqual(compileCanvasProjectLayout(result),result);
});

test('a repaired daylight atmosphere is not overwritten by metaphorical darkness',()=>{
  const scene=createCanvasScene();scene.atmosphere={timeOfDay:'day'};
  scene.visualBrief='Bong toi cua su mat mat van con han sau trong doi mat nhung nguoi song sot.';
  scene.narration='Gia đình Thanh thoát nạn trong gang tấc.';
  const result=directCanvasScene(scene,1280,720);
  assert.equal(result.atmosphere?.timeOfDay,'day');
  assert.deepEqual(directCanvasScene(result,1280,720),result);
});

test('a dawn detail shot retains the same stilt-house architecture',()=>{
  const project=createCanvasProject(),scene=createCanvasScene();
  scene.template='prop-focus';scene.background='room';scene.backgroundRef='bg:room-stilt-house';
  scene.visualBrief='Tia nang som chieu vao gian nha.';scene.atmosphere={timeOfDay:'night'};
  project.scenes=[scene];
  const result=compileCanvasProjectLayout(project);
  assert.equal(result.scenes[0]!.backgroundRef,'bg:room-stilt-day');
  assert.deepEqual(compileCanvasProjectLayout(result),result);
});

test('waiting until dawn in narration does not brighten the current night shot',()=>{
  const scene=createCanvasScene();scene.template='two-shot';
  scene.background='room';scene.backgroundRef='bg:room-stilt-house';scene.atmosphere={timeOfDay:'night'};
  scene.visualBrief='Cả nhà ngồi im trong đêm khuya.';
  scene.narration='Họ quyết định chờ tới rạng sáng mới mở cửa.';
  const result=directCanvasScene(scene,1280,720);
  assert.equal(result.atmosphere?.timeOfDay,'night');
  assert.equal(result.backgroundRef,'bg:room-stilt-house');
});
