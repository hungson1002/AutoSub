import test from 'node:test';import assert from 'node:assert/strict';
import {settingScenery} from './canvasScenerySetting';
import {normalizeVectorAssets,normalizeVectorScene,type VectorNode} from '../../shared/canvasVectorScene';
import {vectorPoint,vectorWorldMatrix} from '../../shared/canvasVectorTransform';

function paintOrder(nodes:VectorNode[]){
 const order:string[]=[];const walk=(parent?:string)=>{for(const n of nodes.filter(n=>n.parent===parent)){order.push(n.id);if(n.type==='group')walk(n.id);}};
 walk();return order;
}

test('composition changes cannot bring distant houses in front of the gate or the front counters',()=>{
 for(const composition of ['left','center','right'] as const){
  const p=settingScenery({place:'market',composition}),order=paintOrder(p.stage.nodes);
  assert.ok(order.indexOf('scenery-house-middle-wall')<order.indexOf('scenery-gate-roof'));
  assert.ok(order.indexOf('scenery-gate-roof')<order.indexOf('scenery-stall-right-awning'));
  assert.ok(order.indexOf('scenery-stall-right-awning')<order.indexOf('scenery-flower-pot'));
  for(const id of ['house-middle','market-gate','stall-left','flower-pot']){
   let n=p.stage.nodes.find(n=>n.id===id);const ancestors:string[]=[];
   while(n?.parent){ancestors.push(n.parent);n=p.stage.nodes.find(p=>p.id===n!.parent);}
   assert.ok(ancestors.includes('built-layout'),`${id} must follow the same layout transform`);
  }
 }
});

test('whole village cottages keep grounded rectangular walls and a complete shallow trapezoid roof',()=>{
 for(const seed of [0,47,219,517,-218,99999])for(const composition of ['left','right'] as const){
  const p=settingScenery({place:'village',seed,composition}),assets=normalizeVectorAssets(p.assets),drawing=normalizeVectorScene(p.stage,assets),scene={durationMs:1000,vectorScene:drawing,vectorAssetLibrary:assets} as any;
  assert.ok(drawing.nodes.length<512);assert.equal(new Set(drawing.nodes.map(n=>n.id)).size,drawing.nodes.length);
  for(const name of ['house-back-left','house-back-middle','house-back-right','house-left','house-right','house-far']){
   const house=drawing.nodes.find(n=>n.id===name)!,b=house.bounds!;
   const foot=vectorPoint(vectorWorldMatrix(name,scene,0,assets),b.x+b.width/2,b.y+b.height);
   assert.ok(Math.abs(foot.y-(620+house.groundOffsetY!))<.01);
   const ends=(part:string)=>[...drawing.nodes.find(n=>n.id===`scenery-${name}-${part}`)!.d!.matchAll(/[MC]([^MCZ]+)/g)].map(m=>m[1]!.trim().split(/\s+/).map(Number).slice(-2));
   const wall=ends('wall'),roof=ends('roof'),eave=b.y+b.height*.44;
   assert.ok(Math.abs(roof[0]![0]!-(b.x+b.width*.18))<.11);
   assert.ok(Math.abs(roof[0]![1]!-b.y)<.11);
   assert.ok(roof.some(p=>Math.abs(p[0]!-(b.x+b.width*.79))<.11&&Math.abs(p[1]!-(b.y+.6))<.11),'a complete roof needs both ridge corners, not a cropped close-up edge');
   assert.ok(Math.abs(Math.min(...roof.map(p=>p[0]!))-b.x)<.6);
   assert.ok(Math.abs(Math.max(...roof.map(p=>p[0]!))-(b.x+b.width))<.6);
   assert.ok(Math.max(...roof.map(p=>p[1]!))-eave<1.7,'straw fringe must not become a sawtooth silhouette');
   for(const p of wall){
    const edgeDistance=Math.min(Math.abs(p[0]!-(b.x+b.width*.07)),Math.abs(p[0]!-(b.x+b.width*.93)),Math.abs(p[1]!-(eave-1)),Math.abs(p[1]!-(b.y+b.height)));
    assert.ok(edgeDistance<.6,'pen deviations must stay under 0.6px from the structural wall edge');
   }
   assert.ok(drawing.nodes.find(n=>n.id===name+'-door')?.parent===name);
  }
 }
});

test('architectural faces keep sharp corners while small segmented ink deviations retain hand-drawn variation',()=>{
 const nodes=settingScenery({place:'market'}).stage.nodes;
 for(const id of ['house-left-wall','house-left-roof','stall-right-counter-front','stall-right-counter-top','stall-right-awning']){
  const d=nodes.find(n=>n.id==='scenery-'+id)!.d!;
  const commands=[...d.matchAll(/[MC]([^MCZ]+)/g)];let previous:number[]=[];
  for(const [i,c] of commands.entries()){
   const a=c[1]!.trim().split(/\s+/).map(Number);
   if(i===0)previous=a;
   else {assert.deepEqual(a.slice(0,2),previous,'curved edge must not bend an architectural face');assert.deepEqual(a.slice(2,4),a.slice(4,6));previous=a.slice(4,6);}
  }
  assert.ok(nodes.some(n=>n.id.startsWith('scenery-'+id+'-ink-')),'filled pressure strokes retain imperfect pen weight');
 }
});

test('village depth and near construction survive every seed without hatching outside small roofs',()=>{
 for(const seed of [0,47,4821,99999]){
  const p=settingScenery({place:'village',seed}),nodes=p.stage.nodes;
  const houses=nodes.filter(n=>n.type==='group'&&n.id.startsWith('house-')&&!n.id.endsWith('-door'));
  assert.ok(houses.length>=12);
  assert.ok(Math.max(...houses.map(n=>n.bounds!.width))/Math.min(...houses.map(n=>n.bounds!.width))>3,'distant cottages must actually recede in size');
  assert.ok(nodes.some(n=>n.id==='scenery-house-left-door-frame'));
  for(const house of houses){
   const hatch=nodes.find(n=>n.id===`scenery-${house.id}-roof-material`);
   if(!hatch)continue;
   for(const m of hatch.d!.matchAll(/M(-?[\d.]+)\s+(-?[\d.]+)/g))assert.ok(Number(m[2])>house.bounds!.y+3,'straw starts inside the roof, not above its ridge');
  }
  assert.ok(nodes.some(n=>n.id==='scenery-house-paths'&&n.parent==='terrain'));
  assert.equal(nodes.find(n=>n.id==='bamboo-clump-1')!.parent,'architecture-front');
 }
});

test('market trades have distinct supported goods instead of identical produce on every counter',()=>{
 const p=settingScenery({place:'market'}),nodes=p.stage.nodes;
 assert.ok(nodes.some(n=>n.id==='scenery-stall-back-pottery-0'));
 assert.ok(!nodes.some(n=>n.id==='scenery-stall-back-produce-0'));
 assert.ok(nodes.some(n=>n.id==='scenery-stall-back-left-produce-0'));
 assert.ok(nodes.some(n=>n.id==='scenery-stall-right-cloth-seams-1'));
 assert.ok(nodes.some(n=>n.id==='scenery-stall-left-herb-tie-0'));
 assert.ok(nodes.length<512);
 assert.deepEqual(p,settingScenery({place:'market'}),'detail choices must stay stable across frames and regenerated shots');
});
