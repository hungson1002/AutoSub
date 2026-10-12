import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasProject} from './canvasAnimationStudio';
import {normalizeVectorAssets,normalizeVectorScene,compileVectorProject,evaluateVectorPart} from './canvasVectorScene';
import {vectorPoint,vectorWorldMatrix} from './canvasVectorTransform';
import {vectorPropGrip,vectorCurveBounds} from './canvasVectorProps';

const assets=normalizeVectorAssets({person:{rig:'simple-human'},lamp:{rig:'lantern'}});
const world={width:720,height:1280,nodes:[
  {id:'person',type:'instance',asset:'person',x:100,y:400,width:200,height:400},
  {id:'lamp',type:'instance',asset:'lamp',x:230,y:540,width:45,height:75},
]};
const carry={actor:'person',arm:'r',prop:'lamp',grip:{x:30,y:6},hang:true};

test('a generated curved lantern handle corrects the guessed grip and misplaced flame through cuts',()=>{
  const custom={width:60,height:100,nodes:[
    {id:'lamp-handle',type:'path',d:'M18,30 C18,8 42,8 42,30',fill:'none',stroke:'#636058',strokeWidth:3},
    {id:'lamp-glass',type:'rect',x:16,y:40,width:28,height:36,fill:'#5e4925'},
    {id:'flame',type:'path',d:'M30,68 C24,60 25,48 30,42 C35,48 36,60 30,68 Z',
      fill:'#ffe17d',light:{kind:'flame',radius:65,x:0,y:0}},
  ]};
  const a=normalizeVectorAssets({person:{rig:'simple-human'},lamp:custom});
  assert.deepEqual(a.lamp!.grip,{x:30,y:13.5},'grip touches the actual cubic handle, not its control points');
  const flame=a.lamp!.nodes.find(n=>n.id==='flame')!;
  assert.ok(Math.abs(flame.light!.x!-30)<1);assert.equal(flame.light!.y,55);
  for(const mirrored of [false,true]){
    const d=normalizeVectorScene({...world,nodes:world.nodes.map(n=>n.id==='person'?{...n,scaleX:mirrored?-1:1}:n),
      carries:[carry],camera:[{t:0,x:270,y:660,zoom:1.5}],
      reaches:[{actor:'person',arm:'r',point:{x:215,y:240},start:0,end:1}]},a);
    const p=createCanvasProject();p.width=720;p.height=1280;p.vectorAssets=a;
    p.scenes=[{...p.scenes[0]!,id:'first',durationMs:6000,vectorScene:d},
      {...p.scenes[0]!,id:'next',durationMs:6000,vectorScene:{...d,tracks:[]}}];
    const compiled=compileVectorProject(p);
    for(const s of compiled.scenes)for(let t=0;t<=6000;t+=200){
      const hand=vectorPoint(vectorWorldMatrix('person/hand-r',s,t),0,0);
      const actual=vectorPoint(vectorWorldMatrix('lamp',s,t),30,13.5);
      assert.ok(Math.hypot(hand.x-actual.x,hand.y-actual.y)<1e-7,'visible handle remains on the hand');
    }
    assert.deepEqual(compileVectorProject(compiled),compiled);
    assert.deepEqual(vectorPropGrip(a.lamp,d.nodes.find(n=>n.id==='lamp')),{x:30,y:13.5});
  }
  assert.equal(custom.nodes[2]!.light!.x,0,'source artwork stays immutable');
  assert.equal(vectorCurveBounds('M0 0 A10 10 0 0 0 20 0'),undefined,'unsupported arcs must not be guessed');
  assert.deepEqual(vectorCurveBounds('M0 30 Q0 0 50 30')!.topPoint,{x:12.5,y:15},'an asymmetric handle uses a point on its actual curve');
  assert.equal(vectorCurveBounds('M10 10 L20 10 L20 20 Z m5 0 l2 0')!.right,20,'relative subpaths start at the closed contour origin');
});

test('an authored knife uses the actual handle center on the other hand, at every frame',()=>{
  const a=normalizeVectorAssets({...assets,knife:{width:40,height:90,nodes:[{id:'blade',type:'rect',x:12,y:0,width:14,height:55,fill:'#aaa'},{id:'handle',type:'rect',x:16,y:52,width:6,height:28,fill:'#321'}]}});
  assert.deepEqual(a.knife!.grip,{x:19,y:66});
  delete a.knife!.grip;delete a.lamp!.grip; // Raw legacy repair inputs also work.
  const s={...createCanvasProject().scenes[0]!,durationMs:5000,vectorScene:normalizeVectorScene({...world,nodes:[...world.nodes,{id:'knife',type:'instance',asset:'knife',width:28,height:70,x:160,y:720}],
    carries:[carry,{actor:'person',arm:'l',prop:'knife'}],reaches:[{actor:'person',arm:'l',point:{x:30,y:180},start:0,end:1}]},a)};
  for(let t=0;t<=5000;t+=1000/30){
    const hand=vectorPoint(vectorWorldMatrix('person/hand-l',s,t,a),0,0),grip=vectorPoint(vectorWorldMatrix('knife',s,t,a),19,66);
    assert.ok(Math.hypot(hand.x-grip.x,hand.y-grip.y)<1e-7);
  }
});
function scene(raw:unknown){return {...createCanvasProject().scenes[0]!,id:'carry',durationMs:6000,vectorScene:normalizeVectorScene(raw,assets),vectorAssetLibrary:assets};}

test('a carried lamp grips the hand through shoulder/elbow motion, mirroring and camera transforms',()=>{
  for(const mirrored of [false,true]){
    const s=scene({...world,nodes:world.nodes.map(n=>n.id==='person'&&mirrored?{...n,scaleX:-1}:n),
      carries:[carry],camera:[{t:0,x:270,y:660,zoom:1.5}],
      reaches:[{actor:'person',arm:'r',point:{x:215,y:180},start:0,end:1}]});
    for(let t=0;t<=6000;t+=1000/30){
      const hand=vectorPoint(vectorWorldMatrix('person/hand-r',s,t,assets),0,0);
      const m=vectorWorldMatrix('lamp',s,t,assets),grip=vectorPoint(m,30,6);
      assert.ok(Math.hypot(hand.x-grip.x,hand.y-grip.y)<1e-7,'the grip stays on fingers, not elbow');
      assert.ok(Math.abs(m.c)<1e-7&&m.d>0,'hanging lamp stays upright');
    }
    assert.deepEqual(normalizeVectorScene(s.vectorScene,assets),s.vectorScene);
  }
});

test('carry replaces obsolete world travel but preserves the narrated visibility event',()=>{
  const drawing=normalizeVectorScene({...world,carries:[carry],tracks:[{target:'lamp',start:0,end:1,
    frames:[{t:0,dx:0,dy:0,opacity:0},{t:1,dx:200,dy:-120,opacity:1}]}]},assets);
  assert.ok(drawing.tracks[0]!.frames.every(f=>f.dx===undefined&&f.dy===undefined));
  assert.equal(drawing.tracks[0]!.frames[1]!.opacity,1);
  assert.equal(drawing.nodes.find(n=>n.id==='lamp')!.attachTo,'person/hand-r');
  assert.throws(()=>normalizeVectorScene({...world,carries:[carry,{...carry,prop:'missing'}]},assets),/carry/);
  assert.throws(()=>normalizeVectorScene({...world,carries:[{...carry,grip:{x:999,y:6}}]},assets),/grip/);
  assert.throws(()=>normalizeVectorScene({...world,carries:[carry,carry]},assets),/one carried prop/);
});

test('frontal elbows keep bounded flexion and connected bones on either projected side',()=>{
  const s=scene({...world,tracks:['l','r'].map(side=>({target:`person/forearm-${side}`,start:0,end:1,
    frames:[{t:0,rotation:0},{t:.5,rotation:side==='l'?75:-75},{t:1,rotation:side==='l'?180:-180}]}))});
  for(const side of ['l','r'])for(let t=0;t<=6000;t+=33){
    const angle=evaluateVectorPart(`person/forearm-${side}`,s,t).rotation;
    assert.ok(Math.abs(angle)<=145);
    const elbow=vectorPoint(vectorWorldMatrix(`person/forearm-${side}`,s,t,assets),0,0);
    const hand=vectorPoint(vectorWorldMatrix(`person/hand-${side}`,s,t,assets),0,0);
    assert.ok(Math.abs(Math.hypot(hand.x-elbow.x,hand.y-elbow.y)-57*200/240)<1e-7);
  }
});

test('unlabelled intermediate motion keys have matching velocities and successive gestures do not reset the joint',()=>{
  const p=createCanvasProject();p.width=720;p.height=1280;p.vectorAssets=assets;
  p.scenes=[scene({...world,tracks:[
    {target:'person/arm-r',start:0,end:.5,frames:[{t:0,rotation:0},{t:.5,rotation:-20},{t:1,rotation:-40}]},
    {target:'person/arm-r',start:.6,end:1,frames:[{t:0,rotation:0},{t:1,rotation:-60}]},
  ]})];
  const s=compileVectorProject(p).scenes[0]!,at=(t:number)=>evaluateVectorPart('person/arm-r',s,t).rotation;
  assert.ok(Math.abs((at(1500)-at(1499))-(at(1501)-at(1500)))<.0001,'no velocity corner at an intermediate key');
  assert.equal(at(3599),-40);assert.equal(at(3600),-40,'second gesture begins at previous result');
  assert.ok(Math.abs(at(3601)-at(3600))<.001);
  assert.deepEqual(compileVectorProject(compileVectorProject(p)),compileVectorProject(p));
});
