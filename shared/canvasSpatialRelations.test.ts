import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasObject,createCanvasScene,createCanvasProject} from './canvasAnimationStudio';
import {compileCanvasSceneLayout,compileCanvasProjectLayout} from './canvasLayoutCompiler';
import {canvasUnderwaterInsert,canvasSpatialIssues,canvasContactRelease} from './canvasSpatialRelations';
import {evaluateCanvasObject} from '../src/canvasAnimationStudio/runtime';
import {evaluateAttachedProp,resolveCanvasLight} from '../src/canvasAnimationStudio/propAttachment';
import {canvasCharacterHand,resolveStageCharacterRig} from '../src/canvasAnimationStudio/characters/characterStaging';
import {applyCanvasChoreographyState} from '../src/canvasAnimationStudio/choreography';
import {canvasActingTiming} from '../src/canvasAnimationStudio/choreography';

test('standing beside a lamp never means holding it, and mounted lamps stay mounted',()=>{
  for(const designNotes of ['giữ nguyên vị trí cạnh cọc đèn','cầm một chiếc đèn dầu']){
    const scene=createCanvasScene();
    scene.objects=[createCanvasObject('character',{id:'lan',label:'Lan',designNotes}),
      createCanvasObject('prop',{id:'lamp',variant:'lantern',label:'cọc đèn dầu',designNotes:'Đèn gắn chặt trên đầu cọc gỗ.',heldBy:'lan'})];
    const compiled=compileCanvasSceneLayout(scene,1280,720);
    assert.equal(compiled.objects.find(o=>o.id==='lamp')?.heldBy,undefined);
  }
  const scene=createCanvasScene();
  scene.objects=[createCanvasObject('character',{id:'lan',label:'Lan',designNotes:'Giữ nguyên vị trí cạnh chiếc đèn.'}),createCanvasObject('prop',{id:'lamp',variant:'lantern'})];
  assert.equal(compileCanvasSceneLayout(scene,1280,720).objects.find(o=>o.id==='lamp')?.heldBy,undefined);
});

function ferryScene(){
  const scene=createCanvasScene();scene.template='two-shot';scene.background='night';scene.backgroundRef='bg:night-river-shoreline';
  scene.narration='Minh chèo thật chậm, còn Lan giữ chặt đầu dây. Họ buộc đèn vào mũi đò.';
  scene.objects=[
    createCanvasObject('ship',{id:'boat',assetRef:'ship:wooden-ferry',label:'con đò gỗ',sizeClass:'hero',slot:'center',keyframes:[{atMs:0,dx:-40},{atMs:5000,dx:80,rotation:2}]}),
    createCanvasObject('character',{id:'rower',characterKey:'minh',pose:'row',role:'focal',slot:'hero-right',keyframes:[{atMs:0,dx:90,dy:-15,scale:.95,pose:'row'}]}),
    createCanvasObject('character',{id:'passenger',characterKey:'lan',pose:'sit',role:'support',slot:'hero-left'}),
    createCanvasObject('prop',{id:'lamp',variant:'lantern',label:'đèn mũi đò',sizeClass:'large',slot:'hero-left'}),
    createCanvasObject('prop',{id:'oar',variant:'oar',label:'mái chèo gỗ',sizeClass:'large',slot:'hero-right'}),
    createCanvasObject('prop',{id:'rope',variant:'rope',label:'cuộn dây thừng',slot:'hero-left'}),
  ];
  scene.animationBeats=[{id:'row',action:'row',targetIds:['rower'],atMs:0,durationMs:3000},
    {id:'brace',action:'brace',targetIds:['passenger'],focusTargetId:'rope',atMs:0,durationMs:3000}];
  return scene;
}

test('full voyage shots retain missing passengers and bow equipment, but a morning insert breaks inheritance',()=>{
  const first=ferryScene(),second=ferryScene();first.id='first';second.id='second';
  second.camera={shot:'pov',motion:'none',focusX:640,focusY:360,zoom:1};
  second.objects=second.objects.filter(o=>!['passenger','lamp'].includes(o.id));
  const morning=createCanvasScene();morning.background='river';morning.narration='Sáng hôm sau';
  const project=createCanvasProject();project.scenes=[first,second,morning];
  const raw=structuredClone(project),compiled=compileCanvasProjectLayout(project);
  assert.equal(compiled.scenes[1]!.objects.filter(o=>o.characterKey==='lan').length,1);
  assert.equal(compiled.scenes[1]!.objects.filter(o=>o.variant==='lantern').length,1);
  assert.equal(compiled.scenes[2]!.objects.some(o=>o.characterKey==='lan'),false);
  assert.deepEqual(project,raw);assert.deepEqual(compileCanvasProjectLayout(compiled),compiled);
});

test('shore dialogue feet are on the visible foreground bank and sandals share the tree ground anchor',()=>{
  const scene=createCanvasScene();scene.template='two-shot';scene.background='river';scene.backgroundRef='bg:river-establishing';
  scene.visualBrief='Hai người đứng trên bờ đất. Đôi dép dưới gốc cây.';
  scene.objects=[createCanvasObject('character',{id:'a',slot:'hero-left'}),createCanvasObject('character',{id:'b',slot:'hero-right'}),
    createCanvasObject('prop',{id:'tree',variant:'tree',role:'support'}),createCanvasObject('prop',{id:'sandals',variant:'sandals'})];
  const compiled=compileCanvasSceneLayout(scene,1280,720);
  assert.equal(compiled.backgroundRef,'bg:river-shoreline');
  for(const actor of compiled.objects.filter(o=>o.kind==='character')){
    const fit=Math.min(actor.width/68,actor.height/100);
    assert.ok(actor.y+fit*60>=720*.93,'feet stay below bank boundary');
  }
  const tree=compiled.objects[2]!,sandals=compiled.objects[3]!;
  assert.ok(Math.abs(sandals.y-(tree.y+tree.height*.43))<720*.03);
  assert.ok(Math.abs(sandals.x-tree.x)<tree.width*.3);
  assert.deepEqual(compileCanvasSceneLayout(compiled,1280,720),compiled);
});

test('pickup and placement show contact, carry and release rather than relocating a prop before the action',()=>{
  for(const kind of ['pick-up','place'] as const){
    const scene=createCanvasScene();scene.template='two-shot';scene.background='river';scene.backgroundRef='bg:river-shoreline';
    scene.visualBrief='Minh đứng trên bờ đất.';
    scene.objects=[createCanvasObject('character',{id:'actor',facing:'left',keyframes:[{atMs:400,pose:'reach',rotation:4}]}),createCanvasObject('prop',{id:'sandals',variant:'sandals'})];
    scene.animationBeats=[{id:'handle',action:'reach',targetIds:['actor'],focusTargetId:'sandals',atMs:1000,durationMs:2000,
      speechCue:kind==='pick-up'?'Minh nhặt chúng lên.':'Anh đặt đôi dép lên mép đò.'}];
    const compiled=compileCanvasSceneLayout(scene,1280,720),prop=compiled.objects[1]!,actor=compiled.objects[0]!;
    assert.equal(prop.handling?.kind,kind);
    if(kind==='pick-up')assert.notEqual(applyCanvasChoreographyState(actor,compiled,500).pose,'reach','pre-TTS reach does not begin before the cue');
    const before=evaluateAttachedProp(prop,compiled,500),after=evaluateAttachedProp(prop,compiled,3300);
    const contactTime=kind==='pick-up'?2200:2300;
    const hand=canvasCharacterHand(applyCanvasChoreographyState(actor,compiled,contactTime),compiled,contactTime,false);
    const attached=evaluateAttachedProp(prop,compiled,contactTime);
    assert.ok(Math.hypot(hand.x-attached.x,hand.y-attached.y)<1e-7);
    if(kind==='pick-up'){
      const at=prop.handling!.atMs+prop.handling!.durationMs*.35;
      const contact=canvasCharacterHand(applyCanvasChoreographyState(actor,compiled,at),compiled,at,false);
      const ground=evaluateCanvasObject(prop,compiled,at);
      assert.ok(Math.hypot(contact.x-ground.x,contact.y-ground.y)<4,'hand reaches the ground before the object attaches');
      const {rig}=resolveStageCharacterRig(applyCanvasChoreographyState(actor,compiled,at),compiled,at,false);
      assert.ok(Math.min(rig.footL.y,rig.footR.y)>rig.pelvis.y,'low grip keeps the pelvis above the planted feet');
      assert.ok(rig.handL.y>=rig.pelvis.y,'free hand stays by the hip instead of folding up beside the neck during the squat');
    }
    if(kind==='pick-up'){assert.equal(before.x,prop.x);assert.ok(after.y<before.y-10);}
    else{assert.equal(after.x,prop.x);assert.equal(after.y,prop.y);}
  }
});

test('generated rowing scene attaches passengers, bow lantern and held equipment instead of independent slots',()=>{
  const raw=ferryScene(),snapshot=structuredClone(raw),scene=compileCanvasSceneLayout(raw,1280,720);
  const boat=scene.objects[0]!,rower=scene.objects[1]!,passenger=scene.objects[2]!,lamp=scene.objects[3]!;
  for(const actor of [rower,passenger]){
    assert.equal(actor.onBoat,boat.id);assert.ok(Math.abs(actor.x-boat.x)<boat.width*.25);
    assert.ok(actor.y<boat.y);assert.ok(actor.zIndex<boat.zIndex);
  }
  assert.notEqual(rower.x,passenger.x);assert.equal(lamp.onBoat,boat.id);
  assert.equal(scene.objects[4]!.heldBy,rower.id);assert.equal(scene.objects[5]!.heldBy,passenger.id);
  assert.ok(lamp.height<rower.height*.5);
  assert.deepEqual(raw,snapshot,'input remains intact');
  assert.deepEqual(compileCanvasSceneLayout(scene,1280,720),scene,'repeated preparation must not drift');
  for(const time of [0,1100,2800,5000]){
    const actor=evaluateCanvasObject(rower,scene,time),vessel=evaluateCanvasObject(boat,scene,time);
    assert.ok(Math.abs(actor.x-vessel.x)<boat.width*.3);
    const prop=evaluateAttachedProp(scene.objects[4]!,scene,time);
    const hand=canvasCharacterHand(applyCanvasChoreographyState(rower,scene,time),scene,time,false);
    assert.ok(Math.hypot(prop.x-hand.x,prop.y-hand.y)<1e-7);
    const otherHand=canvasCharacterHand(applyCanvasChoreographyState(rower,scene,time),scene,time,false,'L');
    const angle=prop.rotation*Math.PI/180,gripOffset=scene.objects[4]!.width*.28*prop.scale;
    assert.ok(Math.hypot(prop.x-gripOffset*Math.cos(angle)-otherHand.x,prop.y-gripOffset*Math.sin(angle)-otherHand.y)<1e-7,
      'second hand stays on the shaft throughout the stroke');
    const light=resolveCanvasLight({id:'light',type:'glow',sourceObjectId:lamp.id,x:0,y:0,scale:1},scene,time);
    assert.ok(Math.abs(light.x-evaluateAttachedProp(lamp,scene,time).x)<lamp.height*.1);
  }
});

test('background ferry and shore witness do not become passengers',()=>{
  const scene=ferryScene();scene.objects[0]!.depth='background';
  assert.equal(compileCanvasSceneLayout(scene,1280,720).objects[1]!.onBoat,undefined);
  const shore=ferryScene();shore.objects[2]!.designNotes='Lan đứng bên bờ quan sát con đò.';
  assert.equal(compileCanvasSceneLayout(shore,1280,720).objects[2]!.onBoat,undefined);
});

test('boat grab preserves river environment and spirit submersion; swimmer grip retains underwater insert',()=>{
  const scene=ferryScene();scene.narration='Một gương mặt tái nhợt nhô lên. Bàn tay lạnh bấu vào mạn đò.';
  scene.objects.push(createCanvasObject('character',{id:'ghost',appearance:'water-spirit',characterKey:'ghost'}));
  scene.animationBeats=[{id:'grab',action:'grab',targetIds:['ghost'],focusTargetId:'boat',atMs:600,durationMs:1800}];
  const compiled=compileCanvasSceneLayout(scene,1280,720),ghost=compiled.objects.at(-1)!;
  assert.equal(canvasUnderwaterInsert(compiled,1800),false);assert.ok(ghost.waterlineY!==undefined);
  assert.ok(ghost.y>compiled.objects[0]!.y,'spirit emerges alongside, not on the near bank');
  const swimmer=createCanvasObject('character',{id:'swimmer',waterlineY:400});compiled.objects.push(swimmer);
  compiled.animationBeats![0]!.focusTargetId=swimmer.id;
  assert.equal(canvasUnderwaterInsert(compiled,1800),true);
  assert.equal(canvasUnderwaterInsert(compiled,2500),false,'insert ends with the grip cue');
});

test('handheld lantern is fitted to actor anatomy and light stays on its flame',()=>{
  const scene=createCanvasScene();scene.template='two-shot';scene.background='room';
  scene.objects=[createCanvasObject('character',{id:'actor'}),createCanvasObject('prop',{id:'lamp',variant:'lantern',heldBy:'actor',sizeClass:'hero'})];
  const result=compileCanvasSceneLayout(scene,1280,720);
  assert.ok(result.objects[1]!.height<result.objects[0]!.height*.3);
});

test('inside-hull wording and seated design notes retain boarding in quiet shots',()=>{
  for(const words of ['Trong lòng đò đang chòng chành.','Mặt sông yên tĩnh.']){
    const scene=ferryScene();scene.narration='';scene.visualBrief=words;scene.animationBeats=[];
    for(const actor of scene.objects.filter(o=>o.kind==='character')){actor.pose='sit';actor.keyframes=undefined;actor.designNotes='Ngồi tĩnh lặng trên đò.';}
    const compiled=compileCanvasSceneLayout(scene,1280,720);
    assert.ok(compiled.objects.filter(o=>o.kind==='character').every(o=>o.onBoat==='boat'));
    assert.ok(compiled.objects[0]!.y>=720*.6,'vessel sits in water, not the distant bank');
  }
});

test('a distant lamp stays outside while carried lamp and rope use separate hands',()=>{
  const scene=createCanvasScene();scene.template='two-shot';scene.background='room';
  scene.objects=[createCanvasObject('character',{id:'actor',label:'Minh',characterKey:'minh',designNotes:'Minh cầm đèn bên tay trái.'}),
    createCanvasObject('prop',{id:'remote',variant:'lantern',label:'đèn ngoài bến',depth:'background',designNotes:'Ngọn đèn phía xa.'}),
    createCanvasObject('prop',{id:'lamp',variant:'lantern',label:'đèn bão'}),createCanvasObject('prop',{id:'rope',variant:'rope',heldBy:'actor'})];
  const result=compileCanvasSceneLayout(scene,1280,720),lamp=result.objects[2]!;
  assert.equal(result.objects[1]!.heldBy,undefined);assert.equal(lamp.heldBy,'actor');assert.equal(lamp.heldHand,'left');
  const prop=evaluateAttachedProp(lamp,result,1000),hand=canvasCharacterHand(result.objects[0]!,result,1000,false,'L');
  assert.ok(Math.abs(prop.x-hand.x)<1e-8);assert.ok(Math.abs(prop.y-lamp.height*.51*prop.scale-hand.y)<1e-8);
});

test('reaching a partner uses their near shoulder without stacking two torsos',()=>{
  const scene=createCanvasScene();scene.template='two-shot';scene.background='room';
  scene.objects=[createCanvasObject('character',{id:'a',slot:'hero-left',facing:'right'}),
    createCanvasObject('character',{id:'b',slot:'hero-right',facing:'left'})];
  scene.animationBeats=[{id:'reach',action:'reach',targetIds:['b'],focusTargetId:'a',atMs:0,durationMs:2000}];
  const result=compileCanvasSceneLayout(scene,1280,720),[a,b]=result.objects;
  assert.ok(b!.x-a!.x>Math.min(a!.width,b!.width)*.6);
  assert.deepEqual(compileCanvasSceneLayout(result,1280,720),result);
});

test('duplicate AI seat defaults are separated and dangling vessel references fail physical QC',()=>{
  const scene=ferryScene();for(const actor of scene.objects.filter(o=>o.kind==='character')){actor.onBoat='boat';actor.boatSeat=0;}
  const result=compileCanvasSceneLayout(scene,1280,720);
  assert.notEqual(result.objects[1]!.boatSeat,result.objects[2]!.boatSeat);
  assert.deepEqual(canvasSpatialIssues(result),[]);
  result.objects[1]!.onBoat='absent';
  assert.ok(canvasSpatialIssues(result).some(message=>message.includes('onBoat')));
});

test('an onboard rower continues the stroke after the spoken clause instead of freezing idle',()=>{
  const scene=ferryScene();scene.durationMs=8000;
  scene.objects[1]!.keyframes=[{atMs:0,pose:'row'},{atMs:4000,pose:'idle'}];
  const result=compileCanvasSceneLayout(scene,1280,720),actor=applyCanvasChoreographyState(result.objects[1]!,result,6000);
  assert.equal(actor.pose,'row');
  const timing=canvasActingTiming(actor,result,6000);assert.equal(timing.weight,1);assert.ok(timing.localMs>3000);
});


test('non-passenger contact survives a cut until an explicit sink, with remapped vessel identity',()=>{
  const first=ferryScene(),second=ferryScene(),third=ferryScene();
  first.id='contact-a';second.id='contact-b';third.id='contact-c';
  const visitor=createCanvasObject('character',{id:'visitor',characterKey:'visitor',appearance:'water-spirit',pose:'reach'});
  first.objects.push(visitor);
  first.animationBeats!.push({id:'grip',action:'grab',targetIds:['visitor'],focusTargetId:'boat',atMs:100,durationMs:1000});
  second.objects[0]!.id='new-boat';
  third.objects.push({...visitor,id:'visitor-third'});
  third.animationBeats!.push({id:'sink',action:'sink',targetIds:['visitor-third'],atMs:1000,durationMs:1000});
  const fourth=ferryScene();fourth.id='contact-d';
  const project=createCanvasProject();project.scenes=[first,second,third,fourth];
  const compiled=compileCanvasProjectLayout(project),middle=compiled.scenes[1]!;
  const restored=middle.objects.find(o=>o.characterKey==='visitor')!;
  assert.ok(restored,'a gripping non-passenger cannot disappear at the cut');
  assert.equal(middle.animationBeats!.find(b=>b.targetIds.includes(restored.id))!.focusTargetId,'new-boat');
  assert.equal(compiled.scenes[3]!.objects.some(o=>o.characterKey==='visitor'),false,'sinking ends continuity');
  assert.deepEqual(compileCanvasProjectLayout(compiled),compiled);
});


test('gripping a rotated vessel resolves contact in world space for mirrored, rotated and scaled actors',()=>{
  for(const facing of ['left','right'] as const){
    const boat=createCanvasObject('ship',{id:'rotated-vessel',x:500,y:400,width:200,height:60,rotation:18,scale:1.2,motion:'none'});
    const actor=createCanvasObject('character',{id:'gripper',x:facing==='right'?370:630,y:400,width:170,height:250,scale:1.15,rotation:facing==='right'?-10:10,facing,pose:'reach',lookAtId:boat.id,motion:'none'});
    const scene=createCanvasScene();scene.objects=[actor,boat];scene.animationBeats=[{id:'contact',action:'grab',targetIds:[actor.id],focusTargetId:boat.id,atMs:0,durationMs:2000}];
    const frame=evaluateCanvasObject(boat,scene,1000),angle=frame.rotation*Math.PI/180;
    const x=(facing==='right'?-1:1)*boat.width*.36,y=boat.height*.05;
    const expected={x:frame.x+(x*Math.cos(angle)-y*Math.sin(angle))*frame.scale,y:frame.y+(x*Math.sin(angle)+y*Math.cos(angle))*frame.scale};
    const hand=canvasCharacterHand(actor,scene,1000,false);
    assert.ok(Math.hypot(hand.x-expected.x,hand.y-expected.y)<.01,JSON.stringify({facing,hand,expected}));
  }
});


test('a warning to keep holding cannot become an actual release',()=>{
  assert.equal(canvasContactRelease({speechCue:'Do not let go of the boat.'}),false);
  assert.equal(canvasContactRelease({speechCue:'She let go of the boat.'}),true);
  const scene=ferryScene(),actor=scene.objects[1]!;
  scene.animationBeats=[{id:'hold',action:'grab',targetIds:[actor.id],focusTargetId:'boat',atMs:0,durationMs:500},
    {id:'warning',action:'talk',targetIds:[actor.id],speechCue:'Do not let go of the boat.',atMs:1000,durationMs:500}];
  assert.equal(applyCanvasChoreographyState(actor,scene,2000).lookAtId,'boat');
});
