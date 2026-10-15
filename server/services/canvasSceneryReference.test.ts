import test from 'node:test';import assert from 'node:assert/strict';
import {settingScenery,settingLayout} from './canvasScenerySetting';
import {REFERENCE_SETTING_PLACES,REFERENCE_SETTING_VERSION} from './canvasSceneryReference';
import {parseVectorPlan} from './canvasVectorDirector';
import {normalizeVectorStory} from './canvasVectorStory';
import {vectorShotVisibility} from '../../shared/canvasVectorFraming';

test('all fourteen distinct requested locations compile through the production scenery boundary',()=>{
 for(const place of REFERENCE_SETTING_PLACES){
  const plan=JSON.stringify({vectorAssets:{},vectorStages:{site:{template:'folk-setting',place,seed:614,light:'day',composition:'center'}},scenes:[{durationMs:5000,narration:'Một cảnh tĩnh.',vectorDirection:{visibleCast:[]},vectorScene:{stage:'site',camera:[{t:0,x:640,y:360,zoom:1}]}}]});
  const p=parseVectorPlan(plan,'[folk-horror]',{width:1280,height:720},undefined,undefined,true);
  const scene=p.scenes[0]!.vectorScene!;
  assert.ok(scene.nodes.some(n=>n.id===REFERENCE_SETTING_VERSION),place+' must not fall back to a generic setting');
  assert.ok(scene.nodes.length<480,place+' leaves room for actors, framing and props');
  assert.equal(new Set(scene.nodes.map(n=>n.id)).size,scene.nodes.length);
  assert.equal(scene.nodes.filter(n=>n.id==='sky').length,1,'do not layer a second scenery background');
  const visibility=vectorShotVisibility(p.scenes[0]!,p.vectorAssets||{},'reference-layout',2000);
  assert.ok('visibleFraction' in visibility&&typeof visibility.visibleFraction==='number'&&visibility.visibleFraction>.8&&visibility.widthFraction===1&&visibility.heightFraction===1,'native set focus needs measurable full-frame bounds, including the caption-safe region');
  assert.deepEqual(settingScenery({place,seed:614}),settingScenery({place,seed:614}));
 }
});
test('distant waterfall belongs behind the path and retains a narrow measured extent',()=>{
 const n=settingScenery({place:'mountain-path'}).stage.nodes;
 const waterfall=n.find(n=>n.id==='distant-waterfall')!;
 assert.ok(waterfall.bounds!.width<50);assert.ok(waterfall.bounds!.x>750);
 assert.ok(n.indexOf(waterfall)<n.findIndex(n=>n.id==='stone-steps'));
 assert.ok(!n.some(n=>n.id==='waterfall-sheet'),'do not route a distant cascade to the giant waterfall scene');
});
test('indoor locations have their actual furniture, not the same generic table substituted',()=>{
 for(const [place,ids,absent] of [['shrine',['altar','terrain'],'bed'],['bedroom',['bed','window'],'altar'],['wood-room',['table','window','shelf','firewood'],'bed']] as const){
  const n=settingScenery({place}).stage.nodes;
  for(const id of ids)assert.ok(n.some(n=>n.id===id));
  assert.ok(!n.some(n=>n.id===absent));
 }
 assert.throws(()=>settingLayout({place:'invented-room'}),/invalid setting place/);
 const water=settingScenery({place:'night-house'}).stage.nodes;
 assert.equal(water.find(n=>n.id==='scenery-river-water')!.parent,'river-water','the named water group must own the real painted water');
 assert.equal(water.find(n=>n.id==='river-water')!.y,undefined,'metadata bounds must not translate the water a second time');
});

test('native night paint preserves round, bright celestial sources behind real occluders',()=>{
 for(const place of ['thatched-yard','cliff-path','night-house','bedroom'] as const){
  const n=settingScenery({place,light:'night',atmosphere:'mist'}).stage.nodes;
  assert.ok(!n.some(n=>n.id==='scenery-night-grade'),'a full-frame wash must not dim emitters');
  const moon=n.find(n=>n.id===(place==='bedroom'?'scenery-window-moon':'scenery-moon'))!;
  assert.equal(moon.rx,moon.ry);assert.ok(parseInt(moon.fill!.slice(1,3),16)>220);
  if(place==='bedroom'){
   assert.equal(n.find(p=>p.id===moon.parent)!.parent,'window');
   assert.ok(n.findIndex(p=>p.id==='scenery-window-lit-bar-3')>n.indexOf(moon));
  }else{
   assert.equal(moon.parent,'sky-light');
   assert.ok(n.indexOf(moon)<n.findIndex(p=>p.id.includes('-crown')),'actual tree geometry must occlude even a partial moon');
   assert.ok(n.find(p=>p.id==='ground-mist')!.atmosphere!.density>=.4);
  }
 }
 const lum=(c:string)=>[1,3,5].reduce((a,p)=>a+parseInt(c.slice(p,p+2),16),0)/3;
 for(const place of REFERENCE_SETTING_PLACES.filter(p=>p!=='village-map')){
  const day=settingScenery({place,light:'day'}),night=settingScenery({place,light:'night'});
  const paintId=place==='shrine'?'scenery-shrine-wall':['bedroom','wood-room'].includes(place)?'scenery-wood-wall':'sky';
  assert.ok(lum(night.stage.nodes.find(n=>n.id===paintId)!.fill!)<lum(day.stage.nodes.find(n=>n.id===paintId)!.fill!)*.55,place+' must have a genuinely dark night palette');
 }
 assert.ok(!settingScenery({place:'forest-path',light:'day',atmosphere:'clear'}).stage.nodes.some(n=>n.atmosphere));
});

test('fireflies are bounded, luminous, independently animated and absent in daylight',()=>{
 const {stage}=settingScenery({place:'mountain-path',light:'dusk'});
 const cores=stage.nodes.filter(n=>/^scenery-firefly-\d+-core$/.test(n.id));assert.equal(cores.length,8);
 assert.equal(stage.tracks.length,8);
 assert.equal(new Set(stage.tracks.map(t=>t.target)).size,8);
 for(const t of stage.tracks){
  for(const key of ['dx','dy','opacity'] as const)assert.ok(Math.abs(t.frames[0]![key]!-t.frames.at(-1)![key]!)<1e-9,'complete cycles must join without a cue boundary snap');
  assert.ok(t.frames.every(f=>Math.abs(f.dx!)<=12&&Math.abs(f.dy!)<=7));
  assert.ok(Math.max(...t.frames.map(f=>f.opacity!))-Math.min(...t.frames.map(f=>f.opacity!))>.4);
 }
 assert.ok(!settingScenery({place:'forest-path',light:'day'}).stage.nodes.some(n=>n.id==='fireflies'));
});

test('mountain steps keep a straight ascent with thin frontal edges',()=>{
 const nodes=settingScenery({place:'mountain-path'}).stage.nodes;
 for(let i=0;i<7;i++){
  const tread=nodes.find(n=>n.id==='scenery-step-'+i)!,riser=nodes.find(n=>n.id==='scenery-step-riser-'+i)!;
  const first=(n:typeof tread)=>n.d!.match(/^M([-0-9.]+) ([-0-9.]+)/)!.slice(1).map(Number);
  assert.deepEqual(first(tread),[326+i*73,687-i*34]);
  assert.deepEqual(first(riser),[330+i*73,696-i*34]);
  assert.equal(tread.parent,'stone-steps');assert.equal(riser.parent,'stone-steps');
 }
});

test('day and night native material variants cannot overwrite each other in a multi-location film',()=>{
 const day=settingScenery({place:'thatched-yard',light:'day'}),night=settingScenery({place:'thatched-yard',light:'night'});
 const planter=(s:typeof day)=>s.stage.nodes.find(n=>n.id==='yard-flower-left')!.asset!;
 assert.notEqual(planter(day),planter(night));
 const shared={...day.assets,...night.assets};
 assert.deepEqual(shared[planter(day)],day.assets[planter(day)]);
 assert.deepEqual(shared[planter(night)],night.assets[planter(night)]);
 const key=day.stage.nodes.find(n=>n.id==='house-wall')!.asset!;
 assert.deepEqual(shared[key],day.assets[key],'later night materials must preserve the original day paint');
});

test('material detail stays with its support and yard props leave the doorway lane clear',()=>{
 for(const place of ['thatched-yard','forest-path','bedroom','wood-room'] as const){
  const n=settingScenery({place}).stage.nodes;
  assert.equal(n.find(n=>n.id==='scenery-ground-grain')!.parent,'terrain');
  if(place==='wood-room'||place==='bedroom')assert.equal(n.find(n=>n.id==='scenery-wall-wood-grain')!.parent,'walls');
 }
 const n=settingScenery({place:'thatched-yard'}).stage.nodes,door=n.find(n=>n.id==='house-door')!;
 const table=n.find(n=>n.id==='yard-offering-table')!.bounds!,tools=n.find(n=>n.id==='yard-tools')!.bounds!;
 assert.ok(table.x+table.width<door.x!);assert.ok(tools.x>door.x!+door.width!);
 for(const id of ['large','mid','small'])assert.ok(settingScenery({place:'forest-path'}).stage.nodes.some(n=>n.id===`scenery-forest-rock-${id}-contact`));
});
test('empty scenery hold recovers its declared focus without inventing participants or weakening motion validation',()=>{
 const shot=(id:string)=>({id,name:'Empty setting',durationMs:5000,narration:`Một cảnh tĩnh không có người bên trong sân nhà ${id}.`,purpose:'Hold the empty set',location:'yard',visibleCast:[],heldProps:[],propEvents:[],shot:{size:'wide',framing:'context',focus:'reference-layout',include:[]},beats:[{cue:'Một cảnh tĩnh',kind:'hold',targets:[],motionTargets:[],before:'Empty set',after:'Empty set'}]});
 const raw={name:'Scenery catalog',premise:'Empty set study',stakes:'Show the setting',turn:'Change settings',ending:'Hold the last set',cast:[],shots:[shot('one'),shot('two')]};
 const result=normalizeVectorStory(raw,10,{requireVisibleCast:true});
 assert.deepEqual(result.shots[0]!.beats[0]!.targets,['reference-layout']);
 assert.deepEqual(result.cast,[]);assert.deepEqual(result.shots[0]!.visibleCast,[]);
 raw.shots[0]!.beats[0]!.kind='motion';raw.shots[0]!.beats[0]!.after='A different state';
 assert.throws(()=>normalizeVectorStory(raw,10),/visible participants/);
});
