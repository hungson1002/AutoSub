import test from 'node:test';import assert from 'node:assert/strict';
import {parseVectorPlan,applyVectorRepairs,applyVectorRedesign,vectorNeedsSceneryUpgrade} from './canvasVectorDirector';
import {settingScenery,SETTING_SCENERY_VERSION} from './canvasScenerySetting';
import {natureScenery} from './canvasSceneryNature';
import {vectorPoint,vectorWorldMatrix} from '../../shared/canvasVectorTransform';
import {evaluateVectorPart} from '../../shared/canvasVectorScene';
import {vectorShotVisibility} from '../../shared/canvasVectorFraming';
import {vectorDirectionIssues} from './canvasVectorStory';
const frame={width:1280,height:720};
const options=[{template:'nature-landscape',water:'river',vegetation:'bamboo',light:'night'},{template:'nature-landscape',water:'none',vegetation:'pine'},
 {template:'folk-setting',place:'market',light:'dusk'},{template:'folk-setting',place:'room'}];
function plan(stage:Record<string,unknown>,scene={},assets={}){
 return JSON.stringify({vectorAssets:assets,vectorStages:{site:stage},scenes:[{durationMs:2000,narration:'A quiet scene.',vectorScene:{stage:'site',camera:[{t:0,x:640,y:360,zoom:1}],...scene}}]});
}
const parse=(raw:string)=>parseVectorPlan(raw,'[folk-horror]',frame,undefined,undefined,true);

test('production rejects the exact old-template route while existing projects remain readable',()=>{
 for(const place of ['forest','waterside','village','rural-interior']){
  const old=plan({template:'illustrated-place',place,cast:{person:'hero'}},{},{hero:{rig:'simple-puppet'}});
  assert.throws(()=>parse(old),/NEW folk scenery must use nature-landscape/);
  assert.doesNotThrow(()=>parseVectorPlan(old,'[folk-horror]',frame),'legacy project parsing keeps its old geometry');
 }
 const raw=plan({width:1280,height:720,nodes:[{id:'old-paint',type:'rect',width:1280,height:720,fill:'#975'}]});
 assert.throws(()=>parse(raw),/NEW folk scenery/);
});

test('the same approved production boundary supplies inked natural, market and indoor scenes',()=>{
 for(const stage of options){
  const p=parse(plan(stage)),scene=p.scenes[0]!.vectorScene!;
  assert.ok(scene.nodes.some(n=>n.id==='folk-nature-grammar-v1'||n.id===SETTING_SCENERY_VERSION));
  assert.ok(!scene.nodes.some(n=>n.id==='illustrated-world'));
  assert.ok(scene.nodes.some(n=>n.id.startsWith('scenery-')&&n.fill==='#17120f'));
  assert.ok(scene.nodes.length<512);
 }
});

test('old screen-coordinate rectangles and floating table overlays are rejected in stages and shots',()=>{
 const overlay={id:'floating-table',type:'rect',x:620,y:130,width:600,height:250,fill:'#754'};
 assert.throws(()=>parse(plan({...options[3],nodes:[overlay]})),/raw stage overlays/);
 assert.throws(()=>parse(plan(options[3]!,{nodes:[overlay]})),/raw per-shot overlays/);
});

test('a new small prop contacts the actual table and keeps its contact through cuts',()=>{
 const p=parse(plan({...options[3],objects:[{id:'clue',asset:'new-clue',support:'table',height:45,at:.6}]},{},
  {'new-clue':{width:30,height:45,nodes:[{id:'base',type:'rect',width:30,height:45,fill:'#805e3a',stroke:'#17120f',strokeWidth:3}]}}));
 const scene={...p.scenes[0]!,vectorAssetLibrary:p.vectorAssets},node=scene.vectorScene!.nodes.find(n=>n.id==='clue')!;
 for(const time of [0,1000,2000]){
  const base=vectorPoint(vectorWorldMatrix('clue',scene,time,p.vectorAssets),15,45);
  assert.ok(Math.abs(base.y-448)<.1,'actual prop base is on the table, not the screen or floor');
  assert.ok(base.x>=565&&base.x<=843);
 }
 assert.equal(node.groundOffsetY,-172);
 assert.throws(()=>parse(plan({...options[3],objects:[{id:'clue',asset:'new-clue',support:'sky',height:45}]},{},{'new-clue':{width:30,height:45,nodes:[{id:'base',type:'rect',width:30,height:45,fill:'#805e3a'}]}})),/real named support/);
});

test('new setting paint survives repair; lamp extinction fades only the native flame',()=>{
 const p=parse(plan(options[3]!)),s=p.scenes[0]!,allowed=new Set([s.id]);
 const after=applyVectorRepairs(p,JSON.stringify({scenes:[{id:s.id,vectorScenePatch:{tracks:[{target:'lamp-flame',start:0,end:1,frames:[{t:0,opacity:1},{t:1,opacity:0}]}]}}]}),allowed);
 assert.equal(evaluateVectorPart('lamp-flame',after.scenes[0]!,2000).opacity,0);
 assert.equal(evaluateVectorPart('lamp',after.scenes[0]!,2000).opacity,1);
 assert.throws(()=>applyVectorRepairs(p,JSON.stringify({scenes:[{id:s.id,vectorScenePatch:{nodes:[{id:'scenery-table-top',fill:'#fff'}]}}]}),allowed),/native nature paint is read-only/);
 assert.throws(()=>applyVectorRepairs(p,JSON.stringify({scenes:[{id:s.id,vectorScenePatch:{nodes:[{id:'replacement-table',type:'rect',x:620,y:130,width:600,height:250,fill:'#754'}]}}]}),allowed),/cannot add raw painted overlays/);
});

test('native setting redesign stays on the new painter and preserves approved people',()=>{
 const p=parse(plan(options[3]!)),s=p.scenes[0]!;
 const after=applyVectorRedesign(p,JSON.stringify({vectorAssets:p.vectorAssets,vectorStages:{site:{template:'folk-setting',place:'market'}},scenes:[{id:s.id,vectorScene:{stage:'site'}}]}));
 assert.ok(after.scenes[0]!.vectorScene!.nodes.some(n=>n.id==='stall-left'));
 assert.deepEqual(after.vectorAssets!['setting-person'],p.vectorAssets!['setting-person']);
 assert.throws(()=>applyVectorRedesign(p,JSON.stringify({vectorAssets:p.vectorAssets,vectorStages:{site:{template:'illustrated-place',place:'rural-interior'}},scenes:[{id:s.id,vectorScene:{stage:'site'}}]})),/read-only/);
});

test('native room and market fit both aspect ratios, with stable contact geometry and bounded paths',()=>{
 for(const frame of [{width:1280,height:720},{width:720,height:1280}])for(const place of ['market','room','village','street','corridor'] as const){
  const p=settingScenery({place},frame),world=p.stage.nodes.find(n=>n.id==='folk-setting-world')!;
  assert.equal(world.scaleX,world.scaleY);assert.ok(p.stage.nodes.length<512);
  for(const n of p.stage.nodes)if(n.d)assert.ok(n.d.length<=8000,n.id);
  assert.deepEqual(p,settingScenery({place},frame));
 }
 const clearing=natureScenery({water:'none',vegetation:'pine'}).stage.nodes;
 assert.ok(clearing.some(n=>n.id==='clearing'));
 assert.ok(!clearing.some(n=>['waterfall','pool','river-water','valley'].includes(n.id)));
});

test('same-brief regeneration upgrades legacy scenery while accepted projects remain unchanged',()=>{
 const old=parseVectorPlan(plan({template:'illustrated-place',place:'rural-interior',cast:{person:'hero'}},{},{hero:{rig:'simple-puppet'}}),'[folk-horror]',frame);
 assert.equal(vectorNeedsSceneryUpgrade(old,'[folk-horror]'),true);
 assert.equal(vectorNeedsSceneryUpgrade(old,'another style'),false);
 const accepted=parse(plan(options[3]!));assert.equal(vectorNeedsSceneryUpgrade(accepted,'[folk-horror]'),false);
 const before=JSON.stringify(old),s=old.scenes[0]!;
 const migrated=applyVectorRedesign(old,JSON.stringify({vectorAssets:old.vectorAssets,vectorStages:{site:{template:'folk-setting',place:'room',cast:{person:'hero'}}},scenes:[{id:s.id,vectorScene:{stage:'site'}}]}),true);
 assert.ok(migrated.scenes[0]!.vectorScene!.nodes.some(n=>n.id===SETTING_SCENERY_VERSION));
 assert.deepEqual(migrated.vectorAssets!.hero,old.vectorAssets!.hero);
 assert.equal(migrated.scenes[0]!.narration,s.narration);
 assert.equal(JSON.stringify(old),before,'migration returns a new project and preserves the original checkpoint');
 assert.throws(()=>applyVectorRedesign(old,JSON.stringify({vectorAssets:old.vectorAssets,vectorStages:old.vectorStages,scenes:[{id:s.id,vectorScene:{stage:'site'}}]}),true),/NEW folk scenery/);
});

test('semantic aliases operate on actual water and foliage, not empty dummy groups',()=>{
 const p=parse(plan({...options[0],vegetation:'bamboo'},{tracks:[{target:'river-water',start:0,end:1,frames:[{t:0,opacity:1},{t:1,opacity:.5}]}]}));
 const n=p.scenes[0]!.vectorScene!.nodes;
 const ancestors:string[]=[];let parent=n.find(n=>n.id==='scenery-stream-water')!.parent;
 while(parent){ancestors.push(parent);parent=n.find(n=>n.id===parent)?.parent;}
 assert.ok(ancestors.includes('river-water'),'river alias owns the actual stream paint through its semantic aliases');
 assert.ok(n.some(n=>n.parent==='bamboo-grove'));
 assert.ok(n.some(n=>n.id==='river-bank')&&n.some(n=>n.id==='hills-far')&&n.some(n=>n.id==='fern-bushes'));
 const pine=parse(plan(options[1]!)).scenes[0]!.vectorScene!.nodes;
 assert.ok(pine.some(n=>n.id==='pine-trees')&&pine.some(n=>n.id==='pine-tree'));
 const market=parse(plan(options[2]!)).scenes[0]!.vectorScene!.nodes;
 assert.equal(market.find(n=>n.id==='scenery-lane')!.parent,'market-lane');
 let owner=market.find(n=>n.id==='house-far')!.parent;const parents:string[]=[];
 while(owner){parents.push(owner);owner=market.find(n=>n.id===owner)?.parent;}
 assert.ok(parents.includes('village-far'),'the alias still owns the actual distant houses through their depth layers');
});

test('native flame shrink stays on its wick and the moon clears the caption area',()=>{
 const p=parse(plan(options[3]!,{tracks:[{target:'lamp-flame',start:0,end:1,frames:[{t:0,scaleY:1},{t:1,scaleY:.2,scaleX:.3}]}]}));
 const s={...p.scenes[0]!,vectorAssetLibrary:p.vectorAssets};
 const wick=(t:number)=>vectorPoint(vectorWorldMatrix('lamp-flame',s,t,p.vectorAssets),782,385);
 assert.deepEqual(wick(0),wick(1000));assert.deepEqual(wick(0),wick(2000));
 const night=parse(plan(options[0]!));
 assert.ok(vectorShotVisibility(night.scenes[0]!,night.vectorAssets!,'moon',0).visibleFraction!>.99,'native moon must stay below the protected caption band');
});

test('repair cannot zoom an empty native wide shot onto its invisible actor or fade the market',()=>{
 const p=parse(plan(options[2]!)),s=p.scenes[0]!;
 s.vectorDirection={visibleCast:[],shot:{size:'wide',framing:'context',focus:'market',include:[]},beats:[]} as any;
 const scene={...s,vectorAssetLibrary:p.vectorAssets},before=vectorWorldMatrix('stall-left',scene,1000,p.vectorAssets);
 const after=applyVectorRepairs(p,JSON.stringify({scenes:[{id:s.id,vectorScenePatch:{
  shot:{target:'person',height:.38,include:['stall-left']},removeTracks:['camera-world'],
  tracks:[{target:'market',start:0,end:1,frames:[{t:0,opacity:0},{t:1,opacity:1}]}]
 }}]}),new Set([s.id]));
 const repaired={...after.scenes[0]!,vectorAssetLibrary:after.vectorAssets};
 assert.deepEqual(vectorWorldMatrix('stall-left',repaired,1000,after.vectorAssets),before);
 assert.equal(evaluateVectorPart('market',repaired,0).opacity,1);
 assert.equal(evaluateVectorPart('market',repaired,1000).opacity,1);
 const room=parse(plan(options[3]!)),r=room.scenes[0]!;r.vectorDirection={...s.vectorDirection!,shot:{...s.vectorDirection!.shot,focus:'table'}};
 const dimmed=applyVectorRepairs(room,JSON.stringify({scenes:[{id:r.id,vectorScenePatch:{tracks:[{target:'lamp-flame',start:0,end:1,frames:[{t:0,opacity:1},{t:1,opacity:0}]}]}}]}),new Set([r.id]));
 assert.equal(evaluateVectorPart('lamp-flame',dimmed.scenes[0]!,2000).opacity,0,'local lamp extinction remains supported');
});

test('establishing scenery may stay still, translucent mist may reveal, and a dim lamp may extinguish',()=>{
 const p=parse(plan(options[0]!,{tracks:[{target:'valley-mist',cue:'quiet',start:0,end:1,frames:[{t:0,opacity:0},{t:1,opacity:.22}]}]})),s=p.scenes[0]!;
 s.vectorDirection={visibleCast:[],shot:{size:'wide',framing:'context',focus:'river-water',include:['tree','terrain']},beats:[
  {cue:'quiet',kind:'reveal',targets:['terrain'],motionTargets:['terrain'],before:'A riverbank.',after:'The riverbank is shown.'},
  {cue:'quiet',kind:'reveal',targets:['valley-mist'],motionTargets:['valley-mist'],before:'No mist.',after:'Thin mist.'}
 ]} as any;
 assert.deepEqual(vectorDirectionIssues(p),[]);
 const room=parse(plan(options[3]!,{tracks:[{target:'lamp-flame',cue:'quiet',start:0,end:1,frames:[{t:0,opacity:.6},{t:1,opacity:0}]}]})),r=room.scenes[0]!;
 r.vectorDirection={visibleCast:[],shot:{size:'wide',framing:'context',focus:'table',include:[]},beats:[
  {cue:'quiet',kind:'hide',targets:['lamp-flame'],motionTargets:['lamp-flame'],before:'A dim flame.',after:'Extinguished.'}
 ]} as any;
 assert.deepEqual(vectorDirectionIssues(room),[]);
});

test('native scenery resolves the common house-mid name and rejects a duplicated native flower pot clearly',()=>{
 const p=parse(plan({template:'folk-setting',place:'village'},{vectorBeats:[{cue:'quiet',targets:['house-mid']}]}));
 const nodes=p.scenes[0]!.vectorScene!.nodes;
 const chain:string[]=[];let parent=nodes.find(n=>n.id==='house-mid')?.parent;
 while(parent){chain.push(parent);parent=nodes.find(n=>n.id===parent)?.parent;}
 assert.ok(chain.includes('house-far'));
 assert.ok(nodes.some(n=>n.id==='scenery-house-far-wall'&&n.parent==='house-mid'),'alias owns the actual house paint');
 assert.throws(()=>parse(plan({...options[2],objects:[{id:'flower-pot',asset:'extra-flower-pot',support:'floor',height:55,at:0}]})),/flower-pot already exists.*reuse the existing flower-pot/);
});
