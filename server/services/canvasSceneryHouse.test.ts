import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import source from '../assets/vector-styles/folk-horror/upright-courtyard/drawing.json';
import {parseVectorPlan} from './canvasVectorDirector';import {settingScenery} from './canvasScenerySetting';
import {FOLK_INK_STYLE} from '../../shared/canvasVectorInk';
import {buildVectorCastReview} from './canvasVectorCastReview';
const require=createRequire(import.meta.url),svgpath=require('svgpath');
const vertices=(d:string):number[][]=>{
 const points:number[][]=[];let x=0,y=0;
 for(const s of svgpath(d).abs().segments){
  if(s[0]==='M'||s[0]==='L'){x=s[1];y=s[2];}
  else if(s[0]==='H')x=s[1];else if(s[0]==='V')y=s[1];else continue;
  points.push([x,y]);
 }
 return points;
};
test('new house production uses the corrected accepted material paint unchanged, including black ink',()=>{
 for(const light of ['day','dusk','night']){
  const p=parseVectorPlan(JSON.stringify({vectorStages:{yard:{template:'folk-setting',place:'thatched-yard',light,artStyle:FOLK_INK_STYLE}},scenes:[{durationMs:5000,narration:'Sân nhà rộng.',vectorScene:{stage:'yard',camera:[{t:0,x:640,y:360,zoom:1}]}}]}),'[folk-horror]',{width:1280,height:720},undefined,undefined,true);
  const scene=p.scenes[0]!.vectorScene!,wall=scene.nodes.find(n=>n.id==='house-wall')!;
  assert.equal(wall.type,'instance');const body=p.vectorAssets![wall.asset!]!;
  for(const n of source.parts.house){
   const painted=body.nodes.find(b=>b.id===n.id)!;
   assert.equal(painted.d,n.d,'do not substitute simplified geometry or deform the corrected ink twice');
   assert.equal(painted.stroke,undefined,'do not add another black border to filled grain/ink paths');
  }
  for(const n of source.parts.house.filter(n=>n.fill==='#17120f'))assert.equal(body.nodes.find(b=>b.id===n.id)!.fill,'#17120f');
  const roof=p.vectorAssets![scene.nodes.find(n=>n.id==='house-roof')!.asset!]!;
  for(const n of source.parts.straw){const painted=roof.nodes.find(b=>b.id===n.id)!;assert.equal(painted.d,n.d,'retain original straw detail');assert.equal(painted.stroke,undefined,'straw detail retains its brown paint, without an extra black outline');}
  assert.ok(!scene.nodes.some(n=>n.id==='scenery-house-planks'),'rejected simple house painter must not run');
  const cast=buildVectorCastReview(p);
  assert.ok(!cast||cast.pages.every(page=>page.assetIds.every(id=>!id.startsWith('native-house-'))),'approved house paint must not be treated as a character or sent to a turn rig');
 }
});
test('wall top and structural column remain aligned while pen edges have subpixel variation',()=>{
 const wall=source.parts.house.find(n=>n.fill==='#a47849')!;
 const top=vertices(wall.d).filter(([x,y])=>x!>0&&x!<730&&Math.abs(y!-280)<8).map(p=>p[1]!);
 assert.ok(top.length>10);assert.ok(Math.max(...top)-Math.min(...top)<1.6,'top beam cannot bow or slope across the wall');
 const post=source.parts.house.find(n=>n.fill==='#795436')!;
 const left=vertices(post.d).filter(([x,y])=>y!>305&&y!<510&&x!<377).map(p=>p[0]!);
 assert.ok(left.length>=4);assert.ok(Math.max(...left)-Math.min(...left)<1.6,'a supporting column must stay upright');
 assert.ok(Math.max(...left)-Math.min(...left)>.1,'keep small natural pen variation');
});
test('house forms share real detailed parts and one stable source across village, square and yard',()=>{
 for(const place of ['thatched-yard','village-wide','market-wide','tree-square','tiled-yard','night-house'] as const){
  const {stage,assets}=settingScenery({place,light:'day'});
  assert.ok(stage.nodes.some(n=>n.id.endsWith('-wall')&&n.type==='instance'&&n.asset?.startsWith('native-house-wall-')),place);
  assert.ok(Object.values(assets).some((a:any)=>a.nodes?.some((n:any)=>n.id==='approved-house-0'&&n.d===source.parts.house[0]!.d)),place);
  assert.ok(stage.nodes.length<480);assert.ok(Object.keys(assets).length<40);
 }
});

test('hero houses add closed ink contours, square construction and readable facade detail',()=>{
 const n=settingScenery({place:'thatched-yard',light:'night'}).stage.nodes;
 for(const id of ['house-wall-outline','house-roof-outline','house-eave-beam','house-base-beam','house-corner-post-left','house-corner-post-right','house-door-frame','house-middle-beam','house-window-0-outline','house-window-0-pane','house-window-0-mullion-v','house-window-0-mullion-h','house-window-0-sill','house-window-1-outline','house-door-plaque-outline','house-door-plaque','house-door-paper-left','house-door-paper-right','house-foundation-blocks'])assert.ok(n.some(p=>p.id===id),id);
 const sharp=n.filter(p=>p.id.startsWith('house-')&&/(outline|beam|post|frame|pane|mullion|sill|plaque|paper)/.test(p.id)&&p.type==='path');
 assert.ok(sharp.length>=18);
 for(const p of sharp){
  assert.ok(/[HLV]/.test(p.d||''),p.id+' must use explicit straight construction edges');
  assert.ok(!/[QCA]/.test(p.d||''),p.id+' must not round an architectural corner');
 }
 assert.equal(n.find(p=>p.id==='house-wall-outline')!.fill,'#17120f');
 assert.equal(n.find(p=>p.id==='house-roof-outline')!.fill,'#17120f');
});

test('primary yard house retains a readable scale and its lane meets the real painted doorway',()=>{
 const n=settingScenery({place:'thatched-yard'}).stage.nodes,house=n.find(n=>n.id==='house')!,door=n.find(n=>n.id==='house-door')!;
 assert.ok(house.bounds!.width>900&&house.bounds!.height>420,'the primary house must not regress to the shrunken 770 by 359 footprint');
 assert.equal(house.bounds!.y+house.bounds!.height,552,'enlarging the house keeps its porch grounded');
 const path=n.find(n=>n.id==='scenery-yard-path')!,top=vertices(path.d!).filter(p=>p[1]===552).map(p=>p[0]!);
 assert.ok(Math.min(...top)<=door.x!&&Math.max(...top)>=door.x!+door.width!,'lane must meet the real door instead of the old generic door position');
});

test('village trees and cottages occlude by their grounded depth, not by which painter ran last',()=>{
 const n=settingScenery({place:'village-wide'}).stage.nodes;
 const depth=n.filter(p=>p.parent==='reference-layout'&&(/^house-\d+$/.test(p.id)||/^village-tree-/.test(p.id))).map(p=>p.bounds!.y+p.bounds!.height);
 assert.ok(depth.length>=15);
 assert.deepEqual(depth,[...depth].sort((a,b)=>a-b),'tree bases behind near houses must be occluded by those houses');
});
