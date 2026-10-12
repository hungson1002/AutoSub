import test from 'node:test';
import assert from 'node:assert/strict';
import {parseVectorPlan} from './canvasVectorDirector';
import {compileVectorProject,evaluateVectorPart,normalizeVectorScene} from '../../shared/canvasVectorScene';
import {vectorEnsembleCoverage} from '../../shared/canvasVectorEnsemble';
import {vectorPoint,vectorWorldMatrix} from '../../shared/canvasVectorTransform';
import {normalizeVectorStory,vectorDirectionIssues} from './canvasVectorStory';

function film(market=true){
  const raw={vectorAssets:{hero:{rig:'simple-puppet',design:'village',finish:'handdrawn',hair:'short'}},vectorStages:{village:{template:'illustrated-place',place:'village',setting:market?'market':'residential',view:'elevated',finish:'handdrawn',cast:{person:'hero'},extras:Array.from({length:8},(_,i)=>({id:i<2?'vendor-'+i:'shopper-'+i,asset:'hero',...(market?{}:{x:-300+i*180,footY:900+i*20,height:120})}))}},scenes:Array.from({length:4},(_,i)=>({id:'shot-'+i,durationMs:8000,narration:'People browse the market. A traveler waits.',vectorScene:{stage:'village'}}))};
  const p=parseVectorPlan(JSON.stringify(raw),'market',{width:1280,height:720});
  for(const s of p.scenes)s.vectorDirection={purpose:'busy market',location:'village',visibleCast:['person',...raw.vectorStages.village.extras.map(n=>n.id)],shot:{size:'wide',focus:'person',include:[]},beats:[{kind:'hold',cue:'A traveler waits.',targets:['person'],motionTargets:[],before:'waiting',after:'waiting'}]};
  return p;
}

test('a sparse AI market becomes sustained, staggered secondary activity through every shot',()=>{
  const input=film(),before=structuredClone(input),p=compileVectorProject(input);
  assert.deepEqual(input,before);
  for(const s of p.scenes){
    const c=vectorEnsembleCoverage(s,p.vectorAssets!);
    assert.ok(c.activeFraction>.7,JSON.stringify({id:s.id,...c}));
    assert.ok(c.multipleFraction>.3,JSON.stringify({id:s.id,...c}));
    assert.ok(s.vectorScene!.tracks.some(t=>t.ensemble&&t.target.startsWith('vendor-')));
    assert.ok(s.vectorScene!.tracks.some(t=>t.ensemble&&/^shopper-\d$/.test(t.target)));
    assert.ok(!s.vectorScene!.tracks.some(t=>t.ensemble&&t.target.startsWith('person')));
    assert.ok(s.vectorScene!.tracks.every(t=>t.frames.length<=32));
  }
  assert.deepEqual(compileVectorProject(p),p,'recompilation must not accumulate generated actions or shift their phase');
  const frozen=structuredClone(p);
  for(const s of frozen.scenes)s.vectorScene!.tracks=s.vectorScene!.tracks.filter(t=>!t.ensemble);
  assert.ok(vectorDirectionIssues(frozen).some(i=>i.problem.includes('ensemble is inactive')),'a frozen ensemble must fail despite blinking people and a valid camera');
});

test('root, body, head and hands retain their actual phase across camera cuts',()=>{
  const input=film();
  for(const s of input.scenes)s.vectorDirection!.backgroundActions=[{actor:'vendor-0',activity:'attend'},{actor:'shopper-2',activity:'pass'},{actor:'shopper-4',activity:'pass'}];
  const p=compileVectorProject(input);
  for(let i=1;i<p.scenes.length;i++)for(const id of ['vendor-0','shopper-2','shopper-4'])for(const part of ['', '/upper-body','/head-group','/hand-l','/hand-r']){
    const a=evaluateVectorPart(id+part,p.scenes[i-1]!,8000),b=evaluateVectorPart(id+part,p.scenes[i]!,0);
    for(const key of ['dx','dy','rotation','scaleX','opacity'] as const)assert.ok(Math.abs(a[key]-b[key])<1e-7,JSON.stringify({id,part,i,key,a,b}));
  }
  for(const s of p.scenes)for(const id of ['shopper-2','shopper-4']){
    const n=s.vectorScene!.nodes.find(n=>n.id===id)!,rig=p.vectorAssets![n.asset!]!;
    const feet=Array.from({length:33},(_,i)=>vectorPoint(vectorWorldMatrix(id,s,i*250,p.vectorAssets),rig.width/2,rig.height));
    assert.ok(Math.max(...feet.map(p=>p.y))-Math.min(...feet.map(p=>p.y))<1e-7,'root remains on its depth plane');
  }
});

test('a visit approaches the actual seller, pauses for alternating gestures, leaves once and survives cuts',()=>{
  const input=film();
  for(const s of input.scenes){
    const buyer=s.vectorScene!.nodes.find(n=>n.id==='shopper-2')!,seller=s.vectorScene!.nodes.find(n=>n.id==='vendor-0')!;
    Object.assign(buyer,{x:200,y:900,width:70,height:110,groundOffsetY:20});
    Object.assign(seller,{x:450,y:940,width:70,height:110,groundOffsetY:60});
    s.vectorDirection!.backgroundActions=[{actor:'shopper-2',activity:'visit',partner:'vendor-0'},{actor:'vendor-0',activity:'attend'}];
  }
  const p=compileVectorProject(input);
  const pose=(target:string,ms:number)=>evaluateVectorPart(target,p.scenes[Math.min(3,Math.floor(ms/8000))]!,ms%8000);
  const samples=Array.from({length:300},(_,i)=>({ms:i*100,root:pose('shopper-2',i*100),buyer:pose('shopper-2/hand-r',i*100),seller:pose('vendor-0/hand-l',i*100)}));
  const furthest=Math.max(...samples.map(s=>s.root.dx));
  assert.ok(furthest>100&&furthest<200,'customer stops short of the seller instead of walking through them');
  const arrival=samples.find(s=>Math.abs(s.root.dx-furthest)<.01)!;
  assert.ok(Math.abs(arrival.root.dy-40)<.01,'arrival follows the seller depth plane');
  assert.ok(samples.some(s=>s.buyer.opacity>.8));
  assert.ok(samples.some(s=>s.seller.opacity>.8));
  assert.ok(samples.find(s=>s.buyer.opacity>.5)!.ms<samples.find(s=>s.seller.opacity>.5)!.ms,'seller answers after the customer');
  for(const s of samples)if(s.root.dx>5&&s.root.dx<furthest-5)assert.ok(s.buyer.opacity<.1,'no greeting hand while walking');
  assert.ok(Math.abs(pose('shopper-2',29000).dx)<.01,'customer leaves instead of endlessly oscillating');
  for(let i=1;i<4;i++)for(const target of ['shopper-2','shopper-2/upper-body','shopper-2/hand-r','vendor-0/upper-body','vendor-0/hand-l']){
    const a=evaluateVectorPart(target,p.scenes[i-1]!,8000),b=evaluateVectorPart(target,p.scenes[i]!,0);
    for(const key of ['dx','dy','rotation','scaleX','opacity'] as const)assert.ok(Math.abs(a[key]-b[key])<1e-7,JSON.stringify({target,i,key,a,b}));
  }
  assert.deepEqual(compileVectorProject(p),p);
});

test('consecutive actor IDs have visibly different activity timing, not millisecond-offset synchronization',()=>{
  const p=film();
  for(const s of p.scenes)s.vectorDirection!.backgroundActions=['vendor-0','vendor-1','shopper-2','shopper-3'].map(actor=>({actor,activity:'attend'}));
  const s=compileVectorProject(p).scenes[0]!;
  const onsets=['vendor-0','vendor-1','shopper-2','shopper-3'].map(id=>{
    for(let ms=0;ms<4000;ms+=50)if(Math.abs(evaluateVectorPart(id+'/head-group',s,ms).rotation)>.5)return ms;
    throw new Error('Missing purposeful look '+id);
  });
  assert.ok(new Set(onsets).size>=3,JSON.stringify(onsets));
  assert.ok(Math.max(...onsets)-Math.min(...onsets)>=400,JSON.stringify(onsets));
});

test('authored actions, deliberate still crowds and invisible people never get random motion',()=>{
  const input=film();
  input.scenes[0]!.vectorDirection!.backgroundActions=[];
  input.scenes[1]!.vectorDirection!.backgroundActions=[{actor:'shopper-2',activity:'hold'}];
  input.scenes[2]!.vectorDirection!.visibleCast=[];
  input.scenes[3]!.vectorDirection!.beats.push({cue:'People browse',kind:'motion',targets:['shopper-2'],motionTargets:['shopper-2/head-group'],before:'left',after:'right'});
  const p=compileVectorProject(input);
  for(const s of p.scenes.slice(0,3))assert.equal(s.vectorScene!.tracks.some(t=>t.ensemble),false);
  assert.equal(p.scenes[3]!.vectorScene!.tracks.some(t=>t.ensemble&&t.target.startsWith('shopper-2')),false);
});

test('explicit tasks work with arbitrary cast IDs outside a market and survive normalizing',()=>{
  const input=film(false);
  for(const s of input.scenes)s.vectorDirection!.backgroundActions=[{actor:'shopper-2',activity:'pass'},{actor:'vendor-0',activity:'attend',partner:'shopper-2'}];
  const p=compileVectorProject(input);
  for(const s of p.scenes){
    assert.ok(s.vectorScene!.tracks.some(t=>t.ensemble&&t.target==='shopper-2'));
    assert.doesNotThrow(()=>normalizeVectorScene(s.vectorScene,p.vectorAssets!,s.narration));
  }
  assert.deepEqual(compileVectorProject(p),p);
});

test('omitted repeated tasks retain the assigned activity through cuts; a reset starts a new sequence',()=>{
  const input=film(false);
  input.scenes[0]!.vectorDirection!.backgroundActions=[{actor:'shopper-2',activity:'pass'}];
  input.scenes[3]!.vectorDirection!.continuity='reset';
  const p=compileVectorProject(input);
  for(const s of p.scenes.slice(0,3))assert.ok(s.vectorScene!.tracks.some(t=>t.ensemble&&t.target==='shopper-2'));
  assert.equal(p.scenes[3]!.vectorScene!.tracks.some(t=>t.ensemble),false);
  assert.deepEqual(compileVectorProject(p),p);
});

test('ensemble travel keeps occupied hands and the exact carried prop grip',()=>{
  const p=film(),s=p.scenes[0]!;
  // Occupied hand movement stays authored even while the body walks.
  p.vectorAssets!.lamp={width:20,height:30,nodes:[{id:'lamp-shape',type:'rect',width:20,height:30,fill:'#eed17c'}]};
  for(const scene of p.scenes){
    scene.vectorScene!.nodes.push({id:'lamp',type:'instance',asset:'lamp',attachTo:'shopper-2/hand-r',x:-10,y:-3,pivotX:10,pivotY:3,pivotSpace:'local',width:20,height:30,hang:true});
    scene.vectorDirection!.heldProps=[{actor:'shopper-2',arm:'r',prop:'lamp',hang:true}];
  }
  const fixed=compileVectorProject(p);
  for(const scene of fixed.scenes){
    assert.equal(scene.vectorScene!.tracks.some(t=>t.ensemble&&t.target==='shopper-2/hand-r'),false);
    for(const ms of [0,2000,6000]){
      const grip=vectorPoint(vectorWorldMatrix('lamp',scene,ms,fixed.vectorAssets),10,3);
      const hand=vectorPoint(vectorWorldMatrix('shopper-2/hand-r',scene,ms,fixed.vectorAssets),0,0);
      assert.ok(Math.hypot(grip.x-hand.x,grip.y-hand.y)<1e-7);
    }
  }
  assert.deepEqual(compileVectorProject(fixed),fixed);
});

test('an authored route reverses the held facing at departure rather than at the cut',()=>{
  const p=film();
  p.scenes[0]!.vectorScene!.tracks.push({target:'person/upper-body',start:0,end:1,frames:[{t:0,scaleX:-1}]});
  p.scenes[1]!.vectorScene!.tracks.push(
    {target:'person',start:.2,end:.8,frames:[{t:0,dx:0},{t:1,dx:70}]},
    {target:'person/upper-body',start:.2,end:.8,frames:[{t:0,scaleX:1},{t:1,scaleX:1}]});
  const fixed=compileVectorProject(p),s=fixed.scenes[1]!;
  assert.equal(evaluateVectorPart('person/upper-body',s,0).scaleX,-1);
  assert.equal(evaluateVectorPart('person/upper-body',s,2000).scaleX,1);
  assert.deepEqual(compileVectorProject(fixed),fixed);
});

test('a saved departure flip and constant seller pose rejoin the new visit facing instead of resetting at a cut',()=>{
  const p=film();
  for(const s of p.scenes)s.vectorDirection!.backgroundActions=[{actor:'shopper-2',activity:'visit',partner:'vendor-0'},{actor:'vendor-0',activity:'attend'}];
  const previous=compileVectorProject(p);
  const last=p.scenes[3]!,held=evaluateVectorPart('shopper-2/upper-body',previous.scenes[2]!,8000).scaleX;
  last.vectorDirection!.beats.push({kind:'travel',cue:'People browse',targets:['shopper-2'],motionTargets:['shopper-2'],before:'Near seller',after:'On road'});
  last.vectorScene!.tracks.push({target:'shopper-2',start:.2,end:.8,cue:'People browse',frames:[{t:0,dx:20},{t:1,dx:90}]},
    {target:'shopper-2/upper-body',start:.2,end:.3,cue:'People browse',frames:[{t:0,scaleX:-held,easing:'hold'},{t:1,scaleX:held,easing:'hold'}]},
    {target:'vendor-0/upper-body',start:0,end:1,frames:[{t:0,scaleX:-evaluateVectorPart('vendor-0/upper-body',previous.scenes[2]!,8000).scaleX}]});
  const fixed=compileVectorProject(p);
  for(const id of ['shopper-2','vendor-0'])assert.equal(evaluateVectorPart(id+'/upper-body',fixed.scenes[3]!,0).scaleX,evaluateVectorPart(id+'/upper-body',fixed.scenes[2]!,8000).scaleX);
  assert.deepEqual(compileVectorProject(fixed),fixed);
});

test('screenplay keeps executable background tasks and rejects invented or duplicate partners',()=>{
  const shot=(i:number)=>({id:'s'+i,name:'market',durationMs:5000,narration:'The villagers pass a traveler who waits beside the '+(i?'stall.':'gate.'),purpose:'busy market',location:'village',visibleCast:['person','buyer'],shot:{size:'wide',focus:'person',include:[]},backgroundActions:[{actor:'buyer',activity:'pass',partner:'person'}],beats:[{cue:'The villagers pass',kind:'travel',targets:['buyer'],motionTargets:['buyer'],before:'left',after:'right'}]});
  const raw={name:'Market',premise:'A visitor',stakes:'A warning',turn:'A discovery',ending:'A footprint',cast:['person','buyer'].map(id=>({id,role:id,design:'compact'})),shots:[shot(0),shot(1)]};
  assert.deepEqual(normalizeVectorStory(raw,10).shots[0]!.backgroundActions,raw.shots[0]!.backgroundActions);
  raw.shots[0]!.backgroundActions[0]!.activity='visit';
  assert.equal(normalizeVectorStory(raw,10).shots[0]!.backgroundActions![0]!.activity,'visit');
  delete (raw.shots[0]!.backgroundActions[0] as {partner?:string}).partner;
  assert.throws(()=>normalizeVectorStory(raw,10),/background task/);
  raw.shots[0]!.backgroundActions[0]!.partner='invented';
  assert.throws(()=>normalizeVectorStory(raw,10),/background task/);
});
