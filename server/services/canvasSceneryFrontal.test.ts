import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {settingScenery} from './canvasScenerySetting';import {natureScenery} from './canvasSceneryNature';
import {normalizeVectorAssets,normalizeVectorScene,type VectorNode} from '../../shared/canvasVectorScene';
import {vectorPoint,vectorWorldMatrix} from '../../shared/canvasVectorTransform';
import {parseVectorPlan} from './canvasVectorDirector';import {vectorDirectionIssues} from './canvasVectorStory';
const svgpath=createRequire(import.meta.url)('svgpath');
function points(n:VectorNode):number[][]{
 return svgpath(n.d!).abs().segments.flatMap((s:any[])=>s[0]==='M'||s[0]==='L'?[[s[1],s[2]]]:s[0]==='C'?[[s[5],s[6]]]:s[0]==='Q'?[[s[3],s[4]]]:[]);
}
const yRange=(n:VectorNode)=>{const y=points(n).map(p=>p[1]!);return Math.max(...y)-Math.min(...y);};
test('tables, counters and well rims expose narrow front edges across seeds and lighting',()=>{
 for(const seed of [0,614,99999])for(const light of ['day','dusk','night'] as const){
  for(const place of ['room','corridor','market','village','wood-room','bedroom','shrine'] as const){
   const {stage}=settingScenery({place,seed,light});
   for(const n of stage.nodes.filter(n=>n.type==='path'&&/^scenery-(?:table-top|lamp-table-top|altar-top|altar-front-table-top|.*-counter-top|well-rim)$/.test(n.id)))
    assert.ok(yRange(n)<16,`${place}/${n.id} must not reveal a broad top plane`);
  }
 }
});
test('room vessels and lamp meet the visible edge, including translated furniture',()=>{
 for(const composition of ['left','center','right'] as const){
  const p=settingScenery({place:'room',composition}),assets=normalizeVectorAssets(p.assets),scene:any={durationMs:5000,vectorAssetLibrary:assets,vectorScene:normalizeVectorScene(p.stage,assets)};
  const edge=scene.vectorScene.nodes.find((n:VectorNode)=>n.id==='scenery-table-top') as VectorNode;
  const edgeY=Math.min(...points(edge).map(q=>vectorPoint(vectorWorldMatrix(edge.id,scene,0,assets),q[0]!,q[1]!).y));
  for(const id of ['scenery-teapot-body','scenery-cup-0','scenery-cup-1','scenery-lamp-foot']){
   const n=scene.vectorScene.nodes.find((n:VectorNode)=>n.id===id) as VectorNode;
   const baseY=Math.max(...points(n).map(q=>vectorPoint(vectorWorldMatrix(id,scene,0,assets),q[0]!,q[1]!).y));
   assert.ok(Math.abs(baseY-edgeY)<1.1,`${id} must rest on the actual front edge`);
  }
 }
});
test('steps and stones keep frontal silhouettes in both reference and nature scenery',()=>{
 const n=settingScenery({place:'mountain-path'}).stage.nodes;
 for(let i=0;i<7;i++)assert.ok(yRange(n.find(n=>n.id==='scenery-step-'+i)!)<11,'a step cannot become a large receding tread');
 assert.ok(!n.some(n=>/scenery-path-rock-\d+-facet/.test(n.id)));
 const natural=natureScenery({terrain:'gorge',water:'stream',bridge:true}).stage.nodes;
 assert.ok(!natural.some(n=>/^scenery-water-stone-\d+-(face|shade)$/.test(n.id)));
 for(const n of natural.filter(n=>/^scenery-bridge-board-\d+$/.test(n.id)))assert.ok(yRange(n)<13,'bridge planks must show a thin front band');
});
test('landing pier remains a thin side edge and supports meet that edge',()=>{
 const p=settingScenery({place:'riverside'}),n=p.stage.nodes.find(n=>n.id==='scenery-pier-deck')!;
 const depth=points(n).map(([x,y])=>y!-510-(x!-704)*61/247);
 assert.ok(Math.max(...depth)-Math.min(...depth)<13,'landing cannot reveal an overhead plank surface');
 assert.equal(p.supports.dock.y,540);
});

const luminance=(paint:string)=>{
 const rgb=[1,3,5].map(offset=>parseInt(paint.slice(offset,offset+2),16));
 return rgb[0]!*.2126+rgb[1]!*.7152+rgb[2]!*.0722;
};
test('night palettes darken native materials while keeping actual emitters bright',()=>{
 const room=settingScenery({place:'room',light:'night'}).stage.nodes;
 const market=settingScenery({place:'market',light:'night'}).stage.nodes;
 const river=settingScenery({place:'riverside',light:'night'}).stage.nodes;
 const nature=natureScenery({terrain:'gorge',water:'stream',bridge:true,light:'night'}).stage.nodes;
 for(const [label,nodes,id] of [['room',room,'scenery-room-floor'],['market',market,'scenery-village-ground'],['river',river,'scenery-shore-earth'],['nature',nature,'scenery-gorge-left']] as const){
  const fill=nodes.find(n=>n.id===id)?.fill as string;
  assert.ok(fill&&luminance(fill)<92,`${label} night material must visibly read as night`);
 }
 const lamp=room.find(n=>n.id==='scenery-lamp-source')!;
 assert.ok(luminance(lamp.fill as string)>210,'the lamp source must stay bright against the dark room');
});

test('native scenery carries deliberate material detail instead of empty flat fills',()=>{
 for(const place of ['market','village'] as const){
  const nodes=settingScenery({place,seed:614}).stage.nodes;
  for(const id of ['scenery-foreground-soil-marks','scenery-foreground-pebbles','scenery-foreground-grass-tufts'])assert.ok(nodes.some(n=>n.id===id),`${place} needs ${id}`);
 }
 const river=settingScenery({place:'riverside',seed:614}).stage.nodes;
 assert.ok(river.some(n=>n.id==='scenery-shore-soil-marks'));
 assert.ok(river.some(n=>n.id==='scenery-shore-pebbles'));
 assert.ok(river.some(n=>n.id==='shore-fence'));
 assert.ok(river.some(n=>n.id==='scenery-shore-reeds'));
 assert.equal(river.filter(n=>/^scenery-shore-stone-\d+$/.test(n.id)).length,3);
 const shrine=settingScenery({place:'shrine',light:'night',seed:614}).stage.nodes;
 assert.ok(shrine.some(n=>n.id==='scenery-shrine-wall-age'));
 assert.equal(shrine.filter(n=>/^scenery-shrine-column-\d+$/.test(n.id)).length,4);
 assert.equal(shrine.filter(n=>n.id.endsWith('-source')&&n.id.includes('shrine-candle-light')).length,2);
});

test('reference-wide semantic aliases resolve to the actual painted set',()=>{
 const village=parseVectorPlan(JSON.stringify({vectorStages:{village:{template:'folk-setting',place:'village-wide',light:'night',seed:614}},scenes:[{durationMs:5000,narration:'Ánh trăng soi làng vắng.',vectorScene:{stage:'village',camera:[{t:0,x:640,y:360,zoom:1}]},vectorBeats:[{cue:'Ánh trăng soi làng vắng',targets:['village','tree']}]}]}),'[folk-horror]',{width:1280,height:720});
 assert.ok(village.scenes[0]!.vectorScene!.nodes.some(n=>n.id==='village'));
 const shrine=parseVectorPlan(JSON.stringify({vectorStages:{shrine:{template:'folk-setting',place:'shrine',light:'night',seed:614}},scenes:[{durationMs:5000,narration:'Nến soi bàn thờ và rèm cũ.',vectorScene:{stage:'shrine',camera:[{t:0,x:640,y:360,zoom:1}]},vectorBeats:[{cue:'Nến soi bàn thờ và rèm cũ',targets:['altar','table','curtain']}]}]}),'[folk-horror]',{width:1280,height:720});
 for(const id of ['altar','table','curtain','lamp'])assert.ok(shrine.scenes[0]!.vectorScene!.nodes.some(n=>n.id===id),`missing ${id}`);
});

test('an empty wide context study can include a small well without forcing a zoom; discoveries still need readable framing',()=>{
 const p=parseVectorPlan(JSON.stringify({vectorStages:{village:{template:'folk-setting',place:'village',seed:614}},scenes:[{durationMs:5000,narration:'The empty village remains quiet.',vectorScene:{stage:'village',camera:[{t:0,x:640,y:360,zoom:1}]}}]}),'[folk-horror]',{width:1280,height:720},undefined,undefined,true);
 const s=p.scenes[0]!;
 s.vectorDirection={purpose:'Study the empty set',location:'village',visibleCast:[],heldProps:[],propEvents:[],shot:{size:'wide',framing:'context',focus:'well',include:[]},beats:[{cue:'The empty village',kind:'hold',targets:['well'],motionTargets:[],before:'Empty set',after:'Empty set'}]};
 assert.ok(!vectorDirectionIssues(p).some(i=>i.problem==='Story focus well is too small to read'));
 s.vectorDirection.beats[0]!.kind='reveal';
 assert.ok(vectorDirectionIssues(p).some(i=>i.problem==='Story focus well is too small to read'),'a revealed story clue still needs readable framing');
 s.vectorDirection.beats[0]!.kind='hold';s.vectorDirection.visibleCast=['person'];
 assert.ok(vectorDirectionIssues(p).some(i=>i.problem==='Story focus well is too small to read'),'actor-driven narrative shots keep the original check');
});
