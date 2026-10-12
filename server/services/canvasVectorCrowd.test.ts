import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVectorPlan} from './canvasVectorDirector';
import {compileVectorProject,evaluateVectorPart} from '../../shared/canvasVectorScene';
import {vectorPoint,vectorWorldMatrix} from '../../shared/canvasVectorTransform';

const plan=()=>({vectorAssets:{
  hero:{rig:'simple-puppet',outfit:'robe',hair:'side-part'},
  vendor:{rig:'simple-puppet',outfit:'vest',hair:'none',headwear:'conical'},
  elder:{rig:'simple-puppet',outfit:'shawl',hair:'tied',facialHair:'beard',palette:{hair:'#bbbbbb'}},
},vectorStages:{village:{template:'illustrated-place',place:'village',cast:{person:'hero'},extras:[
  {id:'seller',asset:'vendor',x:460,footY:875,height:130},
  {id:'listener',asset:'elder',x:80,footY:925,height:175},
]}},scenes:[0,1].map(()=>({durationMs:4000,narration:'People wait in the village.',vectorScene:{stage:'village'}}))});

test('native extras retain distinct models, depth planes and world placements through fixed cuts',()=>{
  for(const size of [{width:720,height:1280},{width:1280,height:720}]){
    const input=plan(),before=structuredClone(input),p=parseVectorPlan(JSON.stringify(input),'village',size);
    assert.deepEqual(input,before);
    const first=p.scenes[0]!;
    for(const [id,footY]of [['seller',875],['listener',925]] as const){
      const n=first.vectorScene!.nodes.find(n=>n.id===id)!;
      const expected=n.parent?vectorPoint(vectorWorldMatrix(n.parent,first,0,p.vectorAssets),n.x!+n.width!/2,footY):{x:n.x!+n.width!/2,y:footY};
      const actual=vectorPoint(vectorWorldMatrix(id,first,0,p.vectorAssets),90,280);
      assert.ok(Math.hypot(expected.x-actual.x,expected.y-actual.y)<1e-6,JSON.stringify({n,expected,actual,size}));
      assert.deepEqual(vectorWorldMatrix(id,first,0,p.vectorAssets),vectorWorldMatrix(id,p.scenes[1]!,0,p.vectorAssets));
      assert.ok(first.vectorScene!.nodes.findIndex(n=>n.id===id)<first.vectorScene!.nodes.findIndex(n=>n.id==='person'));
    }
    assert.ok(p.vectorAssets!.vendor!.nodes.some(n=>n.id==='headwear'));
    assert.ok(p.vectorAssets!.elder!.nodes.some(n=>n.id==='beard'));
    assert.deepEqual(compileVectorProject(p),p);
    // An explicitly empty view still excludes the background cast.
    for(const s of p.scenes)s.vectorDirection={purpose:'empty view',location:'village',visibleCast:[],shot:{size:'wide',focus:'person',include:[]},beats:[]};
    const empty=compileVectorProject(p);
    for(const s of empty.scenes)for(const id of ['person','seller','listener'])assert.equal(s.vectorScene!.nodes.find(n=>n.id===id)!.opacity,0);
  }
});

test('stage extras reject duplicate identities, unavailable models and invalid depth placement',()=>{
  for(const patch of [{id:'person'},{asset:'missing'},{height:NaN},{footY:2000}]){
    const p=plan();Object.assign(p.vectorStages.village.extras[0]!,patch);
    assert.throws(()=>parseVectorPlan(JSON.stringify(p),'village',{width:1280,height:720}),/background actor/);
  }
});

test('a passing extra travels on its own depth plane while others hold and blink independently',()=>{
  const input=plan();
  Object.assign(input.scenes[0]!.vectorScene,{walks:[{actor:'seller',to:'person',gap:100,start:.1,end:.8}]});
  Object.assign(input.scenes[1]!.vectorScene,{walks:[{actor:'seller',to:'person',gap:100,hold:true}]});
  const p=parseVectorPlan(JSON.stringify(input),'village',{width:1280,height:720});
  const s=p.scenes[0]!;
  const feet=(time:number)=>vectorPoint(vectorWorldMatrix('seller',s,time,p.vectorAssets),90,280);
  assert.notEqual(feet(0).x,feet(3600).x);
  assert.equal(feet(0).y,feet(3600).y);
  assert.deepEqual(vectorWorldMatrix('seller',s,3999,p.vectorAssets),vectorWorldMatrix('seller',p.scenes[1]!,0,p.vectorAssets));
  const blinks=['person','seller','listener'].map(id=>s.vectorScene!.tracks.find(t=>t.target===id+'/blink')!.start);
  assert.equal(new Set(blinks).size,3);
  assert.equal(evaluateVectorPart('listener',s,0).dx,evaluateVectorPart('listener',s,3999).dx);
  assert.deepEqual(compileVectorProject(p),p);
});

test('passing compact actors face their route; backing away keeps facing',()=>{
  const input=plan();
  Object.assign(input.scenes[0]!.vectorScene,{walks:[{actor:'seller',to:'listener',gap:70,start:.1,end:.8}]});
  const p=parseVectorPlan(JSON.stringify(input),'village',{width:1280,height:720}),s=p.scenes[0]!;
  assert.ok(evaluateVectorPart('seller',s,3500).dx<0);
  assert.equal(evaluateVectorPart('seller/upper-body',s,3500).scaleX,-1);
  assert.deepEqual(compileVectorProject(p),p);
  Object.assign(input.scenes[0]!.vectorScene,{walks:[{actor:'seller',to:'listener',backstep:40,start:.1,end:.8}]});
  const back=parseVectorPlan(JSON.stringify(input),'village',{width:1280,height:720}).scenes[0]!;
  assert.equal(evaluateVectorPart('seller/upper-body',back,3500).scaleX,1);
});

test('market extras remain in their world through a reaction crop; empty views and departures stay explicit',()=>{
  const input=plan();
  Object.assign(input.vectorStages.village,{setting:'market',finish:'handdrawn',view:'elevated'});
  const p=parseVectorPlan(JSON.stringify(input),'market',{width:1280,height:720});
  p.scenes.forEach((s,i)=>{s.vectorDirection={purpose:'same market',location:'village',visibleCast:i?['person']:['person','seller','listener'],shot:{size:i?'reaction':'wide',focus:'person',include:[]},beats:[]};});
  const fixed=compileVectorProject(p),reaction=fixed.scenes[1]!;
  for(const id of ['seller','listener']){
    assert.equal(reaction.vectorScene!.nodes.find(n=>n.id===id)!.opacity,1);
    assert.ok(reaction.vectorDirection!.visibleCast!.includes(id));
  }
  assert.deepEqual(compileVectorProject(fixed),fixed);
  p.scenes[1]!.vectorDirection!.visibleCast=[];
  assert.equal(compileVectorProject(p).scenes[1]!.vectorScene!.nodes.find(n=>n.id==='seller')!.opacity,0);
  p.scenes[1]!.vectorDirection!.visibleCast=['person'];p.scenes[1]!.vectorDirection!.continuity='reset';
  assert.equal(compileVectorProject(p).scenes[1]!.vectorScene!.nodes.find(n=>n.id==='seller')!.opacity,0);
});
