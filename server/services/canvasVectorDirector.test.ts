import test from 'node:test';
import assert from 'node:assert/strict';
import {vectorPoint,vectorWorldMatrix} from '../../shared/canvasVectorTransform';
import {compileVectorProject} from '../../shared/canvasVectorScene';
import {vectorShotVisibility} from '../../shared/canvasVectorFraming';
import {vectorContinuityEvidence,selectVectorRepairScenes,vectorPlanCorrection} from './canvasVectorDirector';

test('drawing recovery requests only missing support metadata and preserves the locked art',()=>{
  const correction=vectorPlanCorrection(new Error('Vector: well needs a grounded anchor on the same surface; surface parent=illustrated-world, y=900'));
  assert.match(correction,/target:"well",anchor/);
  assert.match(correction,/all vectorAssets, existing scenery geometry and IDs/);
  assert.match(correction,/groundOffsetY/);
  assert.match(correction,/y=900/);
  assert.doesNotMatch(vectorPlanCorrection(new Error('Vector: invalid paint')),/LOCAL_BASE/);
  const travel=vectorPlanCorrection(new Error('Vector: invalid puppet travel person to well: gap=80, dx=-55'));
  assert.match(travel,/changing vectorScene.walks.gap will be ignored/);
  assert.match(travel,/ONLY the initial x\/y placement of the destination well/);
  assert.match(travel,/Keep the destination outline, scale, asset and identity unchanged/);
});

test('native stage retains story-object support metadata without changing assets or authored geometry',()=>{
  const raw={vectorAssets:{hero:{rig:'simple-puppet',finish:'handdrawn'}},
    vectorStages:{village:{template:'illustrated-place',place:'village',view:'elevated',finish:'handdrawn',cast:{person:'hero'},
      nodes:[{id:'well',type:'group',x:650,y:820,groundOffsetY:-32,children:[{id:'well-base',type:'ellipse',y:30,rx:70,ry:18,fill:'#654'}]}],
      ground:{targets:[{target:'well',anchor:{x:0,y:48}}]}}},
    scenes:[{durationMs:4000,narration:'He approaches the well.',vectorScene:{stage:'village',walks:[{actor:'person',to:'well',gap:80,followDepth:true}]}}]};
  const before=structuredClone(raw),p=parseVectorPlan(JSON.stringify(raw),'village',{width:1280,height:720});
  const well=p.vectorStages!.village!.nodes.find(n=>n.id==='well')!;
  assert.equal(well.x,650);assert.equal(well.y,820);
  assert.deepEqual(well.groundAnchor,{x:0,y:48});
  assert.equal(p.scenes[0]!.vectorScene!.ground!.parent,'illustrated-world');
  assert.ok(p.scenes[0]!.vectorScene!.tracks.some(t=>t.target==='person'&&t.frames.some(f=>f.dx)));
  assert.deepEqual(raw,before);
  const baseline=structuredClone(raw);delete (baseline.vectorStages.village as {ground?:unknown}).ground;
  delete (baseline.vectorStages.village.nodes[0] as {groundOffsetY?:number}).groundOffsetY;
  baseline.scenes[0]!.vectorScene.walks=[];
  const untouched=parseVectorPlan(JSON.stringify(baseline),'village',{width:1280,height:720});
  assert.deepEqual(p.vectorAssets,untouched.vectorAssets,'ground metadata cannot redesign cast or props');
  assert.throws(()=>parseVectorPlan(JSON.stringify({...raw,vectorStages:{village:{...raw.vectorStages.village,ground:{y:300,targets:[]}}}}),'village',{width:1280,height:720}),/existing surface/);
});

test('shot ground targets inherit the reusable surface parent rather than losing the world transform',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{hero:{rig:'simple-puppet'}},vectorStages:{room:{width:1280,height:720,
    nodes:[{id:'world',type:'group'},{id:'person',type:'instance',asset:'hero',parent:'world',x:50,width:100,height:200},
      {id:'door',type:'rect',parent:'world',x:400,y:300,width:60,height:300}],ground:{y:600,parent:'world',targets:[{target:'person'}]}}},
    scenes:[{durationMs:4000,narration:'He walks to the door.',vectorScene:{stage:'room',ground:{targets:[{target:'door'}]},walks:[{actor:'person',to:'door',gap:80}]}}]}),'walk',{width:1280,height:720});
  assert.equal(p.scenes[0]!.vectorScene!.ground!.parent,'world');
  assert.deepEqual(p.scenes[0]!.vectorScene!.nodes.find(n=>n.id==='door')!.groundAnchor,{x:30,y:300});
});

test('center-origin story objects frame from explicit bounds instead of treating their base anchor as zero width',()=>{
  const raw={vectorAssets:{hero:{rig:'simple-puppet',finish:'handdrawn'}},vectorStages:{village:{template:'illustrated-place',place:'village',view:'elevated',finish:'handdrawn',cast:{person:'hero'},
    nodes:[{id:'well',type:'group',x:540,y:820,groundAnchor:{x:0,y:48},groundOffsetY:-32,bounds:{x:-90,y:-90,width:180,height:138},
      children:[{id:'well-base',type:'ellipse',x:0,y:30,rx:70,ry:18,fill:'#654'}]}]}},
    scenes:[{durationMs:4000,narration:'He looks into the well.',vectorScene:{stage:'village',shot:{target:'person',height:.3,include:['well']}}}]};
  const before=structuredClone(raw),p=parseVectorPlan(JSON.stringify(raw),'village',{width:1280,height:720}),s=p.scenes[0]!;
  const well=s.vectorScene!.nodes.find(n=>n.id==='well')!;
  assert.equal(well.x,540);assert.equal(well.y,820);
  assert.deepEqual(well.bounds,raw.vectorStages.village.nodes[0]!.bounds);
  assert.deepEqual(well.groundAnchor,{x:0,y:48});
  const coverage=vectorShotVisibility(s,p.vectorAssets!,'well',0);
  assert.ok('widthFraction' in coverage&&coverage.widthFraction!>0);
  assert.deepEqual(compileVectorProject(p),p);
  assert.deepEqual(raw,before);
  const broken=structuredClone(raw);delete (broken.vectorStages.village.nodes[0] as {bounds?:unknown}).bounds;
  assert.throws(()=>parseVectorPlan(JSON.stringify(broken),'village',{width:1280,height:720}),/shot context well needs finite local bounds/);
});

test('partial instance-part paint repair keeps source assets and unrelated shots immutable and replays idempotently',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{lamp:{rig:'lantern'},hero:{rig:'simple-puppet'}},scenes:[1,2].map(()=>({durationMs:3000,narration:'The lamp glows.',vectorScene:{width:1280,height:720,nodes:[
    {id:'lamp',type:'instance',asset:'lamp',x:400,y:300,width:60,height:100},{id:'person',type:'instance',asset:'hero',x:500,y:300,width:100,height:200}],tracks:[]}}))}),'lamp',{width:1280,height:720});
  const before=structuredClone(p),s=p.scenes[0]!,allowed=new Set([s.id]);
  const patch=JSON.stringify({scenes:[{id:s.id,vectorScenePatch:{nodes:[{id:'lamp/case',fill:'#5a6155',stroke:'#b89d68'},{id:'lamp/glass',fill:'#ffb943'}]}}]});
  const repaired=applyVectorRepairs(p,patch,allowed),view=repaired.scenes[0]!.vectorScene!.nodes.find(n=>n.id==='lamp')!.asset!;
  assert.notEqual(view,'lamp');assert.equal(repaired.vectorAssets![view]!.nodes.find(n=>n.id==='case')!.fill,'#5a6155');
  assert.deepEqual(repaired.vectorAssets!.lamp,before.vectorAssets!.lamp);
  assert.deepEqual(repaired.vectorAssets!.hero,before.vectorAssets!.hero);
  const {vectorAssetLibrary:beforeLibrary,...untouched}=before.scenes[1]!;
  const {vectorAssetLibrary:afterLibrary,...after}=repaired.scenes[1]!;
  assert.deepEqual(after,untouched);assert.deepEqual(afterLibrary!.lamp,beforeLibrary!.lamp);assert.deepEqual(p,before);
  assert.deepEqual(applyVectorRepairs(repaired,patch,allowed),repaired);
  assert.throws(()=>applyVectorRepairs(p,JSON.stringify({scenes:[{id:s.id,vectorScenePatch:{nodes:[{id:'person/face',fill:'#fff'}]}}]}),allowed),/preserve cast/);
  assert.throws(()=>applyVectorRepairs(p,JSON.stringify({scenes:[{id:s.id,vectorScenePatch:{nodes:[{id:'lamp/missing',fill:'#fff'}]}}]}),allowed),/unknown instance part/);
});

test('a cached multi-shot repair can replay only the remaining failed shot',()=>{
  const patch={newAssets:{},scenes:[{id:'approved',vectorScenePatch:{removeNodes:['tree']}},{id:'failed',vectorScenePatch:{shot:{target:'person',height:.38}}}]};
  const selected=JSON.parse(selectVectorRepairScenes(JSON.stringify(patch),new Set(['failed'])));
  assert.deepEqual(selected.scenes,[patch.scenes[1]]);
  assert.deepEqual(patch.scenes.length,2);
});

test('reaction framing crops distant reusable architecture instead of shrinking the person',()=>{
  const raw={vectorAssets:{hero:{rig:'simple-puppet',design:'village',finish:'handdrawn'},stall:{width:140,height:120,nodes:[{id:'counter',type:'rect',width:140,height:120,fill:'#715436'}]}},
    vectorStages:{village:{template:'illustrated-place',place:'village',setting:'market',view:'elevated',finish:'handdrawn',cast:{person:'hero'}}},
    scenes:[{durationMs:4000,narration:'He turns to the empty stall.',vectorScene:{stage:'village',nodes:[{id:'empty-stall',type:'instance',asset:'stall',parent:'illustrated-world',x:40,y:600,width:140,height:120}]}}]};
  const p=parseVectorPlan(JSON.stringify(raw),'market',{width:1280,height:720}),s=p.scenes[0]!;
  const repaired=applyVectorRepairs(p,JSON.stringify({scenes:[{id:s.id,vectorScenePatch:{shot:{target:'person',height:.38,include:['empty-stall']}}}]}),new Set([s.id]));
  const n=s.vectorScene!.nodes.find(n=>n.id==='person')!,m=vectorWorldMatrix('person',repaired.scenes[0]!,0,repaired.vectorAssets);
  assert.ok(Math.abs(m.d)*repaired.vectorAssets!.hero!.height/720>.28,'the reaction actor stays readable despite a distant building asset');
  assert.deepEqual(repaired.scenes[0]!.vectorScene!.nodes.find(x=>x.id==='empty-stall'),s.vectorScene!.nodes.find(x=>x.id==='empty-stall'),'the actual world geometry is retained');
});

test('review distinguishes a fixed camera cut from actor teleporting or losing its facing',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{hero:{rig:'simple-puppet',design:'village',finish:'handdrawn'}},
    vectorStages:{village:{template:'illustrated-place',place:'village',finish:'handdrawn',cast:{person:'hero'}}},
    scenes:[1,1.5].map(zoom=>({durationMs:3000,narration:'The traveler waits.',vectorScene:{stage:'village',camera:[{t:0,x:640,y:360,zoom}],turns:[{actor:'person',to:'left',hold:true}]}}))}),'village',{width:1280,height:720});
  const evidence=vectorContinuityEvidence(p.scenes[1]!,p),actor=evidence.actors!.find(a=>a.actor==='person')!;
  assert.equal(evidence.sameStage,true);
  assert.deepEqual(actor.previousEnd,actor.currentStart);
  assert.equal(actor.currentStart!.facingScaleX,-1);
  assert.notDeepEqual(vectorWorldMatrix('person',p.scenes[0]!,3000,p.vectorAssets),vectorWorldMatrix('person',p.scenes[1]!,0,p.vectorAssets),'the screen placement changes with the camera');
  assert.ok(JSON.stringify(buildVectorReviewContent(p,[],'village').content).includes('actorContinuity'));
});

test('native scene refinement resolves retained extra cast before validating its stage',()=>{
  const stage={template:'illustrated-place',place:'village',finish:'handdrawn',view:'elevated',cast:{person:'hero'},
    extras:[{id:'elder',asset:'elder-model',x:480,footY:750,height:65}]};
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{hero:{rig:'simple-puppet',design:'village'},'elder-model':{rig:'simple-puppet',design:'village',hair:'short',outfit:'robe'}},
    vectorStages:{village:stage},scenes:[{durationMs:3000,narration:'A guard sees an elder.',vectorScene:{stage:'village'}}]}),'night',{width:1280,height:720});
  p.scenes[0]!.audioUrl='/retained.wav';
  for(const vectorAssets of [{},{'elder-model':{reuse:'approved model'}}]){
    const next=applyVectorRedesign(p,JSON.stringify({vectorAssets,vectorStages:{village:stage},scenes:[{id:p.scenes[0]!.id,vectorScene:{stage:'village'}}]}));
    assert.deepEqual(next.vectorAssets!['elder-model'],p.vectorAssets!['elder-model']);
    assert.equal(next.scenes[0]!.audioUrl,'/retained.wav');
    assert.equal(next.scenes[0]!.vectorScene!.nodes.find(n=>n.id==='elder')!.asset,'elder-model');
  }
  const redundant={...stage,cast:{...stage.cast,elder:'elder-model'}};
  const replay=applyVectorRedesign(p,JSON.stringify({vectorAssets:{},vectorStages:{village:redundant},scenes:[{id:p.scenes[0]!.id,vectorScene:{stage:'village'}}]}));
  assert.equal(replay.scenes[0]!.vectorScene!.nodes.filter(n=>n.id==='elder').length,1,'a redundant declared binding must not duplicate the extra');
  assert.throws(()=>applyVectorRedesign(p,JSON.stringify({vectorAssets:{},vectorStages:{village:{...stage,cast:{...stage.cast,stranger:'elder-model'}}},
    scenes:[{id:p.scenes[0]!.id,vectorScene:{stage:'village'}}]})),/invalid stage cast slots/);
  assert.throws(()=>applyVectorRedesign(p,JSON.stringify({vectorAssets:{},vectorStages:{village:{...stage,extras:[{...stage.extras[0],asset:'unknown-model'}]}},
    scenes:[{id:p.scenes[0]!.id,vectorScene:{stage:'village'}}]})),/existing compact cast/,'unapproved missing models are still rejected');
});

test('a cached repair with one premature root brace recovers without inventing truncated scenes',()=>{
  const p=parseVectorPlan(JSON.stringify({scenes:[{durationMs:4000,narration:'The sky changes.',vectorScene:{width:720,height:1280,nodes:[{id:'sky',type:'rect',width:720,height:1280,fill:'#333333'}]}}]}),'test',{width:720,height:1280});
  const s=p.scenes[0]!,valid=JSON.stringify({newAssets:{},scenes:[{id:s.id,vectorScenePatch:{nodes:[{id:'sky',fill:'#445566'}]}}]});
  const observed=valid.replace(',"scenes"','},"scenes"');
  const repaired=applyVectorRepairs(p,observed,new Set([s.id]));
  assert.equal(repaired.scenes[0]!.vectorScene!.nodes.find(n=>n.id==='sky')!.fill,'#445566');
  assert.equal(repaired.scenes[0]!.narration,s.narration);
  assert.equal(repaired.scenes[0]!.durationMs,s.durationMs);
  assert.throws(()=>applyVectorRepairs(p,observed.slice(0,-3),new Set([s.id])),/omitted|JSON|complete/);
});

test('a repair that both updates and removes one node lands with removal winning',()=>{
  const p=parseVectorPlan(JSON.stringify({scenes:[{durationMs:4000,narration:'The sky changes.',vectorScene:{width:720,height:1280,nodes:[{id:'sky',type:'rect',width:720,height:1280,fill:'#333333'},{id:'glow',type:'ellipse',x:100,y:100,rx:20,ry:20,fill:'#ffcc00'}]}}]}),'test',{width:720,height:1280});
  const s=p.scenes[0]!;
  const patch=JSON.stringify({newAssets:{},scenes:[{id:s.id,vectorScenePatch:{nodes:[{id:'glow',opacity:0.5}],removeNodes:['glow']}}]});
  const repaired=applyVectorRepairs(p,patch,new Set([s.id]));
  assert.equal(repaired.scenes[0]!.vectorScene!.nodes.some(n=>n.id==='glow'),false,'removal wins over the stale update');
  assert.ok(repaired.scenes[0]!.vectorScene!.nodes.some(n=>n.id==='sky'),'unrelated geometry survives');
  const dup=JSON.stringify({newAssets:{},scenes:[{id:s.id,vectorScenePatch:{nodes:[{id:'sky',fill:'#111111'},{id:'sky',fill:'#222222'}]}}]});
  assert.throws(()=>applyVectorRepairs(p,dup,new Set([s.id])),/duplicate patched node/,'true duplicates still fail');
});

test('an exact static support copy keeps its context ID without painting over the cast',()=>{
  const road={id:'road',type:'path',d:'M 0 600 L 720 600 L 720 800 L 0 800 Z',fill:'#665544',stroke:'#222222',strokeWidth:2};
  const p=parseVectorPlan(JSON.stringify({vectorAssets:assets,scenes:[{durationMs:4000,narration:'The villager waits.',vectorScene:{...drawing,nodes:[road,...drawing.nodes]}}]}),'test',{width:720,height:1280});
  const s=p.scenes[0]!,existing=s.vectorScene!.nodes.find(n=>n.id==='road')!;
  p.vectorReview={pass:false,rounds:1,previewDirectory:'old',issues:[{sceneId:s.id,problem:'old picture',fix:'old'}]};
  const patch=JSON.stringify({newAssets:{},scenes:[{id:s.id,vectorScenePatch:{nodes:[{...existing,id:'roads'}]}}]});
  const repaired=applyVectorRepairs(p,patch,new Set([s.id]));
  assert.equal(repaired.scenes[0]!.vectorScene!.nodes.find(n=>n.id==='roads')!.type,'group');
  assert.deepEqual(repaired.scenes[0]!.vectorScene!.nodes.find(n=>n.id==='road'),existing);
  assert.equal(repaired.vectorReview,undefined,'old complaints describe different pixels');
  assert.deepEqual(applyVectorRepairs(repaired,patch,new Set([s.id])),repaired,'cached alias repair is idempotent');
  const moving=JSON.stringify({scenes:[{id:s.id,vectorScenePatch:{nodes:[{...existing,id:'moving-road'}],tracks:[{target:'moving-road',start:0,end:1,frames:[{t:0,dx:0},{t:1,dx:30}]}]}}]});
  assert.equal(applyVectorRepairs(p,moving,new Set([s.id])).scenes[0]!.vectorScene!.nodes.find(n=>n.id==='moving-road')!.type,'path','moving copies are deliberate artwork');
});

test('scene refinement reuses the exact approved puppet despite omitted or simplified model parts',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{hero:{rig:'simple-puppet',outfit:'robe',hair:'short'}},scenes:[{durationMs:3000,narration:'Listen.',
    vectorScene:{width:720,height:1280,nodes:[{id:'person',type:'instance',asset:'hero',x:250,y:600}],tracks:[]}}]}),'night',{width:720,height:1280});
  const approved=p.vectorAssets!.hero!,partial=structuredClone(approved);
  partial.nodes=partial.nodes.filter(n=>n.id!=='robe-fold').map(n=>{
    const {stroke,strokeWidth,pivotX,pivotY,pivotSpace,scaleX,scaleY,...rest}=n;
    return n.id==='face'?{...rest,fill:'#e0c0a0'}:rest;
  });
  const next=applyVectorRedesign(p,JSON.stringify({vectorAssets:{hero:partial},scenes:[{id:p.scenes[0]!.id,vectorScene:p.scenes[0]!.vectorScene}]}));
  const node=(id:string)=>next.vectorAssets!.hero!.nodes.find(n=>n.id===id)!;
  assert.equal(node('head-group').scaleX,approved.nodes.find(n=>n.id==='head-group')!.scaleX);
  assert.equal(node('costume').scaleY,approved.nodes.find(n=>n.id==='costume')!.scaleY);
  assert.equal(node('upper-body').pivotY,approved.nodes.find(n=>n.id==='upper-body')!.pivotY);
  assert.equal(node('face').stroke,approved.nodes.find(n=>n.id==='face')!.stroke);
  assert.equal(node('face').strokeWidth,approved.nodes.find(n=>n.id==='face')!.strokeWidth);
  assert.deepEqual(next.vectorAssets!.hero,approved,'staging refinement must not redraw the approved cast');
  assert.ok(node('robe-fold'),'unmentioned clothing parts remain in their original layer');
  assert.deepEqual(compileVectorProject(next),next);
});

test('native doors reveal an aperture and carry their hardware; an indoor bolt starts retracted and locks visibly',()=>{
  for(const size of [{width:1280,height:720},{width:720,height:1280}]){
    const yard=parseVectorPlan(JSON.stringify({vectorStages:{yard:{template:'folk-courtyard'}},scenes:[{durationMs:3000,narration:'The door opens.',
      vectorScene:{stage:'yard',hinges:[{target:'door',open:true,start:0,end:.8}]}}]}),'night',size);
    const s=yard.scenes[0]!,d=s.vectorScene!;
    assert.equal(d.nodes.find(n=>n.id==='ring')!.parent,'door');
    const opening=d.nodes.find(n=>n.id==='door-opening')!;
    assert.notEqual(opening.parent,'door','aperture does not shrink with the leaf');
    assert.ok(d.nodes.indexOf(opening)<d.nodes.findIndex(n=>n.id==='door'));
    for(const t of [0,1200,3000]){
      const ring=vectorPoint(vectorWorldMatrix('ring',s,t,yard.vectorAssets),0,0);
      const leaf=vectorPoint(vectorWorldMatrix('door',s,t,yard.vectorAssets),30,210);
      assert.ok(Math.hypot(ring.x-leaf.x,ring.y-leaf.y)<1e-6,'knocker follows the opening leaf');
    }
    const room=parseVectorPlan(JSON.stringify({vectorStages:{room:{template:'folk-room'}},scenes:[{durationMs:3000,narration:'The bolt locks.',
      vectorScene:{stage:'room',tracks:[{target:'latch',start:.3,end:.7,frames:[{t:0,dx:0},{t:1,dx:48}]}]}}]}),'night',size);
    const r=room.scenes[0]!,bar=r.vectorScene!.nodes.find(n=>n.id==='latch-bar')!;
    assert.equal(r.vectorScene!.nodes.find(n=>n.id==='latch-brackets')!.parent,'door','guides do not slide with the bolt');
    const boltEnd=(t:number)=>vectorPoint(vectorWorldMatrix('latch-bar',r,t,room.vectorAssets),bar.width!,0).x;
    const seam=vectorPoint(vectorWorldMatrix('door',r,0,room.vectorAssets),68,194).x;
    assert.ok(boltEnd(0)<seam,'retracted bolt leaves the door seam clear');
    assert.ok(boltEnd(3000)>seam,'engaged bolt crosses the seam');
    assert.deepEqual(compileVectorProject(room),room);
  }
});

test('native room uses a complete interior and uniform landscape contact coordinates',()=>{
  for(const size of [{width:1280,height:720},{width:720,height:1280}]){
    const p=parseVectorPlan(JSON.stringify({vectorStages:{room:{template:'folk-room'}},scenes:[{durationMs:4000,narration:'She touches the latch.',
      vectorScene:{stage:'room',walks:[{actor:'person',to:'door',gap:150,hold:true}],
        reaches:[{actor:'person',arm:'r',target:'latch',point:{x:45,y:12},start:0,end:.5,hold:true}]}}]}),'night',size);
    const s=p.scenes[0]!,d=s.vectorScene!;
    for(const id of ['room-wall','room-floor','window','table','bed','door','latch','lamp'])assert.ok(d.nodes.some(n=>n.id===id),id);
    assert.ok(!d.nodes.some(n=>n.id==='sky'||n.id==='tree'||n.id==='house'));
    const world=d.nodes.find(n=>n.id==='room-world');if(world)assert.equal(world.scaleX,world.scaleY);
    const hand=vectorPoint(vectorWorldMatrix('person/hand-r',s,3999,p.vectorAssets),0,0);
    const latch=vectorPoint(vectorWorldMatrix('latch',s,3999,p.vectorAssets),45,12);
    assert.ok(Math.hypot(hand.x-latch.x,hand.y-latch.y)<1e-6);
    assert.deepEqual(compileVectorProject(p),p);
  }
});

test('screenplay shot sizes produce distinct fixed views of the same set without resetting action',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorStages:{yard:{template:'folk-courtyard'}},scenes:['wide','action','detail','reaction'].map(size=>({durationMs:4000,narration:'She sees the ring.',vectorScene:{stage:'yard',walks:[{actor:'person',to:'door',gap:150,hold:true}]}}))}),'night',{width:1280,height:720});
  for(const [i,size]of ['wide','action','detail','reaction'].entries())p.scenes[i]!.vectorDirection={purpose:'Read this beat',location:'yard',shot:{size:size as 'wide'|'action'|'detail'|'reaction',focus:size==='detail'?'ring':'person',include:['ring'],...(size==='reaction'?{framing:'close' as const}:{})},beats:[{cue:'She sees the ring.',kind:'hold',targets:['person','ring'],motionTargets:[],before:'near the door',after:'still near the door'}]};
  const baseline=structuredClone(p);for(const s of baseline.scenes)s.vectorFramingVersion=1;
  const before=compileVectorProject(baseline);
  const framed=compileVectorProject(p),zooms=framed.scenes.map(s=>evaluateVectorPart('camera-world',s,0).scaleX);
  assert.equal(zooms[0],1);assert.ok(zooms[1]!>=1);assert.ok(zooms[2]!>zooms[1]!);assert.ok(zooms[3]!>zooms[1]!);
  for(const [i,s]of framed.scenes.entries()){
    const scenery=(nodes:NonNullable<typeof s.vectorScene>['nodes'])=>nodes.filter(n=>!n.id.startsWith('camera-world')).map(n=>({...n,parent:n.parent?.startsWith('camera-world')?undefined:n.parent}));
    assert.deepEqual(scenery(s.vectorScene!.nodes),scenery(before.scenes[i]!.vectorScene!.nodes),'framing must not redraw or relocate the set');
    assert.deepEqual(s.vectorScene!.tracks.filter(t=>!t.target.startsWith('camera-world')),before.scenes[i]!.vectorScene!.tracks.filter(t=>!t.target.startsWith('camera-world')));
    assert.deepEqual(evaluateVectorPart('camera-world',s,0),evaluateVectorPart('camera-world',s,3999),'cuts start at their final framing');
  }
  const face=framed.scenes[3]!,top=vectorPoint(vectorWorldMatrix('person/head-group',face,0,framed.vectorAssets),0,-90);
  assert.ok(top.y>720*.19,'reaction face stays below captions');
  assert.deepEqual(compileVectorProject(framed),framed,'framing is idempotent');
  const s=framed.scenes[3]!,repaired=applyVectorRepairs(framed,JSON.stringify({scenes:[{id:s.id,vectorScenePatch:{shot:{target:'person',height:.4}}}]}),new Set([s.id]));
  assert.ok(evaluateVectorPart('camera-world',repaired.scenes[3]!,0).scaleX<zooms[3]!,'an explicit later repair wins');
});

test('landscape courtyard keeps round characters and exact hand contact in a uniform world',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorStages:{yard:{template:'folk-courtyard'}},scenes:[
    {durationMs:4000,narration:'She taps.',vectorScene:{stage:'yard',shot:{target:'person',height:.5,include:['stone-path']},walks:[{actor:'person',to:'door',gap:150,hold:true}],strikes:[{actor:'person',arm:'r',target:'ring',point:{x:20,y:31},start:0,end:1}]}},
    {durationMs:4000,narration:'She looks at the lamp.',vectorScene:{stage:'yard',reactions:[{actor:'person',kind:'look',toward:'lamp',start:.6,end:.9}]}},
  ]}),'night',{width:1280,height:720});
  const s=p.scenes[0]!,d=s.vectorScene!;
  assert.equal(d.width,1280);assert.equal(d.height,720);
  const world=d.nodes.find(n=>n.id==='courtyard-world')!;
  assert.equal(world.scaleX,world.scaleY);
  assert.equal(d.ground!.parent,'courtyard-world');
  const hand=vectorPoint(vectorWorldMatrix('person/hand-r',s,1520,p.vectorAssets),0,0);
  const ring=vectorPoint(vectorWorldMatrix('ring',s,1520,p.vectorAssets),20,31);
  assert.ok(Math.hypot(hand.x-ring.x,hand.y-ring.y)<1e-7);
  assert.ok(hand.x>0&&hand.x<1280&&hand.y>0&&hand.y<720);
});

test('native courtyard keeps a readable complete set and exact dot-hand knocker contact across cuts',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{woman:{rig:'simple-puppet',outfit:'ao-dai',hair:'bun'}},vectorStages:{yard:{template:'folk-courtyard',cast:{person:'woman'}}},scenes:[
    {durationMs:4000,narration:'She approaches the door.',vectorScene:{stage:'yard',shot:{target:'person',height:.5,include:['door','ring']},walks:[{actor:'person',to:'door',gap:150,start:0,end:.6}]}},
    {durationMs:4000,narration:'She taps the ring.',vectorScene:{stage:'yard',shot:{target:'person',height:.5,include:['door','ring']},walks:[{actor:'person',to:'door',gap:150,hold:true}],strikes:[{actor:'person',arm:'r',target:'ring',point:{x:20,y:31},start:0,end:1}]}},
  ]}),'night horror',{width:720,height:1280});
  assert.equal(p.vectorAssets!.woman!.nodes.some(n=>/^(arm|leg|forearm)-/.test(n.id)),false);
  for(const s of p.scenes)for(const id of ['tree','house','door','ring','lamp','stone-path'])assert.ok(s.vectorScene!.nodes.some(n=>n.id===id),id);
  const at=1520,s=p.scenes[1]!;
  const hand=vectorPoint(vectorWorldMatrix('person/hand-r',s,at,p.vectorAssets),0,0);
  const ring=vectorPoint(vectorWorldMatrix('ring',s,at,p.vectorAssets),20,31);
  assert.ok(Math.hypot(hand.x-ring.x,hand.y-ring.y)<1e-7);
  assert.equal(evaluateVectorPart('person',s,at).dx,79);
  assert.equal(p.scenes[0]!.vectorScene!.nodes.find(n=>n.id==='physical-ground-plane')!.fill,'#9b896c');
});

test('a native tap preserves the later self-moving ring beat through normalization and repair replay',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorStages:{yard:{template:'folk-courtyard'}},scenes:[{
    durationMs:6000,narration:'Tap. Then the ring moves.',vectorScene:{stage:'yard',
      walks:[{actor:'person',to:'door',gap:150,hold:true}],
      strikes:[{actor:'person',arm:'r',target:'ring',point:{x:20,y:31},start:0,end:.3,cue:'Tap.'}],
      tracks:[{target:'ring',start:.55,end:.95,cue:'Then the ring moves.',frames:[{t:0,rotation:0},{t:.5,rotation:24},{t:1,rotation:0}]}]},
  }]}),'night',{width:720,height:1280});
  const s=p.scenes[0]!;
  assert.equal(s.vectorScene!.tracks.filter(t=>t.target==='ring').length,2);
  assert.ok(Math.abs(evaluateVectorPart('ring',s,4500).rotation)>20);
  const patch={scenes:[{id:s.id,vectorScenePatch:{strikes:[{actor:'person',arm:'r',target:'ring',point:{x:20,y:31},start:0,end:.3,cue:'Tap.'}]}}]};
  const replay=applyVectorRepairs(p,JSON.stringify(patch),new Set([s.id]));
  assert.ok(Math.abs(evaluateVectorPart('ring',replay.scenes[0]!,4500).rotation)>20);
  const content=JSON.parse(String(buildVectorReviewContent(replay,[],'night').content[0]!.text));
  assert.equal(content.scenes[0].framingEvidence[0].rig,'simple-puppet');
  assert.ok(content.scenes[0].motionEvidence.parts.find((t:{target:string})=>t.target==='ring').changes.rotation[1]>=24);
});
import {evaluateVectorPart} from '../../shared/canvasVectorScene';
import {evaluateCanvasVisualQuality} from '../../shared/canvasVisualQuality';
import {parseVectorPlan,applyVectorRepairs,parseVectorReview,buildVectorRepairContent,applyVectorRedesign,normalizeVectorReferenceImages,buildVectorReviewContent,vectorMotionEvidence,vectorPhysicalEvidence} from './canvasVectorDirector';
const assets={dog:{width:100,height:100,nodes:[{id:'head',type:'group',x:50,y:20},{id:'jaw',type:'ellipse',parent:'head',rx:20,ry:4,fill:'#fff'}]}};
const drawing={width:720,height:1280,nodes:[{id:'sky',type:'rect',width:720,height:1280,fill:'#111'},{id:'dog',type:'instance',asset:'dog',x:100,y:600,width:300,height:300}],
  tracks:[{target:'dog/head',start:.2,end:.6,frames:[{t:0,rotation:0},{t:1,rotation:-30}]}]};

test('reattaching a floating lamp clears its old parent/travel, retains the narrated lighting cue and restores an accidentally invisible arm',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{human:{rig:'simple-human'},lamp:{rig:'lantern'}},scenes:[{durationMs:8000,narration:'Light the lamp.',vectorScene:{width:720,height:1280,
    nodes:[{id:'person',type:'instance',asset:'human',x:220,y:500,width:180,height:360},{id:'lamp',type:'instance',asset:'lamp',x:350,y:600,width:60,height:100}],
    camera:[{t:0,x:360,y:640,zoom:1}],tracks:[{target:'lamp',start:.2,end:.6,cue:'Light',frames:[{t:0,opacity:0,dx:20},{t:1,opacity:1,dx:50}]},
      {target:'person/arm-r',start:.2,end:.6,cue:'Light',frames:[{t:0,opacity:0},{t:1,opacity:1}]}]}}]}),'test',{width:720,height:1280});
  const before=structuredClone(p),s=p.scenes[0]!;
  const patch=JSON.stringify({scenes:[{id:s.id,vectorScenePatch:{nodes:[{id:'lamp',attachTo:'person/hand-r',hang:true,x:-30,y:0}],removeTracks:['lamp'],
    vectorBeats:[{cue:'Light',targets:['lamp']}],tracks:[{target:'person/arm-r',start:0,end:1,frames:[{t:0,opacity:1}]}]}}]});
  const after=applyVectorRepairs(p,patch,new Set([s.id])),out=after.scenes[0]!,lamp=out.vectorScene!.nodes.find(n=>n.id==='lamp')!;
  assert.equal(lamp.parent,undefined);assert.equal(lamp.attachTo,'person/hand-r');
  assert.equal(evaluateVectorPart('lamp',out,0).opacity,0);assert.equal(evaluateVectorPart('lamp',out,7999).opacity,1);
  assert.equal(evaluateVectorPart('lamp',out,7999).dx,0,'obsolete stage coordinates cannot travel with the hand');
  assert.equal(evaluateVectorPart('person/arm-r',out,0).opacity,1);
  assert.deepEqual(out.vectorBeats,[{cue:'Light',targets:['lamp']}]);assert.deepEqual(p,before);
  assert.deepEqual(applyVectorRepairs(after,patch,new Set([s.id])),after,'reattachment recovery is idempotent');
});
function project(){return parseVectorPlan(JSON.stringify({name:'Chó tru',vectorAssets:assets,scenes:[{name:'Tru',durationMs:10000,narration:'Con chó ngẩng đầu và tru.',vectorScene:drawing}]}),'truyện ma',{width:720,height:1280});}

test('the observed missing hang key quote recovers a literal boolean without modifying narration',()=>{
  for(const hang of [true,false]){
    const narration='Keep the literal text: "hang:false} in narration.';
    const raw=JSON.stringify({vectorAssets:{human:{rig:'simple-human'},lamp:{rig:'lantern'}},scenes:[{durationMs:7000,narration,vectorScene:{width:720,height:1280,
      nodes:[{id:'person',type:'instance',asset:'human'},{id:'lamp',type:'instance',asset:'lamp',attachTo:'person/hand-r',hang}],tracks:[]}}]})
      .replace(`"hang":${hang}`,`"hang:${hang}`);
    const p=parseVectorPlan(raw,'test',{width:720,height:1280});
    assert.equal(p.scenes[0]!.narration,narration);
    assert.equal(p.scenes[0]!.vectorScene!.nodes.find(n=>n.id==='lamp')!.hang,hang);
  }
});

test('native physical shot commands replace inherited channels while preserving reusable ground and attachment geometry',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{human:{rig:'simple-human'},lamp:{rig:'lantern'}},vectorStages:{yard:{width:720,height:1280,
    nodes:[{id:'sky',type:'rect',width:720,height:1280,fill:'#111'},
      {id:'person',type:'instance',asset:'human',x:220,y:500,width:180,height:360},
      {id:'door',type:'rect',x:500,y:500,width:60,height:250,fill:'#455'},
      {id:'lamp',type:'instance',asset:'lamp',attachTo:'person/hand-r',x:-30,y:0,width:60,height:100}],
    ground:{y:980,targets:[{target:'person'},{target:'door'}]},
    tracks:[{target:'person/arm-l',start:0,end:1,frames:[{t:0,rotation:2},{t:1,rotation:-2}]},
      {target:'lamp/flame',start:0,end:1,frames:[{t:0,opacity:.9},{t:1,opacity:1}]}]}},
    scenes:[{durationMs:8000,narration:'Đi đến cửa rồi tắt đèn.',vectorScene:{stage:'yard',camera:[{t:0,x:360,y:800,zoom:1.4}],
      walks:[{actor:'person',to:'door',gap:70,carry:'r',start:0,end:.5}],footsteps:[{id:'trail',from:'person',to:'door',hold:true}],lights:[{target:'lamp',on:false,start:.7,end:.72}]}}]}),'story',{width:720,height:1280});
  const s=p.scenes[0]!;assert.equal(s.vectorScene!.nodes.find(n=>n.id==='lamp')!.attachTo,'person/hand-r');
  assert.equal(s.vectorScene!.ground!.parent,'camera-world');
  assert.equal(s.vectorScene!.tracks.filter(t=>t.target==='person/arm-l').length,1);
  assert.equal(evaluateVectorPart('lamp/flame',s,7900).opacity,0);
  assert.ok(evaluateVectorPart('person',s,7000).dx>100);
  const after=applyVectorRepairs(p,JSON.stringify({scenes:[{id:s.id,vectorScenePatch:{shot:{target:'person',height:.5,include:['door']}}}]}),new Set([s.id]));
  assert.ok(vectorPhysicalEvidence(after.scenes[0]!,after.vectorAssets!).carriedProps[0]!.frames.every(f=>f.visibleFraction>.999));
  assert.throws(()=>applyVectorRepairs(p,JSON.stringify({scenes:[{id:s.id,vectorScenePatch:{tracks:[{target:'camera-world',start:0,end:1,frames:[{t:0,dy:-210}]}]}}]}),new Set([s.id])),/use shot/);
  const trailPatch=JSON.stringify({scenes:[{id:s.id,vectorScenePatch:{footsteps:[{id:'trail',from:'person',to:'door',count:6,color:'#3f6257',hold:true}],removeNodes:['trail-floor']}}]});
  const updated=applyVectorRepairs(p,trailPatch,new Set([s.id]));
  assert.equal(updated.scenes[0]!.vectorScene!.nodes.filter(n=>n.groundMark).length,6);
  assert.ok(updated.scenes[0]!.vectorScene!.nodes.some(n=>n.id==='trail-6-sole'&&n.fill==='#3f6257'));
  assert.deepEqual(applyVectorRepairs(updated,trailPatch,new Set([s.id])),updated,'native trail repair is idempotent');
});

test('numeric SVG attribute typos are recovered without altering quoted narration',()=>{
  const narration='The label says "x="70"".';
  const raw=JSON.stringify({vectorAssets:assets,scenes:[{durationMs:5000,narration,vectorScene:{...drawing,nodes:[...drawing.nodes,{id:'cord',type:'line',x:100,y:300,x2:0,y2:70,stroke:'#fff'}]}}]});
  const repaired=parseVectorPlan(raw.replace('"y2":70','"y2="70"'),'story',{width:720,height:1280});
  assert.equal(repaired.scenes[0]!.vectorScene!.nodes.find(n=>n.id==='cord')!.y2,70);
  assert.equal(repaired.scenes[0]!.narration,narration);
  assert.throws(()=>parseVectorPlan(raw.replace('"y2":70','"y2="invalid"'),'story',{width:720,height:1280}));
});

test('provider trailing braces do not consume text or extra closures after complete JSON',()=>{
  const raw=JSON.stringify({vectorAssets:assets,scenes:[{durationMs:5000,narration:'A label has } and "quotes".',vectorScene:drawing}]});
  const p=parseVectorPlan('```json\n'+raw+']}\n```','story',{width:720,height:1280});
  assert.equal(p.scenes.length,1);assert.equal(p.scenes[0]!.narration,'A label has } and "quotes".');
  assert.throws(()=>parseVectorPlan(raw.slice(0,-1),'story',{width:720,height:1280}),/complete JSON/);
});
test('vector parser preserves frame orientation and every shot while fitting planned duration',()=>{
  const raw={vectorAssets:assets,scenes:[{durationMs:5000,narration:'Con chó tru.',vectorScene:drawing},{durationMs:10000,narration:'Người làng nghe tiếng tru.',vectorScene:drawing}]};
  const p=parseVectorPlan(JSON.stringify(raw),'truyện ma',{width:720,height:1280},60);
  assert.equal(p.scenes.length,2);assert.equal(p.scenes.reduce((sum,s)=>sum+s.durationMs,0),60000);
  assert.equal(p.scenes[0]!.dialogue![0]!.text,'Con chó tru.');
  assert.throws(()=>parseVectorPlan(JSON.stringify(raw),'truyện ma',{width:1280,height:720}),/orientation/);
});
test('whole-film art redesign changes drawings without replacing retained narration, timing or audio',()=>{
  const p=project();p.scenes[0]!.audioUrl='/retained.wav';p.scenes[0]!.dialogue![0]!.audioUrl='/voice.wav';
  const changed=applyVectorRedesign(p,JSON.stringify({vectorAssets:assets,scenes:[{id:p.scenes[0]!.id,vectorScene:drawing}]}));
  assert.equal(changed.scenes[0]!.audioUrl,'/retained.wav');assert.deepEqual(changed.scenes[0]!.dialogue,p.scenes[0]!.dialogue);
  assert.equal(changed.scenes[0]!.durationMs,p.scenes[0]!.durationMs);
  const invalidCue=applyVectorRedesign(p,JSON.stringify({vectorAssets:assets,scenes:[{id:p.scenes[0]!.id,vectorScene:{...drawing,tracks:drawing.tracks.map(t=>({...t,cue:'Unspoken new words'}))}}]}));
  assert.equal(invalidCue.scenes[0]!.vectorScene!.tracks[0]!.cue,undefined);
  assert.equal(invalidCue.scenes[0]!.vectorScene!.tracks[0]!.start,.2);
  assert.equal(invalidCue.scenes[0]!.audioUrl,'/retained.wav');
  assert.throws(()=>applyVectorRedesign(p,'{"vectorAssets":{},"scenes":[]}'),/every shot/);
  assert.throws(()=>applyVectorRedesign(p,JSON.stringify({vectorAssets:assets,scenes:[{id:p.scenes[0]!.id,narration:'Changed',vectorScene:drawing}]})),/narration/);
});
test('reference art accepts bounded local images and never external URLs or markup',()=>{
  assert.deepEqual(normalizeVectorReferenceImages(['data:image/jpeg;base64,YQ==']),['data:image/jpeg;base64,YQ==']);
  for(const invalid of [['https://example.com/reference.jpg'],['data:image/svg+xml;base64,YQ=='],Array(5).fill('data:image/png;base64,YQ==')])assert.throws(()=>normalizeVectorReferenceImages(invalid));
});
test('a renderable draft retains actual review issues and is never reported as approved',()=>{
  const p=project();p.vectorReview={pass:false,rounds:4,previewDirectory:'test-preview',issues:[{sceneId:p.scenes[0]!.id,problem:'The narrated jaw does not open.',fix:'Animate the existing jaw.'}]};
  const report=evaluateCanvasVisualQuality(JSON.parse(JSON.stringify(p)));
  assert.equal(report.pass,false);assert.equal(report.score,0);
  assert.equal(report.issues[0]!.sceneId,p.scenes[0]!.id);
  assert.equal(report.issues[0]!.message,'The narrated jaw does not open.');
});
test('review distinguishes a carried prop cropped by the camera from missing geometry',()=>{
  const p=project(),changed=applyVectorRedesign(p,JSON.stringify({vectorAssets:{...assets,lamp:{rig:'lantern'}},scenes:[{id:p.scenes[0]!.id,
    vectorScene:{...drawing,nodes:[...drawing.nodes,{id:'lamp',type:'instance',asset:'lamp',attachTo:'dog/head',x:70,y:0,width:60,height:100}],
      camera:[{t:0,x:200,y:640,zoom:2}]}}]}));
  const evidence=vectorPhysicalEvidence(changed.scenes[0]!,changed.vectorAssets!);
  assert.equal(evidence.carriedProps[0]!.attachTo,'dog/head');
  assert.equal(evidence.carriedProps[0]!.frames[0]!.visibleFraction,0);
  assert.ok(evidence.carriedProps[0]!.frames[0]!.bounds.left>720);
});
test('a native hinge repair clears an old diagonal rotation while retaining all unrelated channels',()=>{
  const p=project(),s=p.scenes[0]!;
  const before=applyVectorRedesign(p,JSON.stringify({vectorAssets:assets,scenes:[{id:s.id,vectorScene:{...drawing,nodes:[...drawing.nodes,{id:'leaf',type:'group',x:450,y:700}],
    tracks:[...drawing.tracks,{target:'leaf',start:0,end:1,frames:[{t:0,rotation:0,opacity:1},{t:1,rotation:68,opacity:.8}]}]}}]}));
  const after=applyVectorRepairs(before,JSON.stringify({scenes:[{id:s.id,vectorScenePatch:{hinges:[{target:'leaf',open:true,start:0,end:1}]}}]}),new Set([s.id]));
  assert.equal(evaluateVectorPart('leaf',after.scenes[0]!,10000).rotation,0);
  assert.equal(evaluateVectorPart('leaf',after.scenes[0]!,10000).scaleX,.15);
  assert.equal(evaluateVectorPart('leaf',after.scenes[0]!,10000).opacity,.8);
});

test('a visual repair cannot replace narrated extinguishing with an always-lit lamp',()=>{
  const p=project(),s=p.scenes[0]!;s.narration='The lamp goes out.';
  const before=applyVectorRedesign(p,JSON.stringify({vectorAssets:{...assets,lamp:{rig:'lantern'}},scenes:[{id:s.id,vectorScene:{...drawing,
    nodes:[...drawing.nodes,{id:'lamp',type:'instance',asset:'lamp',x:300,y:600}],lights:[{target:'lamp',on:false,start:.2,end:.25,cue:'goes out'}]}}]}));
  const patch={scenes:[{id:s.id,vectorScenePatch:{removeTracks:['lamp/flame'],tracks:[{target:'lamp/flame',start:0,end:1,frames:[{t:0,opacity:1}]}]}}]};
  assert.throws(()=>applyVectorRepairs(before,JSON.stringify(patch),new Set([s.id])),/erased narrated action/);
  assert.equal(evaluateVectorPart('lamp/flame',before.scenes[0]!,9999).opacity,0);
  const reversed={scenes:[{id:s.id,vectorScenePatch:{lights:[{target:'lamp',on:true,start:.2,end:.25,cue:'goes out'}]}}]};
  assert.throws(()=>applyVectorRepairs(before,JSON.stringify(reversed),new Set([s.id])),/reversed narrated visibility/);
});

test('repairing a holding arm may settle into a native reach while the narrated lamp still extinguishes',()=>{
  const p=project(),s=p.scenes[0]!;s.narration='The lamp goes out.';
  const before=applyVectorRedesign(p,JSON.stringify({vectorAssets:{human:{rig:'simple-human'},lamp:{rig:'lantern'}},scenes:[{id:s.id,vectorScene:{width:720,height:1280,
    nodes:[{id:'person',type:'instance',asset:'human',x:200,y:500,width:180,height:360},{id:'lamp',type:'instance',asset:'lamp',attachTo:'person/hand-r',hang:true,x:-30,y:0,width:60,height:100}],
    tracks:[{target:'person/arm-r',start:.2,end:.4,cue:'goes out',frames:[{t:0,rotation:0},{t:1,rotation:30}]}],
    lights:[{target:'lamp',on:false,start:.2,end:.25,cue:'goes out'}]}}]}));
  const after=applyVectorRepairs(before,JSON.stringify({scenes:[{id:s.id,vectorScenePatch:{reaches:[{actor:'person',arm:'r',point:{x:215,y:180},hold:true}]}}]}),new Set([s.id]));
  assert.equal(evaluateVectorPart('lamp/flame',after.scenes[0]!,9999).opacity,0);
  assert.equal(evaluateVectorPart('person/arm-r',after.scenes[0]!,0).rotation,evaluateVectorPart('person/arm-r',after.scenes[0]!,9999).rotation);
});

test('both actual-frame review and repair receive the requested art direction',()=>{
  const p=project(),scene=p.scenes[0]!;
  p.vectorStyleReferences=['data:image/jpeg;base64,REFERENCE'];
  const frames=[{sceneId:scene.id,imageUrl:'data:image/png;base64,ACTUAL',times:[100]}];
  const reviewed=JSON.stringify(buildVectorReviewContent(p,frames,'story').content);
  assert.ok(reviewed.includes('base64,REFERENCE'));assert.ok(reviewed.includes('base64,ACTUAL'));
  assert.ok(reviewed.indexOf('ART-DIRECTION REFERENCES')<reviewed.indexOf('ACTUAL SVG RENDERED FRAMES'));
  const repaired=JSON.stringify(buildVectorRepairContent(p,[{sceneId:scene.id,problem:'Unreadable prop',fix:'Enlarge the prop'}],frames));
  assert.ok(repaired.includes('base64,REFERENCE'));assert.ok(repaired.includes('base64,ACTUAL'));
});
test('follow-up review excludes shots already approved rather than re-opening the whole film',()=>{
  const p=project(),id=p.scenes[0]!.id;p.scenes.push({...p.scenes[0]!,id:'approved'});
  const result=buildVectorReviewContent(p,[{sceneId:id,imageUrl:'FIXED',times:[100]},{sceneId:'approved',imageUrl:'OLD',times:[100]}],'story',new Set([id]));
  assert.equal(result.scenes.length,1);assert.ok(JSON.stringify(result.content).includes('FIXED'));assert.ok(!JSON.stringify(result.content).includes('OLD'));
});
test('visual repairs preserve speech, audio, IDs and unaffected scenes; shared cast cannot be overwritten',()=>{
  const p=project(),scene=p.scenes[0]!;scene.audioUrl='/api/audio.wav';p.scenes.push({...scene,id:'untouched'});
  const repaired=applyVectorRepairs(p,JSON.stringify({scenes:[{id:scene.id,vectorScene:{...drawing,nodes:drawing.nodes.map(n=>n.id==='dog'?{...n,x:220}:n)}}]}),new Set([scene.id]));
  assert.equal(repaired.scenes[0]!.audioUrl,scene.audioUrl);assert.equal(repaired.scenes[0]!.narration,scene.narration);
  assert.equal(repaired.scenes[0]!.id,scene.id);assert.deepEqual(repaired.scenes[1],p.scenes[1]);
  assert.doesNotThrow(()=>applyVectorRepairs(p,JSON.stringify({newAssets:assets,scenes:[{id:scene.id,vectorScene:drawing}]}),new Set([scene.id])),'identical cached assets are reused');
  assert.doesNotThrow(()=>applyVectorRepairs(JSON.parse(JSON.stringify(p)),JSON.stringify({newAssets:assets,scenes:[{id:scene.id,vectorScene:drawing}]}),new Set([scene.id])),'checkpoint serialization preserves exact replay');
  assert.throws(()=>applyVectorRepairs(p,JSON.stringify({newAssets:{dog:{...assets.dog,width:101}},scenes:[{id:scene.id,vectorScene:drawing}]}),new Set([scene.id])),/shared cast/);
  assert.throws(()=>applyVectorRepairs(p,JSON.stringify({scenes:[{id:scene.id,narration:'Changed',vectorScene:drawing}]}),new Set([scene.id])),/spoken content/);
});

test('a clue repair preserves fixed close-up, boat, previous acting and unrelated channels',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorAssets:assets,scenes:[{durationMs:10000,narration:'Con chó ngẩng đầu và tru.',vectorScene:{...drawing,
    nodes:[...drawing.nodes,{id:'boat',type:'rect',x:60,y:900,width:540,height:120,fill:'#654'},
      {id:'clue',type:'ellipse',x:300,y:940,rx:8,ry:4}],
    tracks:[...drawing.tracks,{target:'clue',start:0,end:1,frames:[{t:0,opacity:0,rotation:12},{t:1,opacity:1,rotation:15}]}],
    camera:[{t:0,x:330,y:870,zoom:1.85}],
  }}]}),'horror',{width:720,height:1280});
  const before=structuredClone(p),scene=p.scenes[0]!;scene.audioUrl='/mixed.wav';
  const repaired=applyVectorRepairs(p,JSON.stringify({scenes:[{id:scene.id,vectorScenePatch:{
    nodes:[{id:'clue',y:925}],reveals:[{targets:['clue'],cue:'ngẩng đầu',start:0,end:.02}],
  }}]}),new Set([scene.id]));
  const after=repaired.scenes[0]!;
  for(const target of ['dog/head','camera-world'])assert.deepEqual(after.vectorScene!.tracks.filter(t=>t.target===target),before.scenes[0]!.vectorScene!.tracks.filter(t=>t.target===target));
  assert.deepEqual(after.vectorScene!.nodes.find(n=>n.id==='boat'),before.scenes[0]!.vectorScene!.nodes.find(n=>n.id==='boat'));
  assert.equal(after.vectorScene!.nodes.find(n=>n.id==='clue')!.y,925);
  assert.equal(after.vectorScene!.nodes.find(n=>n.id==='clue')!.rx,8);
  assert.equal(after.vectorScene!.tracks.find(t=>t.target==='clue'&&t.frames[0]!.rotation!==undefined)!.frames[1]!.rotation,15);
  assert.equal(after.audioUrl,'/mixed.wav');assert.deepEqual(after.dialogue,scene.dialogue);
  assert.equal(after.durationMs,scene.durationMs);assert.equal(after.narration,scene.narration);
  assert.deepEqual(p.scenes[0]!.vectorScene,before.scenes[0]!.vectorScene,'repair must not mutate retained checkpoint');
  assert.throws(()=>applyVectorRepairs(p,JSON.stringify({scenes:[{id:scene.id,vectorScenePatch:{removeNodes:['absent']}}]}),new Set([scene.id])),/existing node/);
  assert.throws(()=>applyVectorRepairs(p,JSON.stringify({scenes:[{id:scene.id,vectorScenePatch:{camera:[]}}]}),new Set([scene.id])),/unknown scene patch/);
});

test('repair receives measured phrase timing and resolved offsets without leaking audio URLs',()=>{
  const p=project(),scene=p.scenes[0]!;
  scene.audioUrl='/private-mix.wav';
  scene.dialogue=[{id:'n',speaker:'Narrator',text:scene.narration!,atMs:220,durationMs:8000,audioUrl:'/private-voice.wav',speechWindows:[{startMs:500,endMs:7000}]}];
  scene.vectorScene!.tracks[0]!.cue='ngẩng đầu';scene.vectorScene!.tracks[0]!.cueOffsetMs=350;
  const text=String(buildVectorRepairContent(p,[{sceneId:scene.id,problem:'Wrong onset',fix:'Adjust reveal'}],[])[0]!.text);
  const supplied=JSON.parse(text).scenes[0];
  assert.deepEqual(supplied.dialogue[0].speechWindows,scene.dialogue[0]!.speechWindows);
  assert.ok(supplied.resolvedTracks[0].start>1000);
  assert.ok(!text.includes('/private-'));assert.equal(supplied.dialogue[0].atMs,220);
});
test('visual review cannot pass with defects, unknown scenes or a failure without evidence',()=>{
  const p=project();assert.deepEqual(parseVectorReview('{"pass":true,"issues":[]}',p),{pass:true,issues:[]});
  assert.throws(()=>parseVectorReview('{"pass":false,"issues":[]}',p),/disagrees/);
  assert.throws(()=>parseVectorReview('{"pass":false,"issues":[{"sceneId":"missing","problem":"bad","fix":"redraw"}]}',p),/existing scene/);
});
test('visual repair receives actual failing frames and keeps unrelated shots read-only',()=>{
  const p=project(),scene=p.scenes[0]!;
  p.scenes.push({...scene,id:'untouched'});
  const content=buildVectorRepairContent(p,[{sceneId:scene.id,problem:'Particle crosses the caption',fix:'Remove or clip it'}],
    [{sceneId:scene.id,imageUrl:'data:image/png;base64,FAILED',times:[100,200]}, {sceneId:'untouched',imageUrl:'data:image/png;base64,UNRELATED',times:[100]}]);
  assert.ok(JSON.stringify(content).includes('base64,FAILED'));
  assert.ok(!JSON.stringify(content).includes('base64,UNRELATED'));
  assert.equal(JSON.parse(String(content[0]!.text)).scenes.length,1);
});

test('visual checks use timestamped full video frames instead of interpreting a contact sheet as one scene',()=>{
  const p=project(),s=p.scenes[0]!,frames=[{sceneId:s.id,imageUrl:'data:image/png;base64,GRID',times:[0,5000,9900],frames:[
    {atMs:0,imageUrl:'data:image/png;base64,START'},{atMs:9900,imageUrl:'data:image/png;base64,END'},
  ]}];
  for(const content of [buildVectorReviewContent(p,frames,'story').content,buildVectorRepairContent(p,[{sceneId:s.id,problem:'Check the hinge',fix:'Use the real end frame'}],frames)]){
    const text=JSON.stringify(content);assert.ok(text.includes('base64,START'));assert.ok(text.includes('base64,END'));
    assert.ok(text.includes('time=9900ms'));assert.ok(!text.includes('base64,GRID'));
  }
});

test('performance review exposes a frozen tail despite a declared full-shot track',()=>{
  const p=project(),s=p.scenes[0]!;
  s.vectorScene!.tracks=[{target:'dog/head',start:0,end:1,frames:[{t:0,rotation:0},{t:.2,rotation:-30},{t:1,rotation:-30}]}];
  const evidence=vectorMotionEvidence(s);
  assert.deepEqual(evidence.parts[0]!.changedIntervalsMs,[[0,2000]]);
  assert.equal(evidence.longestUnchangedMs,8000);
  const content=buildVectorReviewContent(p,[],'simple drawings, sustained acting').content;
  assert.deepEqual(JSON.parse(String(content[0]!.text)).scenes[0].motionEvidence,evidence);
  // Evidence never changes artwork, audio or authored keyframes.
  assert.equal(s.vectorScene!.tracks[0]!.frames.length,3);
});

test('a whole-stage camera push cannot count as the narrated character performing an action',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorAssets:assets,scenes:[{durationMs:10000,narration:'Con chó tru.',vectorScene:{...drawing,tracks:[],camera:[{t:0,x:360,y:640,zoom:1},{t:1,x:260,y:800,zoom:1.8}]}}]}),'truyện ma',{width:720,height:1280});
  const evidence=vectorMotionEvidence(p.scenes[0]!);
  assert.equal(evidence.longestUnchangedMs,10000);
  assert.deepEqual(evidence.parts,[]);
  assert.ok(evidence.camera?.[0]?.changedIntervalsMs.length,'camera movement is reported separately');
});

test('performance evidence follows measured speech cues and separates purposeful holds from motion',()=>{
  const s=project().scenes[0]!;
  s.dialogue=[{id:'voice',speaker:'Narrator',text:'AAAA BBBB',durationMs:9000}];
  s.vectorScene!.tracks=[{target:'dog/head',start:0,end:.2,cue:'BBBB',frames:[{t:0,rotation:0},{t:1,rotation:20}]}];
  assert.deepEqual(vectorMotionEvidence(s).parts[0]!.changedIntervalsMs,[[5000,7000]]);
  s.vectorScene!.tracks=[{target:'dog/head',start:0,end:1,frames:[{t:0,rotation:0},{t:.5,rotation:20,easing:'hold'},{t:1,rotation:20}]}];
  assert.deepEqual(vectorMotionEvidence(s).parts[0]!.changedIntervalsMs,[[4900,5000]]);
  s.vectorScene!.tracks=[];
  assert.equal(vectorMotionEvidence(s).longestUnchangedMs,10000);
});

test('vector planning retains physical sound cues instead of dropping them with empty legacy objects',()=>{
  const soundEffects=[{id:'howl-1',preset:'dog-howl',atMs:2600,durationMs:900,volume:.7}];
  const p=parseVectorPlan(JSON.stringify({vectorAssets:assets,scenes:[{durationMs:8000,narration:'Con chó tru.',vectorScene:drawing,soundEffects}]}),'tru',{width:720,height:1280});
  assert.equal(p.scenes[0]!.objects.length,0);
  assert.equal(p.scenes[0]!.soundEffects![0]!.preset,'dog-howl');
  assert.equal(p.scenes[0]!.soundEffects![0]!.atMs,2600);
  assert.equal(p.scenes[0]!.soundEffects![0]!.durationMs,900);
  const fitted=parseVectorPlan(JSON.stringify({vectorAssets:assets,scenes:[{durationMs:8000,narration:'Con chó tru.',vectorScene:drawing,soundEffects}]}),'tru',{width:720,height:1280},16);
  assert.equal(fitted.scenes[0]!.soundEffects![0]!.atMs,5200);
  assert.equal(fitted.scenes[0]!.soundEffects![0]!.durationMs,1800);
});


test('shared stages retain the boat, actors and lights across a fixed close-up without redrawing',()=>{
  const raw={vectorAssets:assets,vectorStages:{river:{...drawing,tracks:[],nodes:[...drawing.nodes,{id:'boat',type:'rect',x:60,y:900,width:540,height:120,fill:'#654'},{id:'moon',type:'ellipse',x:560,y:260,rx:30,ry:30,light:{kind:'moon',radius:75}}]}},scenes:[
    {durationMs:5000,narration:'The dog watches.',vectorScene:{stage:'river',tracks:[]}},
    {durationMs:5000,narration:'The dog howls.',vectorBeats:[{cue:'howls',targets:['dog/jaw']}],vectorScene:{stage:'river',camera:[{t:0,x:280,y:800,zoom:1.8}],tracks:[{target:'dog/jaw',frames:[{t:0,scaleY:1},{t:1,scaleY:3}]}]}}
  ]};
  const p=parseVectorPlan(JSON.stringify(raw),'night river',{width:720,height:1280});
  const [wide,close]=p.scenes;
  for(const id of ['boat','dog','moon']){
    const a=wide!.vectorScene!.nodes.find(n=>n.id===id)!,b=close!.vectorScene!.nodes.find(n=>n.id===id)!;
    assert.equal(a.x,b.x);assert.equal(a.y,b.y);assert.equal(a.width,b.width);assert.equal(a.height,b.height);
  }
  assert.equal(close!.vectorStageId,'river');assert.equal(close!.vectorBeats![0]!.cue,'howls');
  assert.equal(close!.vectorScene!.tracks.at(-1)!.frames.length,1);
  const bad=structuredClone(raw);(bad.scenes[1]!.vectorScene as any).nodes=[{id:'boat',type:'rect',width:1,height:1}];
  assert.throws(()=>parseVectorPlan(JSON.stringify(bad),'night river',{width:720,height:1280}),/replace existing/);
  (bad.scenes[1]!.vectorScene as any)={stage:'missing'};
  assert.throws(()=>parseVectorPlan(JSON.stringify(bad),'night river',{width:720,height:1280}),/missing reusable stage/);
  const invalidBeat=structuredClone(raw);invalidBeat.scenes[1]!.vectorBeats![0]!.targets=['missing-arm'];
  assert.throws(()=>parseVectorPlan(JSON.stringify(invalidBeat),'night river',{width:720,height:1280}),/narration beat/);
});

test('approved reusable world supplies real deck/props and physical collar acting across cuts',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorStages:{river:{template:'folk-river-boat'}},scenes:[
    {durationMs:5000,narration:'He pulls his collar.',vectorScene:{stage:'river',camera:[{t:0,x:260,y:800,zoom:1.8}],reaches:[{actor:'lam',arm:'r',point:{x:120,y:182},end:.3}],tracks:[]}},
    {durationMs:5000,narration:'He keeps listening.',vectorScene:{stage:'river',reaches:[{actor:'lam',arm:'r',point:{x:120,y:182},hold:true}],tracks:[]}}
  ]}),'folk-horror',{width:720,height:1280});
  assert.equal(p.vectorAssets!['folk-wet-footprint']!.nodes.length,7);
  assert.equal(p.vectorAssets!['folk-wet-footprint']!.width,24);
  for(const s of p.scenes)for(const id of ['deck','hull','loose-plank','lamp','bell','lam','old'])assert.ok(s.vectorScene!.nodes.some(n=>n.id===id));
  assert.equal(p.vectorAssets!['folk-ferryman']!.nodes.find(n=>n.id==='oar')!.parent,'forearm-r');
  assert.notEqual(evaluateVectorPart('lam/arm-r',p.scenes[0]!,2000).rotation,0);
  const evidence=JSON.parse(String(buildVectorReviewContent(p,[],'story').content[0]!.text)).scenes[0].framingEvidence;
  assert.equal(evidence.find((actor:{actor:string})=>actor.actor==='lam').firstFrameNominalHeightFraction,360*1.8/1280);
  assert.equal(evaluateVectorPart('lam/arm-r',p.scenes[0]!,2000).rotation,evaluateVectorPart('lam/arm-r',p.scenes[1]!,0).rotation);
  const two=parseVectorPlan(JSON.stringify({vectorStages:{one:{template:'folk-river-boat'},two:{template:'folk-river-boat'}},scenes:[{durationMs:5000,narration:'Night.',vectorScene:{stage:'two'}}]}),'night',{width:720,height:1280});
  assert.ok(two.vectorStages!.one);assert.ok(two.vectorStages!.two);
});

test('floor clues can attach to the reusable deck without an invalid primitive parent',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorStages:{river:{template:'folk-river-boat'}},scenes:[{
    durationMs:10000,narration:'Four footprints appear.',vectorScene:{stage:'river',
      nodes:[{id:'step-1',type:'instance',parent:'deck',asset:'folk-wet-footprint',x:350,y:22,width:32,height:27}],
      reveals:[{targets:['step-1'],cue:'footprints appear',end:.02}],
    },
  }]}),'folk-horror',{width:720,height:1280});
  const nodes=p.scenes[0]!.vectorScene!.nodes;
  assert.equal(nodes.find(n=>n.id==='deck')!.type,'group');
  assert.equal(nodes.find(n=>n.id==='deck-surface')!.parent,'boat-world');
  assert.ok(nodes.findIndex(n=>n.id==='deck')>nodes.findIndex(n=>n.id==='loose-plank'));
  assert.equal(nodes.find(n=>n.id==='step-1')!.parent,'deck');
  assert.equal(p.scenes[0]!.vectorScene!.tracks.find(t=>t.target==='step-1')!.cue,'footprints appear');
});

test('a deliberate shot action replaces only the matching inherited secondary channel',()=>{
  const p=parseVectorPlan(JSON.stringify({vectorStages:{river:{template:'folk-river-boat'}},scenes:[{durationMs:5000,narration:'He recoils.',vectorScene:{stage:'river',tracks:[{target:'lam/upper-body',start:0,end:1,frames:[{t:0,dy:0},{t:1,dy:-12}]}]}}]}),'folk-horror',{width:720,height:1280});
  assert.equal(evaluateVectorPart('lam/upper-body',p.scenes[0]!,5000).dy,-12);
  assert.ok(p.scenes[0]!.vectorScene!.tracks.some(t=>t.target==='old/upper-body'));
  assert.ok(p.scenes[0]!.vectorScene!.tracks.some(t=>t.target==='lam/tunic-hem'));
});


test('parser restores a previously held instance before validating a later cut that declares carry but omits prop geometry',()=>{
  const input={vectorAssets:{hero:{rig:'simple-puppet',design:'village'},light:{rig:'lantern'}},
    vectorStages:{village:{template:'illustrated-place',place:'village',finish:'handdrawn',view:'elevated',cast:{person:'hero'}}},
    scenes:[0,1,2].map(i=>({durationMs:2000,narration:'The same light remains in his hand.',vectorScene:{stage:'village',
      nodes:i?[]:[{id:'held',type:'instance',asset:'light',width:35,height:58}],
      carries:[{actor:'person',arm:'r',prop:'held',hang:true}]}}))};
  const original=JSON.stringify(input),p=parseVectorPlan(original,'night',{width:1280,height:720});
  for(const s of p.scenes){
    assert.equal(s.vectorScene!.nodes.find(n=>n.id==='held')!.attachTo,'person/hand-r');
    for(let t=0;t<=2000;t+=100){
      const hand=vectorPoint(vectorWorldMatrix('person/hand-r',s,t),0,0),grip=vectorPoint(vectorWorldMatrix('held',s,t),30,6);
      assert.ok(Math.hypot(hand.x-grip.x,hand.y-grip.y)<1e-7);
    }
  }
  assert.equal(JSON.stringify(input),original,'the original cached response is immutable');
  assert.deepEqual(compileVectorProject(p),p);
  input.scenes[0]!.vectorScene.nodes=[];
  assert.throws(()=>parseVectorPlan(JSON.stringify(input),'night',{width:1280,height:720}),/carry needs/,'an unknown first-shot prop is still invalid');
});

test('native door binds the primary home leaf and an attempted redraw reports its exact colliding stage ID',()=>{
  const input={vectorAssets:{hero:{rig:'simple-puppet',design:'village'}},
    vectorStages:{village:{template:'illustrated-place',place:'village',finish:'handdrawn',view:'elevated',cast:{person:'hero'}}},
    scenes:[{durationMs:2000,narration:'The door shudders.',vectorScene:{stage:'village',tracks:[{target:'door',start:0,end:1,frames:[{t:0,rotation:0},{t:.5,rotation:3},{t:1,rotation:0}]}]}}]};
  const p=parseVectorPlan(JSON.stringify(input),'night',{width:1280,height:720}),s=p.scenes[0]!;
  assert.equal(s.vectorScene!.nodes.find(n=>n.id==='house-mid-door')!.parent,'door');
  assert.equal(s.vectorScene!.nodes.find(n=>n.id==='door-opening')!.parent,'house-mid');
  assert.notDeepEqual(vectorWorldMatrix('house-mid-door',s,0),vectorWorldMatrix('house-mid-door',s,1000));
  assert.deepEqual(vectorWorldMatrix('door-opening',s,0),vectorWorldMatrix('door-opening',s,1000));
  const duplicate={...input,scenes:[{...input.scenes[0],vectorScene:{stage:'village',nodes:[{id:'house-mid',type:'group'}]}}]};
  assert.throws(()=>parseVectorPlan(JSON.stringify(duplicate),'night',{width:1280,height:720}),/existing geometry: house-mid/);
});

test('narration accepts a verified scene-group path without replacing scenery or accepting wrong ancestry',()=>{
  const input={vectorAssets:{},vectorStages:{yard:{width:1280,height:720,nodes:[
    {id:'old-well',type:'group'},{id:'cover',type:'rect',parent:'old-well',width:80,height:20,fill:'#765432'}]}},
    scenes:[{durationMs:2000,narration:'The cover trembles.',vectorScene:{stage:'yard'},vectorBeats:[{cue:'cover trembles',targets:['old-well/cover']}]}]};
  const before=JSON.stringify(input),p=parseVectorPlan(before,'ordinary',{width:1280,height:720});
  assert.deepEqual(p.scenes[0]!.vectorBeats,[{cue:'cover trembles',targets:['cover']}]);
  assert.equal(JSON.stringify(input),before);
  input.scenes[0]!.vectorBeats[0]!.targets=['wrong/cover'];
  assert.throws(()=>parseVectorPlan(JSON.stringify(input),'ordinary',{width:1280,height:720}),/existing targets/);
});

test('repair context keeps approved ink read-only and compact while retaining editable prop paths and contact metadata',async()=>{
  const {lockFolkInkAsset}=await import('../../shared/canvasVectorStyleLock');
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{hero:lockFolkInkAsset({rig:'simple-puppet'}),prop:{width:20,height:20,nodes:[{id:'body',type:'path',d:'M 0 0 L 20 0 L 20 20 Z',fill:'#765432'}]}},
    scenes:[{durationMs:2000,narration:'He waits.',vectorScene:{width:1280,height:720,nodes:[{id:'hero',type:'instance',asset:'hero'}]}}]}),'ordinary',{width:1280,height:720});
  const {buildVectorRepairContent}=await import('./canvasVectorDirector'),before=JSON.stringify(p),s=p.scenes[0]!;
  const text=buildVectorRepairContent(p,[{sceneId:s.id,problem:'framing',fix:'show actor'}],[])[0]!.text as string;
  const sent=JSON.parse(text);
  assert.equal(sent.vectorAssets.hero.readOnly,true);
  assert.ok(sent.vectorAssets.hero.nodes.every((n:{d?:string})=>n.d===undefined));
  assert.equal(sent.vectorAssets.hero.nodes.find((n:{id:string})=>n.id==='hand-r').x,133);
  assert.equal(sent.vectorAssets.prop.nodes[0].d,p.vectorAssets!.prop!.nodes[0]!.d);
  assert.ok(JSON.stringify(sent.vectorAssets.hero).length<JSON.stringify(p.vectorAssets!.hero).length/3);
  assert.equal(JSON.stringify(p),before,'prompt compaction cannot modify saved or rendered artwork');
});

test('redesign and repair resolve shared stage references while retaining every voice asset',()=>{
  const p=project();p.scenes[0]!.audioUrl='/retained.wav';
  const stages={river:{...drawing,tracks:[],nodes:[...drawing.nodes,{id:'boat',type:'rect',x:60,y:900,width:540,height:120,fill:'#654'}]}};
  const redesign=applyVectorRedesign(p,JSON.stringify({vectorAssets:assets,vectorStages:stages,scenes:[{id:p.scenes[0]!.id,vectorScene:{stage:'river',camera:[{t:0,x:260,y:800,zoom:1.8}],tracks:[]}}]}));
  assert.equal(redesign.scenes[0]!.audioUrl,'/retained.wav');assert.ok(redesign.vectorStages!.river);
  const repaired=applyVectorRepairs(redesign,JSON.stringify({newAssets:{},scenes:[{id:p.scenes[0]!.id,vectorScene:{stage:'river',camera:[{t:0,x:260,y:800,zoom:1.8}],nodes:[{id:'footprint',type:'ellipse',x:250,y:890,rx:8,ry:4,fill:'#abc'}],tracks:[]}}]}),new Set([p.scenes[0]!.id]));
  assert.equal(repaired.scenes[0]!.audioUrl,'/retained.wav');assert.ok(repaired.scenes[0]!.vectorScene!.nodes.some(n=>n.id==='boat'));
  assert.ok(repaired.scenes[0]!.vectorScene!.nodes.some(n=>n.id==='footprint'));
  assert.deepEqual(repaired.vectorStages,redesign.vectorStages);
});
