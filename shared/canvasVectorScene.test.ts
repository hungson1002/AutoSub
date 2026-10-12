import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVectorAssets,normalizeVectorScene,evaluateVectorPart,vectorTrackTiming,compileVectorProject,frameVectorScene} from './canvasVectorScene';
import type {VectorDrawing} from './canvasVectorScene';
import {compileCanvasProjectLayout} from './canvasLayoutCompiler';
import {createCanvasProject} from './canvasAnimationStudio';

const assets:Record<string,VectorDrawing>={dog:{width:100,height:100,nodes:[{id:'head',type:'group',x:50,y:20},{id:'jaw',type:'ellipse',parent:'head',rx:20,ry:4,fill:'#fff'}]}};
const drawing={width:720,height:1280,nodes:[{id:'sky',type:'rect',width:720,height:1280,fill:'#111'},{id:'dog',type:'instance',asset:'dog',x:100,y:600,width:300,height:300}],
  tracks:[{target:'dog/head',start:.2,end:.6,frames:[{t:0,rotation:0},{t:1,rotation:-30}]},{target:'dog/jaw',start:.3,end:.6,frames:[{t:0,scaleY:1},{t:1,scaleY:4}]}]};
test('camera zoom transforms the complete stage and canonical compilation is idempotent',()=>{
  const original=normalizeVectorScene({...drawing,nodes:[...drawing.nodes,{id:'boat',type:'rect',x:80,y:900,width:500,height:160,fill:'#654'}]},assets);
  const before=structuredClone(original);
  const framed=normalizeVectorScene({...original,camera:[{t:0,x:360,y:640,zoom:1},{t:1,x:260,y:800,zoom:1.8}]},assets);
  assert.deepEqual(original,before,'framing cannot relocate or resize the actor/support geometry');
  assert.equal(framed.nodes.find(n=>n.id==='boat')!.parent,'camera-world');
  assert.equal(framed.nodes.find(n=>n.id==='dog')!.parent,'camera-world');
  assert.equal(framed.nodes.find(n=>n.id==='sky')!.parent,'camera-world');
  assert.deepEqual(normalizeVectorScene(framed,assets),framed,'saved/recompiled cameras must not zoom twice');
  const scene={...project().scenes[0]!,vectorScene:framed};
  const camera=evaluateVectorPart('camera-world',scene,scene.durationMs);
  assert.equal(camera.scaleX,1.8);assert.equal(camera.scaleY,1.8);
  assert.equal(camera.dx,360-260*1.8);assert.equal(camera.dy,640-800*1.8);
  assert.ok(900*camera.scaleY+camera.dy<1280,'boat stays in the same framed scene');
  assert.deepEqual(framed.tracks.slice(0,-1),original.tracks,'joint tracks retain their targets and timing');
  assert.throws(()=>frameVectorScene(original,[{t:0,x:0,y:0,zoom:0}]),/numeric/);
  assert.throws(()=>frameVectorScene(original,[{t:0,x:0,y:0,zoom:1},{t:0,x:0,y:0,zoom:2}]),/duplicate/);
});
function project(){
  const p=createCanvasProject();p.width=720;p.height=1280;p.vectorAssets=normalizeVectorAssets(assets);
  p.scenes=[{...p.scenes[0]!,durationMs:10000,narration:'Con chó ngẩng đầu và tru.',objects:[],vectorScene:normalizeVectorScene(drawing,p.vectorAssets)}];
  return compileVectorProject(p);
}

test('independent head/jaw acting interpolates without rotating the entire creature and persists',()=>{
  const scene=project().scenes[0]!;
  assert.equal(evaluateVectorPart('dog/head',scene,4000).rotation,-15);
  assert.equal(evaluateVectorPart('dog',scene,4000).rotation,0);
  assert.equal(evaluateVectorPart('dog/jaw',scene,4500).scaleY,2.5);
  assert.equal(evaluateVectorPart('dog/head',scene,9000).rotation,-30);
});
test('carried props can inherit a reusable actor transform without admitting missing or cyclic parents',()=>{
  const withProp={...drawing,nodes:[...drawing.nodes,{id:'lantern',type:'ellipse',parent:'dog',x:90,y:60,rx:8,ry:10,fill:'#f90'}]};
  assert.equal(normalizeVectorScene(withProp,assets).nodes.at(-1)?.parent,'dog');
  assert.throws(()=>normalizeVectorScene({...withProp,nodes:withProp.nodes.map(n=>n.id==='dog'?{...n,parent:'lantern'}:n)},assets),/parent/);
});
test('nested SVG groups retain face parts and resolve verified joint paths',()=>{
  const nested=normalizeVectorAssets({dog:{width:100,height:100,nodes:[{id:'head',type:'group',nodes:[{id:'jaw',type:'group',children:[{id:'teeth',type:'path',d:'M0 0 L10 0 L5 4 Z',fill:'#fff'}]}]}]}});
  assert.equal(nested.dog!.nodes.length,3);assert.equal(nested.dog!.nodes[2]!.parent,'jaw');
  const shot={...drawing,tracks:[{target:'dog/head/jaw',start:0,end:1,frames:[{t:0,rotation:0},{t:1,rotation:20}]}]};
  assert.equal(normalizeVectorScene(shot,nested).tracks[0]!.target,'dog/jaw');
  assert.equal(normalizeVectorScene({...nested.dog,tracks:[{...shot.tracks[0],target:'head/jaw'}]},{}).tracks[0]!.target,'jaw');
  assert.throws(()=>normalizeVectorScene({...shot,tracks:[{...shot.tracks[0],target:'dog/teeth/jaw'}]},nested),/unknown animated part/);
  assert.throws(()=>normalizeVectorAssets({dog:{width:100,height:100,nodes:[{id:'head',type:'group',nodes:[{id:'eye',type:'ellipse',parent:'other',rx:1,ry:1}]}]}}),/conflicting nested parent/);
});
test('initially hidden eyes can reveal, and a delayed reveal never flashes before its start',()=>{
  const scene=project().scenes[0]!;
  scene.vectorScene!.tracks=[{target:'dog/head',start:.4,end:.5,frames:[{t:0,opacity:0},{t:1,opacity:1}]}];
  assert.equal(evaluateVectorPart('dog/head',scene,1000,0).opacity,0);
  assert.equal(evaluateVectorPart('dog/head',scene,1000,1).opacity,0);
  assert.equal(evaluateVectorPart('dog/head',scene,4500,0).opacity,.5);
  assert.equal(evaluateVectorPart('dog/head',scene,9000,0).opacity,1);
  scene.vectorScene!.tracks.push({target:'dog/head',start:.8,end:.9,frames:[{t:0,opacity:1},{t:1,opacity:0}]});
  assert.equal(evaluateVectorPart('dog/head',scene,7000,0).opacity,1);
});
test('a missing initial SVG move has a bounded repair without admitting markup',()=>{
  const p=normalizeVectorScene({width:720,height:1280,nodes:[{id:'shirt',type:'path',d:'-120 180 L-100 60 L50 40 Z',fill:'#123'}]},{});
  assert.equal(p.nodes[0]!.d,'M -120 180 L-100 60 L50 40 Z');
});
test('a delayed latch holds its authored start pose without snapping, and later tracks preserve earlier results',()=>{
  const scene=project().scenes[0]!;
  scene.vectorScene!.tracks=[{target:'dog/head',start:.3,end:.6,frames:[{t:0,dy:-180,scaleX:.7},{t:1,dy:0,scaleX:1}]},
    {target:'dog/head',start:.8,end:.9,frames:[{t:0,dy:0},{t:1,dy:20}]}];
  assert.equal(evaluateVectorPart('dog/head',scene,1000).dy,-180);
  assert.equal(evaluateVectorPart('dog/head',scene,2999).dy,evaluateVectorPart('dog/head',scene,3000).dy);
  assert.equal(evaluateVectorPart('dog/head',scene,1000).scaleX,.7);
  assert.equal(evaluateVectorPart('dog/head',scene,4500).dy,-90);
  assert.equal(evaluateVectorPart('dog/head',scene,7000).dy,0);
  assert.equal(evaluateVectorPart('dog/head',scene,9000).dy,20);
});
test('SVG ellipse center pivots normalize once, while explicit local orbit pivots remain authored',()=>{
  const raw={width:720,height:1280,nodes:[{id:'eye',type:'ellipse',x:405,y:485,pivotX:405,pivotY:485,rx:22,ry:12,rotation:18}]};
  const centered=normalizeVectorScene(raw,{});
  assert.equal(centered.nodes[0]!.pivotX,0);assert.equal(centered.nodes[0]!.pivotY,0);
  assert.deepEqual(normalizeVectorScene(centered,{}),centered,'canonical pivots must be idempotent');
  const orbit=normalizeVectorScene({...raw,nodes:raw.nodes.map(n=>({...n,pivotSpace:'local'}))},{});
  assert.equal(orbit.nodes[0]!.pivotX,405);assert.deepEqual(normalizeVectorScene(orbit,{}),orbit);
  const parent=normalizeVectorScene({...raw,nodes:raw.nodes.map(n=>({...n,pivotSpace:'parent'}))},{});
  assert.equal(parent.nodes[0]!.pivotX,0);
});
test('resume and imported vector projects reject unsafe or duplicate shot file identities',()=>{
  const p=project();
  assert.throws(()=>compileVectorProject({...p,scenes:[{...p.scenes[0]!,id:'../../outside'}]}),/identity/);
  assert.throws(()=>compileVectorProject({...p,scenes:[p.scenes[0]!,p.scenes[0]!]}),/duplicate shot/);
});
test('sparse channels and sequential tracks preserve prior final states',()=>{
  const p=project(),scene=p.scenes[0]!;
  scene.vectorScene!.tracks=[{target:'dog',start:0,end:.2,frames:[{t:0,dx:0},{t:1,dx:100}]},
    {target:'dog',start:.4,end:.8,frames:[{t:0,rotation:0},{t:.5,opacity:.5},{t:1,rotation:60}]}];
  const state=evaluateVectorPart('dog',scene,6000);
  assert.equal(state.dx,100);assert.equal(state.rotation,30);assert.equal(state.opacity,.5);
});
test('code-authored geometry survives layout compilation, orientation and checkpoint roundtrips',()=>{
  const p=project(),once=compileCanvasProjectLayout(p),twice=compileCanvasProjectLayout(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(once,twice);
  assert.equal(twice.scenes[0]!.vectorScene!.nodes[1]!.x,100);
  assert.deepEqual(twice.scenes[0]!.objects,[]);
  assert.throws(()=>compileVectorProject({...createCanvasProject(),vectorAssets:assets}),/every shot/);
});
test('speech cues use measured voiced time and skip silence instead of changing animation duration',()=>{
  const scene=project().scenes[0]!;
  scene.dialogue=[{id:'n',speaker:'Người kể',text:'Con chó ngẩng đầu và tru.',atMs:200,durationMs:8000,speechWindows:[{startMs:500,endMs:2500},{startMs:5000,endMs:7000}]}];
  const track={target:'dog/head',start:.1,end:.3,cue:'ngẩng đầu',frames:[{t:0,rotation:0},{t:1,rotation:-30}]};
  const timing=vectorTrackTiming(track,scene);
  assert.ok(timing.start>=700&&timing.start<=2700);assert.equal(timing.end-timing.start,2000);
});

test('ordered reveals share measured narration timing and remain ordered after checkpoint recompilation',()=>{
  const s=project().scenes[0]!;
  s.durationMs=10600;
  s.narration='Water creeps. Four footprints appear toward him.';
  s.dialogue=[{id:'n',speaker:'Narrator',text:s.narration,atMs:220,durationMs:9178,
    speechWindows:[{startMs:0,endMs:2700},{startMs:3546,endMs:4991},{startMs:5828,endMs:9030}]}];
  const nodes=Array.from({length:4},(_,i)=>({id:`foot-${i}`,type:'ellipse',rx:8,ry:4}));
  s.vectorScene=normalizeVectorScene({width:720,height:1280,nodes,reveals:[{
    targets:nodes.map(n=>n.id),cue:'footprints appear',start:0,end:.015,stepMs:350,
  }]},{},s.narration);
  const starts=s.vectorScene.tracks.map(t=>vectorTrackTiming(t,s).start);
  for(let i=1;i<starts.length;i++)assert.equal(starts[i]!-starts[i-1]!,350);
  for(let i=0;i<4;i++){
    assert.equal(evaluateVectorPart(`foot-${i}`,s,starts[i]!-1).opacity,0);
    assert.ok(evaluateVectorPart(`foot-${i}`,s,starts[i]!+160).opacity>.99);
    assert.equal(evaluateVectorPart(`foot-${i}`,s,10599).opacity,1);
  }
  assert.deepEqual(normalizeVectorScene(JSON.parse(JSON.stringify(s.vectorScene)),{},s.narration),s.vectorScene);
  assert.throws(()=>normalizeVectorScene({width:720,height:1280,nodes,reveals:[{targets:['foot-0','foot-0']}]},{}),/distinct/);
  assert.throws(()=>normalizeVectorScene({width:720,height:1280,nodes,reveals:[{targets:['missing']}]},{}),/unknown animated/);
  assert.throws(()=>normalizeVectorScene({width:720,height:1280,nodes,tracks:[{target:'foot-0',cueOffsetMs:-1,frames:[{t:0,opacity:1}]}]},{}),/numeric/);
});

test('creeping reveal becomes visible promptly and grows instead of slowly fading the entire trail',()=>{
  const s=project().scenes[0]!;
  s.vectorScene=normalizeVectorScene({width:720,height:1280,nodes:[{id:'water',type:'path',d:'M0 0 L100 0',stroke:'#abc',strokeWidth:4}],
    reveals:[{targets:['water'],start:.1,end:.3,grow:'x'}]},{});
  assert.equal(evaluateVectorPart('water',s,999).opacity,0);
  const first=evaluateVectorPart('water',s,1100),middle=evaluateVectorPart('water',s,2000),last=evaluateVectorPart('water',s,3000);
  assert.equal(first.opacity,1);assert.ok(first.scaleX<.2);
  assert.ok(middle.scaleX>first.scaleX&&middle.scaleX<1);
  assert.equal(last.scaleX,1);assert.equal(last.opacity,1);
});
test('broken graph, external HTML, missing assets and conflicting motion are rejected',()=>{
  const library=normalizeVectorAssets(assets);
  assert.throws(()=>normalizeVectorScene({...drawing,nodes:[{id:'bad',type:'path',d:'<svg onload=alert(1)>'}]},library),/SVG path/);
  assert.throws(()=>normalizeVectorScene({...drawing,nodes:[{id:'bad',type:'group',parent:'bad'}]},library),/cyclic/);
  assert.throws(()=>normalizeVectorScene({...drawing,nodes:[{id:'bad',type:'instance',asset:'missing'}]},library),/missing asset/);
  assert.throws(()=>normalizeVectorScene({...drawing,tracks:[...drawing.tracks,{...drawing.tracks[0],start:.3,end:.8}]},library),/overlapping/);
  assert.throws(()=>normalizeVectorAssets({'__proto__':{},constructor:assets.dog}),/identity/);
  assert.throws(()=>normalizeVectorScene({width:720,height:1280,nodes:[{id:'group',type:'group',clip:{x:0,y:200}}]},{}),/clip needs/);
});

test('smooth acting preserves velocity through intermediate poses and rests at real reversals',()=>{
  const s=project().scenes[0]!;
  s.vectorScene=normalizeVectorScene({...drawing,tracks:[{target:'dog/head',start:0,end:1,frames:[
    {t:0,rotation:0,easing:'smooth'},{t:.25,rotation:10,easing:'smooth'},
    {t:.5,rotation:20,easing:'smooth'},{t:.75,rotation:10,easing:'smooth'},{t:1,rotation:0,easing:'smooth'},
  ]}]},assets);
  const at=(ms:number)=>evaluateVectorPart('dog/head',s,ms).rotation;
  const before=(at(2500)-at(2499)),after=(at(2501)-at(2500));
  assert.ok(before>.003&&after>.003,'an intermediate key must not pause');
  assert.ok(Math.abs(before-after)<.00001,'left/right velocities must agree');
  assert.ok(Math.abs(at(5000)-at(4999))<.00001,'a reversal should slow smoothly');
  for(let ms=0;ms<=10000;ms+=17)assert.ok(at(ms)>=0&&at(ms)<=20,'no overshoot');
  assert.equal(at(10000),0);
});

test('smooth sparse channels stay bounded and survive serialization with existing easing unchanged',()=>{
  const s=project().scenes[0]!;
  const scene=normalizeVectorScene({...drawing,tracks:[{target:'dog/head',start:0,end:1,frames:[
    {t:0,opacity:0,easing:'smooth'},{t:.1,rotation:5},{t:.2,opacity:.9,easing:'smooth'},
    {t:.85,opacity:.95,easing:'smooth'},{t:1,opacity:1,easing:'smooth'},
  ]}]},assets);
  assert.deepEqual(normalizeVectorScene(JSON.parse(JSON.stringify(scene)),assets),scene);
  s.vectorScene=scene;
  for(let ms=0;ms<=10000;ms+=13){const opacity=evaluateVectorPart('dog/head',s,ms).opacity;assert.ok(opacity>=0&&opacity<=1);}
  s.vectorScene!.tracks[0]!.frames=[{t:0,rotation:0},{t:1,rotation:10,easing:'linear'}];
  assert.equal(evaluateVectorPart('dog/head',s,2500).rotation,2.5);
});


test('a cut to a close-up starts at its final framing and never grows across the shot',()=>{
  const scene=project().scenes[0]!;
  scene.vectorScene=normalizeVectorScene({...drawing,camera:[{t:0,x:260,y:800,zoom:1.8}]},assets);
  const first=evaluateVectorPart('camera-world',scene,0);
  assert.equal(first.scaleX,1.8);
  for(const ms of [1,33,500,2000,9999])assert.deepEqual(evaluateVectorPart('camera-world',scene,ms),first);
  assert.notEqual(evaluateVectorPart('dog/head',scene,4000).rotation,evaluateVectorPart('dog/head',scene,2000).rotation,'acting continues under the fixed framing');
});
