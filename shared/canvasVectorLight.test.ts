import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVectorLight,vectorLightState,readableVectorNightAssets,readableVectorNightScene} from './canvasVectorLight';
import {normalizeVectorAssets,normalizeVectorScene} from './canvasVectorScene';

test('night floors and scenery outside the ground-target list retain visible depth midtones',()=>{
  const d=normalizeVectorScene({width:720,height:1280,nodes:[
    {id:'sky',type:'rect',width:720,height:1280,fill:'#101b32'},
    {id:'far-hill',type:'path',d:'M 0 600 Q 300 300 720 600 Z',fill:'#162524',stroke:'#080808'},
    {id:'yard-floor',type:'rect',y:800,width:720,height:480,fill:'#27251e'},
    {id:'door-void',type:'rect',x:100,y:600,width:80,height:200,fill:'#050505'},
  ]},{});
  const fixed=readableVectorNightScene(d,'night horror');
  for(const i of [1,2]){
    const rgb=[1,3,5].map(at=>parseInt(fixed.nodes[i]!.fill!.slice(at,at+2),16));
    assert.ok(rgb[0]!*.2126+rgb[1]!*.7152+rgb[2]!*.0722>=72);
    assert.equal(fixed.nodes[i]!.stroke,d.nodes[i]!.stroke);
  }
  assert.equal(fixed.nodes[0]!.fill,d.nodes[0]!.fill);
  assert.equal(fixed.nodes[3]!.fill,d.nodes[3]!.fill);
  assert.deepEqual(readableVectorNightScene(fixed,'night horror'),fixed);
});

test('night subjects and props retain visible midtones without brightening sky, ink or eyes',()=>{
  const assets=normalizeVectorAssets({animal:{width:360,height:260,nodes:[
    {id:'head-group',type:'group'},
    {id:'body',type:'rect',width:100,height:50,fill:'#151921',stroke:'#0a0d12'},
    {id:'leg-fl',type:'rect',width:10,height:40,fill:'#101318'},
    {id:'nose',type:'ellipse',rx:5,ry:4,fill:'#07090c'},
    {id:'eyes',type:'ellipse',rx:6,ry:5,fill:'#f2b824'},
  ]},well:{width:100,height:100,nodes:[
    {id:'body',type:'rect',width:100,height:100,fill:'#20282a'},
    {id:'hole',type:'ellipse',rx:40,ry:10,fill:'#05070a'},
  ]}});
  const before=structuredClone(assets),fixed=readableVectorNightAssets(assets,'Kinh dị dân gian, trời đêm');
  const brightness=(color:string)=>{const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));return rgb[0]!*.2126+rgb[1]!*.7152+rgb[2]!*.0722;};
  assert.ok(brightness(fixed.animal!.nodes[1]!.fill!)>=82);
  assert.ok(brightness(fixed.animal!.nodes[2]!.fill!)>=82);
  assert.ok(brightness(fixed.well!.nodes[0]!.fill!)>=60);
  for(const id of ['nose','eyes'])assert.deepEqual(fixed.animal!.nodes.find(n=>n.id===id),assets.animal!.nodes.find(n=>n.id===id));
  assert.equal(fixed.animal!.nodes[1]!.stroke,'#0a0d12');
  assert.equal(fixed.well!.nodes[1]!.fill,'#05070a');
  assert.deepEqual(readableVectorNightAssets(fixed,'night horror'),fixed);
  assert.deepEqual(readableVectorNightAssets(assets,'Bài học khoa học nhiều màu'),assets);
  assert.deepEqual(assets,before);
});

test('night doors remain readable while wet marks, the background and intentional fades stay authored',()=>{
  const assets=normalizeVectorAssets({print:{rig:'wet-footprint'}});
  assert.deepEqual(readableVectorNightAssets(assets,'night'),assets,'a wet sole must not become a pale prop');
  const d=normalizeVectorScene({width:320,height:640,nodes:[
    {id:'sky',type:'rect',width:320,height:640,fill:'#0a0f16'},
    {id:'door',type:'group',groundAnchor:{x:40,y:400}},
    {id:'leaf',type:'rect',parent:'door',width:80,height:400,fill:'#2d2218',stroke:'#080808'},
    {id:'wash',type:'rect',width:320,height:640,fill:'#000000',opacity:.22},
  ]},{});
  const before=structuredClone(d),fixed=readableVectorNightScene(d,'night');
  assert.equal(fixed.nodes[0]!.fill,d.nodes[0]!.fill);
  assert.notEqual(fixed.nodes[2]!.fill,d.nodes[2]!.fill);
  assert.equal(fixed.nodes[2]!.stroke,'#080808');
  assert.equal(fixed.nodes[3]!.opacity,.12);
  assert.deepEqual(readableVectorNightScene(fixed,'night'),fixed);assert.deepEqual(d,before);
  const fade={...d,tracks:[{target:'wash',start:0,end:1,frames:[{t:0,opacity:0},{t:1,opacity:1}]}]};
  assert.equal(readableVectorNightScene(fade,'night').nodes[3]!.opacity,.22);
});

test('emitter metadata survives normalization without duplicating its geometry',()=>{
  const drawing={width:320,height:320,nodes:[{id:'moon',type:'ellipse',x:160,y:160,rx:20,ry:20,fill:'#111',light:{kind:'moon',radius:60}}]};
  const first=normalizeVectorScene(drawing,{});
  assert.deepEqual(normalizeVectorScene(first,{}),first);
  assert.equal(first.nodes.length,1);
  assert.equal(normalizeVectorAssets({moon:drawing}).moon!.nodes[0]!.light!.kind,'moon');
  assert.throws(()=>normalizeVectorScene({...drawing,nodes:[{...drawing.nodes[0],type:'instance',asset:'moon'}]},{}),/emitter/);
  for(const raw of [{kind:'flame',radius:-2},{kind:'flame',radius:Infinity},{kind:'moon',radius:70,color:'url(https://bad)'},{kind:'moon',intensity:2}])assert.throws(()=>normalizeVectorLight(raw));
});

test('flame varies deterministically around its anchor while moon brightness holds',()=>{
  const flame=normalizeVectorLight({kind:'flame',radius:70,x:50,y:100});
  const first=vectorLightState(flame,0),next=vectorLightState(flame,137);
  assert.notEqual(first.scaleY,next.scaleY);
  assert.deepEqual(vectorLightState(flame,137),next);
  assert.equal(first.x,next.x);assert.equal(first.y,next.y);
  for(let ms=0;ms<10000;ms+=17){
    const state=vectorLightState(flame,ms);
    assert.ok(state.scaleY>.88&&state.scaleY<1.12);
    assert.ok(state.rings.every(r=>r.opacity>=0&&r.opacity<=1));
  }
  const moon=normalizeVectorLight({kind:'moon',radius:70});
  assert.deepEqual(vectorLightState(moon,0),vectorLightState(moon,8000));
  assert.equal(vectorLightState({...flame,intensity:0},100).rings.every(r=>r.opacity===0),true);
});
