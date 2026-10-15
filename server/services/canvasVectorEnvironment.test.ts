import test from 'node:test';import assert from 'node:assert/strict';
import {vectorRiverbank} from './canvasVectorRiverbank';import {vectorCourtyard} from './canvasVectorCourtyard';import {illustratedPlace} from './canvasVectorIllustratedPlace';
import {createCanvasProject} from '../../shared/canvasAnimationStudio';import {normalizeVectorAssets,normalizeVectorScene,type VectorNode} from '../../shared/canvasVectorScene';
import {vectorPoint,vectorWorldMatrix} from '../../shared/canvasVectorTransform';import {FOLK_INK_STYLE} from '../../shared/canvasVectorInk';import {parseVectorPlan} from './canvasVectorDirector';
const frame={width:1280,height:720};
function sceneFor(location:{assets:Record<string,unknown>;stage:{nodes:VectorNode[];width:number;height:number;ground?:unknown;tracks?:unknown}}){
 const assets=normalizeVectorAssets(location.assets);
 return {...createCanvasProject().scenes[0]!,durationMs:3000,narration:'',vectorAssetLibrary:assets,
  vectorScene:normalizeVectorScene({...location.stage,nodes:location.stage.nodes.map(n=>n.id==='person'?{...n,opacity:0}:n)},assets)};
}

test('riverbank canopy shadow belongs to the tree and shares its world transform',()=>{
 const s=sceneFor(vectorRiverbank(frame)),shade=s.vectorScene.nodes.find(n=>n.id==='tree-canopy-shade')!;
 assert.equal(shade.parent,'tree');
 assert.deepEqual(vectorPoint(vectorWorldMatrix(shade.id,s,0),100,150),vectorPoint(vectorWorldMatrix('tree',s,0),100,150),'no orphan canopy at the top of the frame');
});

test('landscape moon clears captions and a near landing retains its real support',()=>{
 const s=sceneFor(vectorRiverbank(frame));
 const moon=vectorPoint(vectorWorldMatrix('moon',s,0),0,0);
 assert.ok(moon.y-37*.75>frame.height*.19,'moon stays below caption clearance');
 assert.ok(s.vectorScene.nodes.some(n=>n.id==='jetty'&&n.groundAnchor),'near landing has an actual support');
});

test('a wide hand-ink courtyard keeps each fence path inside the production parser limit',()=>{
 const p=parseVectorPlan(JSON.stringify({vectorStages:{yard:{template:'folk-courtyard'}},scenes:[{durationMs:1000,narration:'An empty yard.',vectorScene:{stage:'yard'}}]}),'[folk-horror]',frame);
 const parts=p.scenes[0]!.vectorScene!.nodes.filter(n=>n.parent==='distant-fence'&&n.type==='path');
 assert.ok(parts.length>1);assert.ok(parts.every(n=>n.d!.length<=8000),'compound fence ink must be split before path validation');
});

test('courtyard architecture has framing bounds and fence pickets retain their local proportions',()=>{
 const location=vectorCourtyard(frame),s=sceneFor(location),house=location.stage.nodes.find(n=>n.id==='house')!;
 assert.ok(house.bounds&&house.bounds.x!<0&&house.bounds.width!>600);
 assert.deepEqual(house.groundAnchor,{x:215,y:518});
 assert.deepEqual(location.stage.nodes.find(n=>n.id==='door')!.groundAnchor,{x:70,y:370},'door/ring contact coordinates remain compatible');
 assert.equal(vectorWorldMatrix('distant-fence',s,0).a,vectorWorldMatrix('house',s,0).a,'pickets must not stretch like a horizon plane');
 assert.equal(location.stage.nodes.find(n=>n.id==='lamp')!.x,614,'the mounted lamp keeps its original grip/emitter geometry');
});

test('native village uses readable earth, different house footprints and a measured tree target',()=>{
 const location=illustratedPlace({place:'village',light:'day',view:'elevated',artStyle:FOLK_INK_STYLE},frame),N=location.stage.nodes;
 assert.equal(N.find(n=>n.id==='middle-ground')!.fill,N.find(n=>n.id==='physical-ground-plane')!.fill);
 assert.notEqual(N.find(n=>n.id==='middle-ground')!.fill,N.find(n=>n.id==='village-tree-canopy')!.fill,'the open yard is earth rather than an unbroken grass carpet');
 assert.ok(N.find(n=>n.id==='house-mid')!.width!>N.find(n=>n.id==='house-back')!.width!*1.7);
 assert.equal(N.find(n=>n.id==='village-tree')!.parent,'tree');assert.ok(N.find(n=>n.id==='tree')!.bounds);
 assert.notEqual(N.find(n=>n.id==='house-mid-thatch')!.stroke,N.find(n=>n.id==='house-mid-roof')!.fill,'thatch cannot disappear in an identical roof paint');
 assert.equal(N.find(n=>n.id==='person')!.height,80,'environment polish must not enlarge the actor');
 const again=illustratedPlace({place:'village',light:'day',view:'elevated',artStyle:FOLK_INK_STYLE},frame);
 assert.deepEqual(again,location,'same native setting must be stable across cuts');
});
