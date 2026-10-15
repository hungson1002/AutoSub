import test from 'node:test';
import assert from 'node:assert/strict';
import {APPROVED_FOLK_STYLE,FOLK_INK_STYLE,folkInkPalette,handInkDrawing,handInkPath} from './canvasVectorInk';
import {lockFolkInkAsset} from './canvasVectorStyleLock';
import {normalizeVectorAssets,compileVectorProject} from './canvasVectorScene';
import {parseVectorPlan,applyVectorRepairs,applySelectedHorrorFinish,applyVectorRedesign} from '../server/services/canvasVectorDirector';
import {expandVectorStageLibrary} from '../server/services/canvasVectorStageLibrary';

test('production cast binding, rather than asset name order, identifies and preserves the lead',()=>{
  const person={rig:'simple-puppet',gender:'female',age:'adult',headwear:'none',hair:'bun',outfit:'cross-collar'};
  const p=parseVectorPlan(JSON.stringify({vectorAssets:{'z-lead':person,'a-extra':person},
    vectorStages:{village:{template:'illustrated-place',place:'village',view:'elevated',cast:{person:'z-lead'},extras:[{id:'neighbor',asset:'a-extra'}]}},
    scenes:[{durationMs:3000,narration:'The two villagers wait.',vectorScene:{stage:'village'}}]}),'[folk-horror]',{width:1280,height:720});
  const lead=p.vectorAssets!['z-lead']!,extra=p.vectorAssets!['a-extra']!;
  assert.ok(lead.nodes.some(n=>n.id==='village-role-lead'));
  assert.ok(lead.nodes.some(n=>n.id==='approved-identity-clasp'));
  assert.ok(extra.nodes.some(n=>n.id==='village-role-support'));
  assert.ok(extra.nodes.some(n=>n.id==='approved-hair-length'),'a duplicate bun becomes a distinct supporting braid');
  const saved=JSON.parse(JSON.stringify(p));
  assert.deepEqual(JSON.parse(JSON.stringify(compileVectorProject(saved).vectorAssets)),saved.vectorAssets);
});

test('ink curves are deterministic and idempotent, retaining endpoints, arcs and smooth semantics',()=>{
  for(const d of ['M 10 20 L 50 20 H 80 V 90 Z','m 10 20 40 0 l 0 40 h -20 v -30 z','M 0 0 A 20 30 0 0 1 40 60 L 90 60 Z','M 0 0 C 10 10 20 20 30 30 L 40 50']){
    const ink=handInkPath(d,'outline');assert.match(ink,/Q /);
    assert.equal(handInkPath(d,'outline'),ink);
    assert.equal(handInkPath(ink,'outline'),ink);
  }
  assert.match(handInkPath('M 10 20 L 50 60','a'),/50 60$/);
  for(const d of ['M 0 0 L 10 10 T 20 30','M 0 0 L 10 10 S 20 30 40 50'])assert.equal(handInkPath(d,'a'),d);
});

test('ink finishing preserves contact metadata, rounded corners and nested geometry without mutation',()=>{
  const drawing={width:100,height:100,grip:{x:12,y:9},nodes:[{id:'frame',type:'rect' as const,x:3,y:5,width:80,height:90,rx:12,pivotX:5,rotation:20,groundAnchor:{x:40,y:90}}]};
  const before=structuredClone(drawing),ink=handInkDrawing(drawing);
  assert.deepEqual(drawing,before);assert.deepEqual(ink.grip,drawing.grip);
  const n=ink.nodes[0]!;assert.equal(n.x,3);assert.equal(n.y,5);assert.equal(n.pivotX,5);assert.equal(n.rotation,20);assert.deepEqual(n.groundAnchor,drawing.nodes[0]!.groundAnchor);
  assert.match(n.d!,/^M 12 0/);assert.match(n.d!,/Q 80 0 80 12/);
  assert.deepEqual(handInkDrawing(ink),ink);
});

test('different model descriptors share the tool-owned grammar but retain distinct cast identities',()=>{
  const assets=normalizeVectorAssets(Object.fromEntries(['tunic','robe','vest','shawl','ao-dai'].map((outfit,i)=>['person-'+i,lockFolkInkAsset({rig:'simple-puppet',design:'legacy',finish:'clean',outfit,hair:['short','side-part','bun','braid','wavy'][i],gender:i%2?'female':'male',palette:{shirt:'#00ff00',ink:'#ff00ff'}})])));
  for(const a of Object.values(assets)){
    const by=(id:string)=>a.nodes.find(n=>n.id===id)!;
    assert.ok(by(FOLK_INK_STYLE));assert.ok(by(APPROVED_FOLK_STYLE));assert.equal(by('torso-ink-0').stroke,'#0e0c0b');
    assert.ok(by('eye-l').rx!*by('head-group').scaleX!<2.3);assert.equal(by('hand-l').x,47);assert.equal(by('hand-r').x,133);
    assert.equal(by('hand-l').type,'path','occupied hands use concealed grip strokes');
    assert.equal(a.nodes.some(n=>/^(arm|leg|knee|forearm)-/.test(n.id)),false);
  }
  assert.equal(new Set(Object.values(assets).map(a=>JSON.stringify(a.nodes.filter(n=>n.id.includes('hair')||n.id==='approved-bun-l')))).size,5);
  assert.deepEqual(normalizeVectorAssets(JSON.parse(JSON.stringify(assets))),normalizeVectorAssets(assets));
  assert.equal(folkInkPalette({shirt:'#00ff00'}).shirt,'#36544a');
  assert.throws(()=>lockFolkInkAsset({rig:'simple-human'}),/simple-puppet/);
  assert.throws(()=>lockFolkInkAsset({rig:'simple-puppet',nodes:[]}),/anatomy overrides/);
});

const plan=()=>({vectorAssets:{hero:{rig:'simple-puppet',finish:'clean'},drum:{width:80,height:70,nodes:[{id:'drum',type:'path',d:'M 0 0 L 80 0 L 70 70 L 10 70 Z',fill:'#a63d32'}]}},vectorStages:{village:{template:'illustrated-place',place:'village',finish:'clean',cast:{person:'hero'},extras:[{id:'neighbor',asset:'hero',x:650,footY:900,height:150}]}},scenes:[{durationMs:3000,narration:'The villagers wait.',vectorScene:{stage:'village'}}]});

test('production creation supplies distinct native cast when a provider omits identity choices',()=>{
  const raw={vectorAssets:{a:{rig:'simple-puppet'},b:{rig:'simple-puppet'},c:{rig:'simple-puppet'},
    d:{rig:'simple-puppet',gender:'female',faceShape:'broad',outfit:'shawl',hair:'braid',headwear:'none',facialHair:'none'}},
    vectorStages:{village:{template:'illustrated-place',place:'village',cast:{person:'a'},extras:[{id:'b',asset:'b'},{id:'c',asset:'c'},{id:'d',asset:'d'}]}},
    scenes:[{durationMs:3000,narration:'The villagers wait.',vectorScene:{stage:'village'}}]};
  const locked=JSON.parse(applySelectedHorrorFinish(JSON.stringify(raw),'[folk-horror]'));
  assert.deepEqual(['a','b','c'].map(id=>locked.vectorAssets[id].faceShape),['round','oval','broad']);
  assert.deepEqual(['a','b','c'].map(id=>locked.vectorAssets[id].outfit),['tunic','vest','robe']);
  assert.equal(locked.vectorAssets.d.faceShape,'broad');assert.equal(locked.vectorAssets.d.outfit,'shawl');
  const reversed=JSON.parse(applySelectedHorrorFinish(JSON.stringify({...raw,vectorAssets:Object.fromEntries(Object.entries(raw.vectorAssets).reverse())}),'[folk-horror]'));
  assert.deepEqual(reversed.vectorAssets,locked.vectorAssets,'provider object ordering cannot change identities');
  assert.deepEqual(JSON.parse(applySelectedHorrorFinish(JSON.stringify(locked),'[folk-horror]')),locked,'retry cannot choose a new costume');
  const p=parseVectorPlan(JSON.stringify(raw),'[folk-horror]',{width:1280,height:720});
  assert.equal(new Set(['a','b','c'].map(id=>p.vectorAssets![id]!.nodes.find(n=>n.id==='face-ink-0')!.d)).size,3);
  assert.equal(new Set(['a','b','c'].map(id=>p.vectorAssets![id]!.nodes.find(n=>n.id==='torso-ink-0')!.d)).size,3);
  assert.equal(new Set(['a','b','c'].map(id=>JSON.stringify(p.vectorAssets![id]!.nodes.filter(n=>n.parent==='eye-white-l')))).size,2,'omitted eye choices still yield round and half-lidded supporting faces');
  const saved=JSON.parse(JSON.stringify(p));
  assert.deepEqual(JSON.parse(JSON.stringify(compileVectorProject(saved).vectorAssets)),saved.vectorAssets,'saved cast remains immutable');
});

test('actual creation and repair boundaries enforce the selected style, with persisted old projects unchanged',()=>{
  const raw=JSON.stringify(plan()),profile=JSON.parse(applySelectedHorrorFinish(raw,'[folk-horror]'));
  assert.equal(profile.vectorStages.village.finish,'handdrawn');assert.equal(profile.vectorAssets.hero.design,'village');
  const p=parseVectorPlan(raw,'[folk-horror]',{width:1280,height:720});
  assert.ok(p.vectorAssets!.drum!.nodes.find(n=>n.id==='drum')!.stroke);assert.match(p.vectorAssets!.drum!.nodes[0]!.d!,/Q /);
  const stage=p.vectorStages!.village!,hero=stage.nodes.find(n=>n.id==='person')!,neighbor=stage.nodes.find(n=>n.id==='neighbor')!;
  assert.ok(stage.nodes.some(n=>n.id==='ink-frame-tree-left-trunk'));
  assert.ok(neighbor.height!<=hero.height!*1.08,'same depth cannot make an extra twice the main actor height');
  const saved=JSON.parse(JSON.stringify(p)),oldAssets=JSON.stringify(saved.vectorAssets);
  assert.equal(JSON.stringify(compileVectorProject(saved).vectorAssets),oldAssets);
  const s=p.scenes[0]!,patch=JSON.stringify({newAssets:{basket:{width:80,height:70,nodes:[{id:'basket',type:'rect',width:80,height:70,fill:'#a87'}]}},scenes:[{id:s.id,vectorScenePatch:{nodes:[{id:'story-note',type:'rect',width:10,height:20,fill:'#a87'}]}}]});
  const repaired=applyVectorRepairs(p,patch,new Set([s.id]));
  assert.ok(repaired.vectorAssets!.basket!.nodes.some(n=>n.id===FOLK_INK_STYLE));
  assert.deepEqual(repaired.vectorAssets!.hero,p.vectorAssets!.hero);
  const note=repaired.scenes[0]!.vectorScene!.nodes.find(n=>n.id==='story-note')!;
  assert.equal(note.type,'path');assert.equal(note.stroke,'#292722');
  assert.deepEqual(applyVectorRepairs(repaired,patch,new Set([s.id])),repaired);
  assert.throws(()=>lockFolkInkAsset({nodes:[{id:'eye-big',type:'ellipse',rx:25,ry:25,fill:'#fff'}]}),/tiny dot/);
  const old=parseVectorPlan(raw,'ordinary legacy project',{width:1280,height:720});
  assert.equal(old.vectorAssets!.hero!.nodes.some(n=>n.id===FOLK_INK_STYLE),false);
  assert.throws(()=>applySelectedHorrorFinish(JSON.stringify({vectorStages:{bare:{nodes:[]}}}),'[folk-horror]',true),/native scenery base/);
  assert.doesNotThrow(()=>applySelectedHorrorFinish(raw,'[folk-horror]',true));
});

test('new native scenery casts share ink style, and automatic residential extras stay in open ground',()=>{
  for(const template of ['folk-courtyard','folk-room','folk-riverbank']){
    const p=parseVectorPlan(JSON.stringify({vectorStages:{world:{template}},scenes:[{durationMs:1000,narration:'Artwork.',vectorScene:{stage:'world'}}]}),'[folk-horror]',{width:1280,height:720});
    const person=p.vectorStages!.world!.nodes.find(n=>n.id==='person')!;
    assert.ok(p.vectorAssets![person.asset!]!.nodes.some(n=>n.id===FOLK_INK_STYLE));
  }
  const raw=plan();raw.vectorStages.village.extras=Array.from({length:8},(_,i)=>({id:'extra-'+i,asset:'hero'})) as typeof raw.vectorStages.village.extras;
  const p=parseVectorPlan(JSON.stringify(raw),'[folk-horror]',{width:1280,height:720});
  const nodes=p.vectorStages!.village!.nodes;
  for(const actor of nodes.filter(n=>n.id.startsWith('extra-'))){
    const headY=actor.y!+actor.height!*.25,centerX=actor.x!+actor.width!/2;
    for(const house of nodes.filter(n=>/^house-/.test(n.id)&&n.type==='group'))
      assert.equal(centerX>house.x!-30&&centerX<house.x!+house.width!+30&&headY>house.y!-house.height!*.73&&headY<house.y!+house.height!,false,actor.id+' must not stand on '+house.id);
  }
});

test('native cast slots bind to locked story identity across shots and grounded custom props retain footY',()=>{
  const raw={vectorAssets:{lan:{rig:'simple-puppet'},drum:{width:110,height:100,nodes:[{id:'body',type:'rect',width:110,height:100,fill:'#765'}]}},
    vectorStages:{village:{template:'illustrated-place',place:'village',view:'elevated',cast:{person:'lan'},nodes:[{id:'drum',type:'instance',asset:'drum',x:600,footY:790,width:110,height:100}]}},
    scenes:[{narration:'person is a name in prose',vectorScene:{stage:'village',reactions:[{actor:'person',kind:'look',toward:'drum'}],tracks:[{target:'person/head-group',frames:[]}]},vectorBeats:[{cue:'person',targets:['person/eyes','drum']}]},
      {vectorScene:{stage:'village',shot:{target:'person',include:['drum']}}}]};
  const before=structuredClone(raw),data=expandVectorStageLibrary(raw,{width:1280,height:720},['lan']) as any;
  const stage=data.vectorStages.village;
  assert.ok(stage.nodes.some((n:{id:string})=>n.id==='lan'));assert.equal(stage.nodes.some((n:{id:string})=>n.id==='person'),false);
  assert.ok(stage.ground.targets.some((t:{target:string})=>t.target==='lan'));
  assert.equal(data.scenes[0].vectorScene.reactions[0].actor,'lan');assert.equal(data.scenes[0].vectorScene.tracks[0].target,'lan/head-group');
  assert.deepEqual(data.scenes[0].vectorBeats[0],{cue:'person',targets:['lan/eyes','drum']});
  assert.equal(data.scenes[0].narration,raw.scenes[0]!.narration);assert.equal(data.scenes[1].vectorScene.shot.target,'lan');
  const drum=stage.nodes.find((n:{id:string})=>n.id==='drum');assert.equal(drum.y,690);assert.equal(drum.groundOffsetY,-110);assert.deepEqual(drum.groundAnchor,{x:55,y:100});
  assert.deepEqual(raw,before);
  assert.ok((expandVectorStageLibrary(raw,{width:1280,height:720}) as any).vectorStages.village.nodes.some((n:{id:string})=>n.id==='person'),'old callers retain native IDs');
});

test('visual refinement keeps approved ink assets and enforces the same style for new art',()=>{
  const raw=plan(),p=parseVectorPlan(JSON.stringify(raw),'[folk-horror]',{width:1280,height:720});
  const redesign={vectorAssets:{hero:{rig:'simple-puppet',design:'legacy',finish:'clean'},drum:{nodes:[]},newNote:{width:30,height:40,nodes:[{id:'note',type:'rect',width:30,height:40,fill:'#aa9988'}]}},vectorStages:raw.vectorStages,
    scenes:[{id:p.scenes[0]!.id,vectorScene:{stage:'village'}}]};
  const next=applyVectorRedesign(p,JSON.stringify(redesign));
  assert.deepEqual(next.vectorAssets!.hero,p.vectorAssets!.hero);assert.deepEqual(next.vectorAssets!.drum,p.vectorAssets!.drum);
  assert.ok(next.vectorAssets!.newNote!.nodes.some(n=>n.id===FOLK_INK_STYLE));
  assert.ok(next.vectorStages!.village!.nodes.some(n=>n.id===FOLK_INK_STYLE));
});
