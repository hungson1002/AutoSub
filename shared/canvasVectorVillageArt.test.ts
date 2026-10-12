import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasProject} from './canvasAnimationStudio';
import {normalizeVectorAssets,normalizeVectorScene,compileVectorProject,evaluateVectorPart} from './canvasVectorScene';
import {vectorPoint,vectorWorldMatrix} from './canvasVectorTransform';
import {puppetHandOpacity,puppetMouthState} from './canvasVectorPuppet';

const spec={rig:'simple-puppet',design:'village',finish:'handdrawn',hair:'side-part',outfit:'tunic'};
test('only the actual village speaker shows a mouth; silence/narration/crowds do not, while emotion remains visible',()=>{
  const p=createCanvasProject();p.width=720;p.height=720;
  p.vectorAssets=normalizeVectorAssets({hero:{...spec,expression:'soft'},crowd:spec,scared:{...spec,expression:'surprised'}});
  p.scenes=[{...p.scenes[0]!,durationMs:4000,narration:'',objects:[],dialogue:[
    {id:'n',speaker:'Narrator',text:'They wait.',atMs:0,durationMs:800},
    {id:'a',speaker:'Lan',characterKey:'lan',text:'Hello.',atMs:1000,durationMs:1800,speechWindows:[{startMs:0,endMs:500},{startMs:900,endMs:1400}],speechEnvelope:[{atMs:0,level:.8},{atMs:1800,level:.8}]},
    {id:'b',speaker:'bystander',text:'Who?',atMs:3000,durationMs:600},
  ],vectorScene:normalizeVectorScene({width:720,height:720,nodes:[
    {id:'person',type:'instance',asset:'hero',characterKey:'lan',x:30,y:300},
    {id:'bystander',type:'instance',asset:'crowd',x:220,y:300},
    {id:'afraid',type:'instance',asset:'scared',x:420,y:300}],
    reactions:[{actor:'person',kind:'fear',start:.9,end:1}],
  },p.vectorAssets)}];
  const scene=compileVectorProject(p).scenes[0]!,assets=p.vectorAssets;
  const mouth=(id:string,at:number)=>puppetMouthState(id+'/mouth',assets[scene.vectorScene!.nodes.find(n=>n.id===id)!.asset!]!,scene,at);
  assert.equal(scene.vectorScene!.nodes.find(n=>n.id==='person')!.characterKey,'lan','speaker binding survives normalization');
  for(const at of [200,900,1600,2700,3200])assert.equal(mouth('person',at).opacity,0,`main actor is silent at ${at}`);
  assert.equal(mouth('person',1200).opacity,1);assert.equal(mouth('person',2100).opacity,1);
  assert.notEqual(mouth('person',1200).d,assets.hero!.nodes.find(n=>n.id==='mouth')!.d,'speaking opens the native mouth');
  assert.equal(mouth('bystander',1200).opacity,0);assert.equal(mouth('bystander',3200).opacity,1);
  assert.equal(mouth('afraid',200).opacity,1,'a selected surprised face is an intentional expression');
  assert.equal(mouth('person',3800).opacity,1,'native fear reveals the mouth even in silence');
  const quiet={...scene,dialogue:scene.dialogue!.map(line=>line.id==='a'?{...line,speechEnvelope:[{atMs:0,level:0},{atMs:1800,level:0}]}:line)};
  assert.equal(puppetMouthState('person/mouth',assets.hero!,quiet,1200).opacity,0,'measured silent voice energy must not draw a resting mouth');
  const retained={...assets.hero!,nodes:assets.hero!.nodes.filter(n=>n.id!=='village-mouth-cued')};
  assert.deepEqual(puppetMouthState('person/mouth',retained,scene,200),{},'older expanded art retains its existing appearance');
  assert.deepEqual(compileVectorProject(compileVectorProject(p)),compileVectorProject(p));
});
test('every native village hairstyle and outfit normalizes with no orphaned old decorations',()=>{
  for(const hair of ['short','side-part','bun','long','tied','none','braid','double-bun','cropped','wavy','bob'])
    for(const outfit of ['robe','tunic','ao-dai','vest','shawl']){
      const assets=normalizeVectorAssets({hero:{...spec,hair,outfit,glasses:true}});
      assert.deepEqual(normalizeVectorAssets(assets),assets,`${hair}/${outfit}`);
      assert.ok(assets.hero!.nodes.length<160);
    }
  assert.ok(normalizeVectorAssets({hero:{...spec,finish:'clean'}}).hero!.nodes.some(n=>n.id==='rear-head'));
});
test('village cast has centered tiny pupils, reference head/body proportions and age-safe female silhouettes',()=>{
  const assets=normalizeVectorAssets({man:{...spec,age:'adult',gender:'male'},woman:{...spec,gender:'female'},
    boy:{...spec,age:'child',gender:'male'},girl:{...spec,age:'child',gender:'female'},elder:{...spec,age:'elder',gender:'female'}});
  const by=(id:string,part:string)=>assets[id]!.nodes.find(n=>n.id===part)!;
  for(const [id,rig] of Object.entries(assets)){
    for(const side of ['l','r']){
      const dot=by(id,'eye-'+side),white=by(id,'eye-white-'+side);
      assert.equal(dot.x,white.x);assert.equal(dot.y,white.y);
      assert.equal(dot.rx,dot.ry);assert.ok(dot.rx!<=white.rx!*.23,'dot is small and solid, not an iris');
      assert.equal(dot.parent,'eyes');assert.equal(white.parent,'eyes');
    }
    assert.equal(by(id,'upper-body').pivotY,280);
    assert.equal(by(id,'hand-l').x,47);assert.equal(by(id,'hand-r').x,133);
    assert.equal(rig.nodes.some(n=>/^(?:arm|forearm|leg|knee|foot)-/.test(n.id)),false);
    assert.ok(rig.nodes.length<160);
  }
  const headHeight=112*by('man','head-group').scaleY!,bodyHeight=155*by('man','costume').scaleY!;
  assert.ok(bodyHeight/headHeight>.9&&bodyHeight/headHeight<1.1,'the approved body is about one head tall, not a long tube');
  for(const id of Object.keys(assets)){
    const torso=by(id,'torso'),costume=by(id,'costume');
    assert.equal(torso.y!+280*torso.scaleY!,280,'artwork still meets the same ground anchor');
    for(const key of ['x','y','scaleX','scaleY'] as const)assert.equal(torso[key],costume[key],'clothing follows the body silhouette');
    assert.equal(by(id,'rear-costume').scaleY,torso.scaleY);
  }
  assert.ok(by('boy','head-group').y!>by('man','head-group').y!,'shorter children retain the same floor');
  assert.equal(by('boy','torso').d,by('girl','torso').d,'no mature contours on a child of either gender');
  assert.notEqual(by('woman','torso').d,by('man','torso').d);
  assert.equal(by('woman','torso').d,by('elder','torso').d);
  assert.ok(by('elder','age-lines'));assert.ok(by('woman','skirt'));
  assert.deepEqual(normalizeVectorAssets(assets),assets,'expanded saved drawings are immutable and idempotent');
  for(const field of ['age','gender','design','expression'])assert.throws(()=>normalizeVectorAssets({bad:{...spec,[field]:'unsupported'}}),/invalid/);
});

test('village fear uses a trembling line mouth, startle opens it, and fear restores the resting expression',()=>{
  for(const expression of ['neutral','soft','worried','surprised'])for(const kind of ['fear','startle']){
    const p=createCanvasProject();p.width=720;p.height=720;
    const assets=normalizeVectorAssets({hero:{...spec,expression}});p.vectorAssets=assets;
    const mouth=assets.hero!.nodes.find(n=>n.id==='mouth')!;
    p.scenes=[{...p.scenes[0]!,durationMs:3000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({width:720,height:720,nodes:[
      {id:'person',type:'instance',asset:'hero',x:200,y:300},{id:'noise',type:'rect',x:500,y:300,width:30,height:280}],
      reactions:[{actor:'person',kind,...(kind==='fear'?{level:'terrified'}:{toward:'noise'}),start:.1,end:.8}],
    },assets)}];
    const scene=compileVectorProject(p).scenes[0]!;
    assert.equal(evaluateVectorPart('person/mouth',scene,0).d,mouth.d);
    const scared=evaluateVectorPart('person/mouth',scene,1200);
    assert.notEqual(scared.d,mouth.d,`${expression}/${kind}: fear must replace the resting mouth shape`);
    assert.equal(scared.fill,kind==='fear'?'none':mouth.stroke);
    if(kind==='fear')assert.equal(evaluateVectorPart('person/mouth',scene,2900).d,mouth.d,'fear settles back to the actual selected expression');
    assert.deepEqual(compileVectorProject(compileVectorProject(p)),compileVectorProject(p));
  }
});

test('village cast retains prop grip, hidden idle hands, fear and rear visibility after cuts',()=>{
  const p=createCanvasProject();p.width=720;p.height=720;
  const assets=normalizeVectorAssets({hero:{...spec,gender:'female',hair:'bun'},lamp:{rig:'lantern'}});p.vectorAssets=assets;
  p.scenes=[{...p.scenes[0]!,durationMs:3000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({width:720,height:720,nodes:[
    {id:'person',type:'instance',asset:'hero',x:200,y:300},{id:'lamp',type:'instance',asset:'lamp',width:45,height:75}],
    carries:[{actor:'person',arm:'r',prop:'lamp',hang:true}],reactions:[{actor:'person',kind:'fear',level:'terrified',start:.1,end:.8}],
    turns:[{actor:'person',from:'front',to:'back',start:.8,end:.9}],
  },assets)}];
  const project=compileVectorProject(p),s=project.scenes[0]!;
  for(let at=0;at<=3000;at+=1000/30){
    const hand=vectorPoint(vectorWorldMatrix('person/hand-r',s,at),0,0),grip=vectorPoint(vectorWorldMatrix('lamp',s,at),30,6);
    assert.ok(Math.hypot(hand.x-grip.x,hand.y-grip.y)<1e-7);
    assert.equal(puppetHandOpacity('person/hand-l',s,at),0);
  }
  assert.deepEqual(compileVectorProject(project),project);
});

test('native village face, ear, hair and costume share a right-facing three-quarter view',()=>{
  const assets=normalizeVectorAssets({woman:{...spec,gender:'female',hair:'bun'},man:{...spec,gender:'male'},bob:{...spec,hair:'bob'},tied:{...spec,hair:'tied'},glasses:{...spec,glasses:true}});
  for(const rig of Object.values(assets)){
    const by=(id:string)=>rig.nodes.find(n=>n.id===id)!;
    assert.ok((by('eye-l').x!+by('eye-r').x!)/2>10,'facial landmarks face right, not symmetrically forward');
    assert.ok(by('eye-white-r').rx!<by('eye-white-l').rx!,'far eye is foreshortened');
    assert.equal(by('ear-r').opacity,0,'far ear is behind the head');
    assert.equal(by('ear-l').opacity,1);
    assert.ok(by('mouth').x!>10);
    assert.ok(!rig.nodes.some(n=>n.id.startsWith('handdrawn-ear-')),'no inherited opposite-facing ear marks');
    for(const id of ['hair-back','hair-tip'])if(by(id))assert.ok(rig.nodes.indexOf(by(id))<rig.nodes.indexOf(by('face')),'back hair cannot cover the face');
  }
  assert.ok(assets.woman!.nodes.find(n=>n.id==='hair-bun')!.x!<0,'bun is behind the head');
  for(const side of [0,1]){
    const nodes=assets.glasses!.nodes;
    assert.equal(nodes.find(n=>n.id==='glasses-'+side)!.x,nodes.find(n=>n.id==='eye-'+(side?'r':'l'))!.x);
  }
});
