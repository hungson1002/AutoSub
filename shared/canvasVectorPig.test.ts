import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasProject} from './canvasAnimationStudio';
import {normalizeVectorAssets,normalizeVectorScene,compileVectorProject,evaluateVectorPart} from './canvasVectorScene';
import {vectorWorldMatrix,vectorPoint} from './canvasVectorTransform';
import {vectorSubjectCamera} from './canvasVectorFraming';
import {frameVectorScene} from './canvasVectorScene';

test('head and torso contours stay visible without a neck patch or a permanent smile',()=>{
  const pig=normalizeVectorAssets({pig:{rig:'simple-pig',toes:5}}).pig!,part=(id:string)=>pig.nodes.find(n=>n.id===id)!;
  assert.equal(part('face').type,'ellipse');assert.equal(part('face').stroke,'#080808');
  assert.equal(part('face').d,undefined);
  for(const side of ['fl','fr','hl','hr'])for(const id of ['thigh','shin'])assert.ok(!/z/i.test(part(id+'-'+side).d!));
  assert.equal(part('neck').fill,'none','the redundant neck patch cannot erase the torso outline');
  assert.equal(part('neck').stroke,'none');
  assert.equal(part('body').stroke,'#080808');
  assert.equal(part('mouth').d,'M 0 0');assert.equal(part('mouth').stroke,'none');
  const old={...pig,nodes:pig.nodes.map(n=>n.id==='face'?{...n,type:'path' as const,d:'M -23 -37 C 5 -52 45 -30 48 0 C 48 29 24 48 -12 41'}:
    n.id==='neck'?{...n,fill:'#786c60'}:n.id==='mouth'?{...n,d:'M 35 28 Q 42 31 49 28',stroke:'#080808'}:n)};
  assert.deepEqual(normalizeVectorAssets({pig:old}).pig,pig);
});

test('native pigs have a black dot eye, open joint contours and readable separate hoof tips, including old checkpoints',()=>{
  const assets=normalizeVectorAssets({pig:{rig:'simple-pig',palette:{skin:'#202422',ink:'#332b2a'}}}),pig=assets.pig!;
  assert.equal(pig.nodes.find(n=>n.id==='body')!.stroke,'#080808');
  assert.notEqual(pig.nodes.find(n=>n.id==='body')!.fill,'#202422');
  assert.equal(pig.nodes.find(n=>n.id==='eye')!.parent,'eyes');
  assert.equal(pig.nodes.find(n=>n.id==='eye')!.fill,'#080808');
  assert.ok(!pig.nodes.some(n=>['eye-white','eye-glint'].includes(n.id)));
  for(const side of ['fl','fr','hl','hr']){
    for(const id of ['thigh','shin'])assert.ok(!/z/i.test(pig.nodes.find(n=>n.id===id+'-'+side)!.d!),'no outlined closing edge across a joint');
    const toes=pig.nodes.filter(n=>n.parent==='hoof-'+side);
    assert.equal(toes.length,2);assert.ok(toes.every(n=>n.fill==='#b8aa91'&&n.stroke==='#080808'));
  }
  const old={...pig,nodes:[...pig.nodes,{id:'eye-white',type:'ellipse',parent:'eyes',rx:9,ry:11,fill:'#f3ead4'}]};
  assert.deepEqual(normalizeVectorAssets({pig:old}),assets);
  assert.deepEqual(normalizeVectorAssets(assets),assets);
});

test('a clue cut targets the evaluated physical hoof rather than the whole animal or guessed stage coordinates',()=>{
  const assets=normalizeVectorAssets({pig:{rig:'simple-pig',toes:5}}),p=createCanvasProject();
  const world=normalizeVectorScene({width:720,height:1280,nodes:[{id:'pig',type:'instance',asset:'pig',x:200,y:700,width:300,height:200}],ground:{y:1000,targets:[{target:'pig'}]},
    tracks:[{target:'pig/leg-fl',start:0,end:1,frames:[{t:0,rotation:-25}]}]},assets);
  const shot={target:'pig/hoof-fl',bounds:{x:-15,y:-12,width:30,height:12}};
  const camera=vectorSubjectCamera(world,assets,shot);
  const s={...p.scenes[0]!,durationMs:8000,vectorScene:frameVectorScene(world,camera)};
  const center=vectorPoint(vectorWorldMatrix('pig/hoof-fl',s,0,assets),0,-6);
  assert.ok(Math.abs(center.x-360)<1e-7&&Math.abs(center.y-640)<1e-7);
  assert.equal(camera[0]!.zoom,4);
  assert.equal(s.vectorScene.nodes.filter(n=>n.id==='pig').length,1,'same world and animal remain');
  assert.throws(()=>vectorSubjectCamera(world,assets,{...shot,target:'pig/missing'}),/existing instance part/);
  assert.throws(()=>vectorSubjectCamera(world,assets,{...shot,bounds:{x:0,y:0,width:0,height:12}}),/local bounds/);
});

test('pig scaffold has four attached leg chains and exactly five distinct digits per hoof',()=>{
  const assets=normalizeVectorAssets({pig:{rig:'simple-pig',toes:5}}),rig=assets.pig!;
  for(const side of ['fl','fr','hl','hr']){
    assert.equal(rig.nodes.find(n=>n.id==='knee-'+side)!.parent,'leg-'+side);
    assert.equal(rig.nodes.find(n=>n.id==='hoof-'+side)!.parent,'knee-'+side);
    assert.equal(rig.nodes.filter(n=>n.parent==='hoof-'+side).length,5);
  }
  assert.deepEqual(normalizeVectorAssets(assets),assets);
  assert.throws(()=>normalizeVectorAssets({bad:{rig:'simple-pig',toes:7}}),/toes/);
});

test('pig travel lifts swing hooves, plants stance hooves, stops at rest and holds that same position at a cut',()=>{
  const assets=normalizeVectorAssets({pig:{rig:'simple-pig',toes:5}}),p=createCanvasProject();
  const world={width:720,height:1280,nodes:[
    {id:'sky',type:'rect',width:720,height:1280,fill:'#112222'},
    {id:'pig',type:'instance',asset:'pig',x:80,y:700,width:250,height:240*250/360},
    {id:'gate',type:'rect',x:500,y:800,width:20,height:160,fill:'#445544'},
  ],ground:{y:1000,targets:[{target:'pig'},{target:'gate'}]}};
  const command={actor:'pig',to:'gate',gap:270,start:0,end:1};
  const s={...p.scenes[0]!,durationMs:8000,narration:'',vectorScene:normalizeVectorScene({...world,walks:[command]},assets)};
  const resting=vectorPoint(vectorWorldMatrix('pig/hoof-fl',s,0,assets),0,0);
  assert.ok(Math.abs(resting.y-1000)<1e-8,'hoof contact must align to ground, not asset canvas bottom');
  const dx=evaluateVectorPart('pig',s,8000).dx,sx=250/360,cycles=Math.ceil(Math.abs(dx/sx)/38);
  for(const side of ['fl','fr','hl','hr'])assert.ok(s.vectorScene.tracks.find(t=>t.target==='pig/knee-'+side)!.frames.every(f=>side.startsWith('f')?f.rotation!<=0:f.rotation!>=0),'foreleg elbow and hind stifle retain opposite bending planes');
  let lifted=false;
  for(let i=10;i<90;i++)for(const side of ['fl','fr','hl','hr']){
    const t=i/100,phase=cycles*t+(['fr','hl'].includes(side)?.5:0),f=phase-Math.floor(phase);
    const foot=vectorPoint(vectorWorldMatrix('pig/hoof-'+side,s,t*8000,assets),0,0);
    const rest=vectorPoint(vectorWorldMatrix('pig/hoof-'+side,s,0,assets),0,0);
    if(f>.6&&foot.y<rest.y-2)lifted=true;
    if(f>.1&&f<.4){
      assert.ok(Math.abs(foot.x-rest.x-Math.floor(phase)*dx/cycles)<1.3,'planted hoof must not slide');
      assert.ok(Math.abs(foot.y-rest.y)<1.3,'planted hoof must stay on the support');
    }
  }
  assert.ok(lifted);assert.ok(s.vectorScene.tracks.every(t=>t.frames.length<=32));
  const held={...s,vectorScene:normalizeVectorScene({...world,walks:[{...command,hold:true}]},assets)};
  for(const target of ['pig','pig/leg-fl','pig/knee-fl','pig/hoof-fl','pig/head-group'])
    assert.deepEqual(evaluateVectorPart(target,held,0),evaluateVectorPart(target,s,8000));
  assert.deepEqual(normalizeVectorScene(s.vectorScene,assets),s.vectorScene);
});

test('detail cuts on a pig retain their authored camera instead of using human head/foot bounds',()=>{
  const p=createCanvasProject();p.width=720;p.height=1280;p.vectorAssets=normalizeVectorAssets({pig:{rig:'simple-pig',toes:5}});
  p.scenes=[{...p.scenes[0]!,narration:'Năm móng.',vectorDirection:{purpose:'Count the physical digits',location:'yard',shot:{size:'detail',focus:'pig/hoof-fl',include:[]},beats:[]},
    vectorScene:normalizeVectorScene({width:720,height:1280,nodes:[{id:'pig',type:'instance',asset:'pig',x:200,y:700,width:300,height:200}],
      ground:{y:1000,targets:[{target:'pig'}]},camera:[{t:0,x:420,y:985,zoom:3.5}]},p.vectorAssets)}];
  assert.deepEqual(compileVectorProject(p).scenes[0]!.vectorScene!.tracks,p.scenes[0]!.vectorScene!.tracks);
});
