import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {natureLayout,natureScenery,NATURE_SCENERY_VERSION,type NatureLayout} from './canvasSceneryNature';
import {parseVectorPlan,applyVectorRepairs,applyVectorRedesign,buildVectorRepairContent} from './canvasVectorDirector';
import {normalizeVectorAssets,normalizeVectorScene,evaluateVectorPart} from '../../shared/canvasVectorScene';
import {vectorPoint,vectorWorldMatrix} from '../../shared/canvasVectorTransform';

const frame={width:1280,height:720};
const combinations:NatureLayout[]=[{water:'waterfall',seed:117},{terrain:'gorge',water:'stream',bridge:true,vegetation:'bamboo',light:'dusk',seed:421},
 {terrain:'cliffs',water:'river',vegetation:'pine',composition:'left',seed:319},{terrain:'rolling',water:'river',vegetation:'bamboo',composition:'right',seed:841}];
function parsed(options:NatureLayout={water:'waterfall'}){
 return parseVectorPlan(JSON.stringify({vectorStages:{woods:{template:'nature-landscape',...options}},
  scenes:[{durationMs:2000,narration:'Quiet scenery.',vectorScene:{stage:'woods',camera:[{t:0,x:640,y:360,zoom:1}]}}]}),'[folk-horror]',frame);
}

test('new scenery combinations keep one native full-frame world without imported inset pictures',()=>{
 for(const options of combinations){
  const p=parsed(options),scene=p.scenes[0]!.vectorScene!,native=natureScenery(options,frame).stage;
  assert.ok(scene.nodes.some(n=>n.id===NATURE_SCENERY_VERSION));
  const world=scene.nodes.find(n=>n.id==='nature-world')!,source=native.nodes.find(n=>n.id==='nature-world')!;
  for(const key of ['x','y','scaleX','scaleY'] as const)assert.equal(world[key],source[key]);
  assert.equal(scene.nodes.find(n=>n.id==='sky')!.width,1280);
  assert.equal(scene.nodes.find(n=>n.id==='sky')!.height,720);
  assert.ok(!scene.nodes.some(n=>/approved-courtyard|illustrated-world|house|wall-plank/.test(n.id)));
  assert.ok(!scene.nodes.some(n=>n.type==='instance'&&n.id!=='person'),'no pasted full-landscape SVG asset');
  for(const n of native.nodes.filter(n=>n.id.startsWith('scenery-'))){
   const actual=scene.nodes.find(p=>p.id===n.id)!;
   assert.equal(actual.d,n.d,'native pressure contours are not distorted a second time');
   assert.equal(actual.fill,n.fill,'horror readability cannot bleach native ink');
  }
 }
});

test('the same pen composes different terrain/hydrology/planting and stable seeded variants',()=>{
 const a=natureScenery(combinations[0]),b=natureScenery({...combinations[0],seed:118});
 assert.deepEqual(a,natureScenery(combinations[0]));
 assert.notDeepEqual(a.stage.nodes,b.stage.nodes);
 const sets=combinations.map(o=>new Set(natureScenery(o).stage.nodes.map(n=>n.id)));
 assert.ok(sets[0]!.has('waterfall')&&sets[0]!.has('pool')&&!sets[0]!.has('bridge'));
 assert.ok(sets[1]!.has('bridge')&&sets[1]!.has('rock-ledges')&&!sets[1]!.has('waterfall'));
 assert.ok(sets[2]!.has('pine-tree')&&sets[2]!.has('river-water')&&!sets[2]!.has('bridge'));
 assert.ok(sets[3]!.has('stream')&&!sets[3]!.has('rock-ledges'));
});

test('woodland separates the quiet distant forest from detailed near crowns without a default daylight mist stripe',()=>{
 for(const seed of [0,451,7391,99999])for(const size of [frame,{width:720,height:1280}]){
  const p=natureScenery({water:'none',vegetation:'mixed',seed},size),nodes=normalizeVectorScene(p.stage,normalizeVectorAssets(p.assets)).nodes;
  assert.ok(nodes.length<512);
  for(const n of nodes)if(n.d)assert.ok(n.d.length<=8000,n.id);
  const firs=nodes.find(n=>n.id==='scenery-forest-firs')!;
  assert.ok(firs.strokeWidth!<1.1,'background firs must not have foreground outlines');
  assert.ok(nodes.findIndex(n=>n.id==='scenery-hills-near')>nodes.indexOf(firs),'undergrowth occludes distant tree bases');
  assert.equal(nodes.find(n=>n.id==='valley-mist')!.opacity,0);
  assert.ok(nodes.some(n=>n.id==='scenery-edge-tree-1-crown-tip-left'));
  assert.ok(nodes.some(n=>n.id==='scenery-edge-tree-1-vine'));
  assert.ok(nodes.some(n=>n.id==='scenery-ground-leaf-litter'));
 }
});

test('nature descriptor validation rejects invented or physically unsupported inputs',()=>{
 for(const bad of [{seed:1.5},{seed:100000},{terrain:'volcano'},{vegetation:'palm'},{light:'pitch-black'},{bridge:'yes'},{bridge:true,water:'none'}])
  assert.throws(()=>natureLayout(bad),/Vector:/);
});

test('native water connects crest, impact and pool; bridge has both bank supports',()=>{
 const fall=natureScenery({water:'waterfall'}).stage.nodes;
 const curtain=fall.find(n=>n.id==='waterfall')!.bounds!,pool=fall.find(n=>n.id==='pool')!.bounds!;
 assert.ok(curtain.y<pool.y&&curtain.y+curtain.height>pool.y,'fall reaches its actual receiving pool');
 const bridge=natureScenery({terrain:'gorge',water:'stream',bridge:true}).stage.nodes;
 assert.equal(bridge.find(n=>n.id==='rock-ledges')!.parent,'cliff','screenplay cliff context resolves the real banks; repair must not invent replacement pillars');
 for(const name of ['bridge-foot-left','bridge-foot-right','bridge-underbeam','bridge-board-0','bridge-post-0'])
  assert.equal(bridge.find(n=>n.id==='scenery-'+name)!.parent,'bridge');
 assert.ok(bridge.find(n=>n.id==='bridge')!.groundAnchor);
});

test('landscape and portrait stay within parser budget and keep grounded actor proportions',()=>{
 for(const size of [frame,{width:720,height:1280}])for(const options of combinations){
  const p=natureScenery(options,size),assets=normalizeVectorAssets(p.assets),drawing=normalizeVectorScene(p.stage,assets),scene={durationMs:2000,vectorScene:drawing,vectorAssetLibrary:assets} as any;
  assert.ok(drawing.nodes.length<512);
  for(const n of drawing.nodes)if(n.d)assert.ok(n.d.length<=8000,n.id);
  const world=drawing.nodes.find(n=>n.id==='nature-world')!,actor=drawing.nodes.find(n=>n.id==='person')!;
  assert.equal(world.scaleX,world.scaleY);
  const feet=vectorPoint(vectorWorldMatrix('person',scene,0,assets),90,280),localFloor=620+(actor.groundOffsetY??0);
  assert.ok(Math.abs(feet.y-((world.y??0)+localFloor*world.scaleY!))<.1);
 }
});

test('foreground stream stones never paint across the bridge deck',()=>{
 for(const seed of [0,117,421,841,99999]){
  const nodes=natureScenery({terrain:'gorge',water:'stream',bridge:true,vegetation:'bamboo',seed}).stage.nodes;
  const deckY=nodes.find(n=>n.id==='bridge')!.groundAnchor!.y-20;
  for(const stone of nodes.filter(n=>/^scenery-water-stone-\d+$/.test(n.id))){
   const coords=stone.d!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
   const ys=coords.filter((_,i)=>i%2===1);
   assert.ok(Math.min(...ys)>deckY+24,'near stones sit below the deck instead of concealing its planks');
  }
 }
});

test('falling water sheets have soft edges and contact foam without black curtain outlines',()=>{
 for(const seed of [0,117,99999]){
  const nodes=natureScenery({water:'waterfall',seed}).stage.nodes;
  const sheets=nodes.filter(n=>/^scenery-fall-(ribbon|sheet-\d+)$/.test(n.id));
  assert.ok(sheets.length>1);
  for(const n of sheets)assert.equal(n.stroke,'none');
  assert.ok(!nodes.some(n=>/^scenery-fall-.*-ink-/.test(n.id)),'water edges do not acquire solid ink pressure contours');
  assert.ok(nodes.some(n=>n.id==='scenery-impact-spray'&&n.parent==='pool'));
 }
});

test('waterfall rock face is opaque behind both sides of the falling water at every height',async()=>{
 for(const seed of [0,117,841,99999])for(const composition of ['left','center','right'] as const){
  const nodes=natureScenery({water:'waterfall',seed,composition}).stage.nodes;
  const wall=nodes.find(n=>n.id==='scenery-cliff-backwall')!;
  assert.equal(wall.parent,'cliff');
  assert.equal(wall.opacity,undefined);
  assert.ok(nodes.indexOf(wall)<nodes.findIndex(n=>n.id==='waterfall'));
  const fall=nodes.find(n=>n.id==='waterfall')!.bounds!,pool=nodes.find(n=>n.id==='pool')!.bounds!;
  const focus=fall.x+92,crest=fall.y+25,impact=pool.y+12;
  const {data,info}=await sharp(Buffer.from(`<svg width="1280" height="720"><path fill="${wall.fill}" d="${wall.d}"/></svg>`)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(const dx of [-130,-110,-90,0,90,110,130])for(let y=crest+30;y<impact-10;y+=8){
   const alpha=data[(Math.round(y)*info.width+Math.round(focus+dx))*4+3];
   assert.equal(alpha,255,`background leak beside waterfall: seed ${seed}, ${composition}, x ${dx}, y ${y}`);
  }
  for(const dx of [-300,300])assert.equal(data[(Math.round(crest+140)*info.width+Math.round(focus+dx))*4+3],0,'backing stays inside the cliff; no unoutlined block beyond its exterior edge');
 }
});

test('visual repair cannot strip native scenery or replace it with flat polygons',()=>{
 const p=parsed(),s=p.scenes[0]!,allowed=new Set([s.id]),paint=s.vectorScene!.nodes.find(n=>n.id.startsWith('scenery-')&&n.fill!=='none')!;
 const patch=(vectorScenePatch:unknown)=>JSON.stringify({scenes:[{id:s.id,vectorScenePatch}]});
 assert.throws(()=>applyVectorRepairs(p,patch({nodes:[{id:paint.id,fill:'#ff00ff'}]}),allowed),/native nature paint is read-only/);
 assert.throws(()=>applyVectorRepairs(p,patch({removeNodes:[paint.id]}),allowed),/native nature paint is read-only/);
 assert.throws(()=>applyVectorRepairs(p,JSON.stringify({scenes:[{id:s.id,vectorScene:{width:1280,height:720,nodes:[{id:'flat',type:'rect',width:1280,height:720,fill:'#675'}],tracks:[]}}]}),allowed),/native nature paint is read-only/);
 const after=applyVectorRepairs(p,patch({tracks:[{target:'valley-mist',start:0,end:1,frames:[{t:0,opacity:.22},{t:1,opacity:0,dx:40}]}]}),allowed);
 assert.equal(evaluateVectorPart('valley-mist',after.scenes[0]!,2000).opacity,0);
 assert.equal(after.scenes[0]!.vectorScene!.nodes.find(n=>n.id===paint.id)!.d,paint.d);
 const content=JSON.parse(String(buildVectorRepairContent(p,[{sceneId:s.id,problem:'mist timing',fix:'adjust opacity'}],[])[0]!.text));
 assert.equal(content.scenes[0].vectorScene.nodes.find((n:any)=>n.id===paint.id).readOnly,true);
 assert.equal(content.scenes[0].vectorScene.nodes.find((n:any)=>n.id===paint.id).d,undefined);
 assert.ok(p.scenes[0]!.vectorScene!.nodes.find(n=>n.id===paint.id)!.d,'repair payload compaction does not change the real project');
});

test('redesign must preserve native nature or choose new shared grammar descriptors',()=>{
 const p=parsed(),before=JSON.stringify(p),s=p.scenes[0]!;
 const draft={vectorAssets:p.vectorAssets,vectorStages:{woods:{width:1280,height:720,nodes:[{id:'flat',type:'rect',width:1280,height:720,fill:'#675'}],tracks:[]}},scenes:[{id:s.id,vectorScene:{stage:'woods'}}]};
 assert.throws(()=>applyVectorRedesign(p,JSON.stringify(draft)),/native nature paint is read-only/);
 assert.equal(JSON.stringify(p),before);
});

test('a legitimate nature composition redesign uses the painter and keeps the existing cast',()=>{
 const p=parsed(),s=p.scenes[0]!;
 const after=applyVectorRedesign(p,JSON.stringify({vectorAssets:p.vectorAssets,vectorStages:{woods:{template:'nature-landscape',terrain:'rolling',water:'river',vegetation:'bamboo',seed:901}},scenes:[{id:s.id,vectorScene:{stage:'woods'}}]}));
 assert.ok(after.scenes[0]!.vectorScene!.nodes.some(n=>n.id==='stream'));
 assert.ok(!after.scenes[0]!.vectorScene!.nodes.some(n=>n.id==='waterfall'));
 assert.deepEqual(after.vectorAssets!['nature-person'],p.vectorAssets!['nature-person']);
});
