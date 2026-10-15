import test from 'node:test';import assert from 'node:assert/strict';import sharp from 'sharp';
import courtyard from '../assets/vector-styles/folk-horror/approved-courtyard/drawing.json';
import {settingScenery} from './canvasScenerySetting';
import {normalizeVectorAssets,normalizeVectorScene} from '../../shared/canvasVectorScene';
import {vectorPoint,vectorWorldMatrix} from '../../shared/canvasVectorTransform';
import {parseVectorPlan,applyVectorRepairs} from './canvasVectorDirector';

test('riverside keeps imported approved construction intact inside its own new scene',()=>{
 const source=JSON.stringify(courtyard),p=settingScenery({place:'riverside',light:'day',seed:614});
 for(const part of ['house','door-opening','door-leaf','roof','straw'] as const)for(const [i,n] of courtyard.parts[part].entries()){
  const actual=p.stage.nodes.find(node=>node.id===`scenery-riverside-house-${part}-${i}`)!;
  assert.equal(actual.d,n.d);assert.equal(actual.fill,n.fill);
 }
 assert.equal(JSON.stringify(courtyard),source);
 assert.ok(!p.stage.nodes.some(n=>/^scenery-riverside-house-(sky|earth|backdrop)/.test(n.id)),'only construction is reused, not a pasted courtyard background');
 assert.deepEqual(p,settingScenery({place:'riverside',light:'day',seed:614}));
});

test('riverside supports and relative depth survive framing, lighting and composition',()=>{
 for(const frame of [{width:1280,height:720},{width:720,height:1280}])for(const light of ['day','dusk','night'] as const)for(const composition of ['left','center','right'] as const){
  const p=settingScenery({place:'riverside',seed:614,light,composition},frame),assets=normalizeVectorAssets(p.assets),drawing=normalizeVectorScene(p.stage,assets);
  const scene:any={durationMs:4000,vectorScene:drawing,vectorAssetLibrary:assets};
  assert.ok(drawing.nodes.length<512);assert.equal(new Set(drawing.nodes.map(n=>n.id)).size,drawing.nodes.length);
  for(const n of drawing.nodes)if(n.d)assert.ok(n.d.length<=8000);
  const world=drawing.nodes.find(n=>n.id==='folk-setting-world')!;
  const feet=vectorPoint(vectorWorldMatrix('person',scene,0,assets),90,280);
  assert.ok(Math.abs(feet.y-((world.y??0)+620*world.scaleY!))<.01);
  const house=vectorPoint(vectorWorldMatrix('house-left',scene,0,assets),215,545);
  assert.ok(Math.abs(house.y-((world.y??0)+463*world.scaleY!))<.01);
  assert.ok(drawing.nodes.find(n=>n.id==='tree-left')!.scaleY!>drawing.nodes.find(n=>n.id==='far-tree')!.scaleY!*2.5);
  assert.ok(new Set(drawing.nodes.filter(n=>n.id.startsWith('scenery-riverside-house')).map(n=>n.fill)).size>4,'wood, straw and ink keep distinct values after lighting');
 }
});

test('landing actually connects dry land to water and story supports touch the deck',async()=>{
 const p=settingScenery({place:'riverside'}),water=p.stage.nodes.find(n=>n.id==='scenery-river-surface')!,deck=p.stage.nodes.find(n=>n.id==='scenery-pier-deck')!;
 const mask=async(d:string)=>(await sharp(Buffer.from(`<svg width="1280" height="720"><path d="${d}" fill="black"/></svg>`)).ensureAlpha().raw().toBuffer());
 const wet=await mask(water.d!),wood=await mask(deck.d!),alpha=(b:Buffer,x:number,y:number)=>b[(y*1280+x)*4+3]!;
 assert.equal(alpha(wet,720,515),0);assert.equal(alpha(wood,720,515),255,'pier begins on the actual land');
 assert.equal(alpha(wet,932,574),255);assert.equal(alpha(wood,932,574),255,'thin frontal pier ends over the actual river');
 assert.equal(alpha(wood,p.supports.dock!.x,p.supports.dock!.y),255);
 for(const x of [155,360,565])assert.equal(alpha(wet,x,620),0,'floor support stays on the dry bank');
});

test('normal Studio parser expands the landing and prevents replacement of its native paint',()=>{
 const p=parseVectorPlan(JSON.stringify({vectorStages:{landing:{template:'folk-setting',place:'riverside',light:'day',seed:614}},scenes:[{durationMs:4000,narration:'Bến sông bên ngôi nhà gỗ.',vectorScene:{stage:'landing',camera:[{t:0,x:640,y:360,zoom:1}]}}]}),'[folk-horror]',{width:1280,height:720});
 const scene=p.scenes[0]!;
 for(const id of ['house-left','river-water','river-bank','lane','dock','boat'])assert.ok(scene.vectorScene!.nodes.some(n=>n.id===id));
 assert.throws(()=>applyVectorRepairs(p,JSON.stringify({scenes:[{id:scene.id,vectorScenePatch:{removeNodes:['scenery-pier-deck']}}]}),new Set([scene.id])),/native (nature|setting) paint is read-only/);
});
