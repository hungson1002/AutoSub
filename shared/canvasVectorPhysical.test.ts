import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeVectorAssets,normalizeVectorScene,evaluateVectorPart,frameVectorScene,compileVectorProject} from './canvasVectorScene';
import {createCanvasProject} from './canvasAnimationStudio';
import {vectorWorldMatrix,vectorPoint} from './canvasVectorTransform';

const assets=normalizeVectorAssets({human:{rig:'simple-human'},lamp:{rig:'lantern'}});
function world(){return {width:720,height:1280,nodes:[
  {id:'sky',type:'rect',width:720,height:1280,fill:'#101a24'},
  {id:'hut',type:'group',x:30,y:400},
  {id:'wall',type:'rect',parent:'hut',width:170,height:300,fill:'#65766a'},
  {id:'gate',type:'group',x:540,y:500},
  {id:'post',type:'rect',parent:'gate',width:20,height:240,fill:'#677'},
  {id:'guard',type:'instance',asset:'human',x:250,y:500,width:180,height:360},
  {id:'lamp',type:'instance',asset:'lamp',attachTo:'guard/hand-r',x:-30,y:0,width:60,height:100},
],ground:{y:980,targets:[{target:'hut',anchor:{x:85,y:300}},{target:'gate',anchor:{x:10,y:240}},{target:'guard'}]}};}
function shot(raw:unknown){const p=createCanvasProject();return {...p.scenes[0]!,durationMs:10000,narration:'',vectorScene:normalizeVectorScene(raw,assets)};}

test('native commands own duplicate channels but preserve unrelated authored flame and clue motion',()=>{
  const s=shot({...world(),lights:[{target:'lamp',on:false,hold:true}],reveals:[{targets:['hut'],start:.3,end:.5}],tracks:[
    {target:'lamp/flame',start:0,end:1,frames:[{t:0,opacity:1,scaleY:1},{t:1,opacity:.8,scaleY:1.2}]},
    {target:'hut',start:0,end:1,frames:[{t:0,opacity:1,dx:0},{t:1,opacity:1,dx:20}]},
  ]});
  assert.equal(evaluateVectorPart('lamp/flame',s,5000).opacity,0);
  assert.ok(evaluateVectorPart('lamp/flame',s,5000).scaleY>1);
  assert.equal(evaluateVectorPart('hut',s,0).opacity,0);
  assert.equal(evaluateVectorPart('hut',s,6000).opacity,1);
  assert.ok(evaluateVectorPart('hut',s,6000).dx>0);
  assert.deepEqual(normalizeVectorScene(s.vectorScene,assets),s.vectorScene);
});

test('existing ungrounded SVG worlds support a planted walk, prop retreat and rectangular door hinge without moving scenery',()=>{
  const base={...world(),ground:undefined,nodes:[...world().nodes,{id:'door',type:'rect',x:540,y:500,width:50,height:400,fill:'#543'}]};
  const s=shot({...base,walks:[{actor:'guard',to:'door',gap:30,carry:'r',start:0,end:1}],hinges:[{target:'door',open:true,start:.2,end:.5}]});
  const walk=s.vectorScene!.tracks.find(t=>t.target==='guard')!;
  assert.ok(walk.frames.at(-1)!.dx!>100);
  assert.ok(s.vectorScene!.tracks.some(t=>t.target==='guard/knee-r'&&t.frames.some(f=>f.rotation!>0)));
  assert.equal(evaluateVectorPart('door',s,9000).scaleX,.15);
  assert.deepEqual(s.vectorScene!.nodes.find(n=>n.id==='door'),normalizeVectorScene(base,assets).nodes.find(n=>n.id==='door'));
  assert.equal(s.vectorScene!.ground,undefined);
  const retreat=shot({...base,walks:[{actor:'guard',to:'door',backstep:45,carry:'r'}]});
  assert.ok(retreat.vectorScene!.tracks.find(t=>t.target==='guard')!.frames.at(-1)!.dx!<0);
  assert.deepEqual(normalizeVectorScene(s.vectorScene,assets),s.vectorScene);
});

test('a revealed cast member survives a root-pose replacement in the next cut while explicit hides and new locations stay hidden',()=>{
  const base={...world(),ground:undefined,nodes:world().nodes.map(n=>n.id==='guard'?{...n,opacity:0}:n)};
  const direction={purpose:'React',location:'room',shot:{size:'action' as const,focus:'guard',include:[]},beats:[
    {cue:'wait',kind:'motion' as const,targets:['guard'],motionTargets:['guard/head-group'],before:'still',after:'reacts'},
  ]};
  const first={...shot({...base,reveals:[{targets:['guard'],start:0,end:.2}]}),id:'first',narration:'wait',vectorStageId:'room',vectorDirection:direction};
  const next={...shot({...base,tracks:[{target:'guard',start:0,end:1,frames:[{t:0,rotation:0},{t:1,rotation:25}]}]}),id:'next',narration:'wait',vectorStageId:'room',vectorDirection:direction};
  const hidden={...shot({...base,tracks:[{target:'guard',start:0,end:1,frames:[{t:0,opacity:0}]}]}),id:'hidden',narration:'wait',vectorStageId:'room',vectorDirection:direction};
  const project={...createCanvasProject(),width:720,height:1280,vectorAssets:assets,scenes:[first,next,hidden,{...next,id:'other',vectorStageId:'other'}]};
  const before=structuredClone(project),fixed=compileVectorProject(project);
  assert.equal(evaluateVectorPart('guard',fixed.scenes[1]!,0,fixed.scenes[1]!.vectorScene!.nodes.find(n=>n.id==='guard')!.opacity).opacity,1);
  assert.equal(fixed.scenes[2]!.vectorScene!.nodes.find(n=>n.id==='guard')!.opacity,0);
  assert.equal(fixed.scenes[3]!.vectorScene!.nodes.find(n=>n.id==='guard')!.opacity,0);
  assert.deepEqual(compileVectorProject(fixed),fixed);assert.deepEqual(project,before);
});

test('small prop close-ups cap magnification without enlarging the shared world or rejecting the prop as a tiny actor',()=>{
  for(const grounded of [true,false]){
    const raw=world(),lamp=raw.nodes.find(n=>n.id==='lamp')!;
    const nodes=raw.nodes.map(n=>n===lamp?{...n,attachTo:undefined,x:350,y:800}:n);
    const s=shot({...raw,ground:grounded?raw.ground:undefined,nodes,shot:{target:'lamp',height:.45}});
    const camera=s.vectorScene!.tracks.find(t=>t.target==='camera-world')!;
    assert.equal(camera.frames[0]!.scaleY,4);
    assert.equal(s.vectorScene!.nodes.find(n=>n.id==='lamp')!.height,100);
  }
});

test('held physical trails inherit repaired geometry across cuts without restarting reveals or changing another location',()=>{
  const p=createCanvasProject();p.width=720;p.height=1280;p.vectorAssets=assets;
  const command={id:'trail',from:'gate',to:'hut',count:6,color:'#3f6257',start:0,end:.02};
  const first={...shot({...world(),footsteps:[command]}),id:'first',vectorStageId:'yard'};
  const held={...shot({...world(),footsteps:[{...command,count:4,color:'#ffffff',hold:true}]}),id:'held',vectorStageId:'yard',audioUrl:'/keep.wav'};
  p.scenes=[first,held,{...held,id:'other',vectorStageId:'other-yard'},
    {...shot({...world(),footsteps:[{...command,count:3,color:'#112233'}]}),id:'new-reveal',vectorStageId:'yard'}];
  const before=structuredClone(p),compiled=compileVectorProject(p),next=compiled.scenes[1]!;
  assert.equal(next.vectorScene!.nodes.filter(n=>n.groundMark).length,6);
  assert.equal(next.vectorScene!.nodes.find(n=>n.id==='trail-6-sole')!.fill,'#3f6257');
  assert.equal(evaluateVectorPart('trail-6',next,0,1).opacity,1);
  assert.equal(next.audioUrl,'/keep.wav');assert.equal(next.durationMs,held.durationMs);
  assert.equal(compiled.scenes[2]!.vectorScene!.nodes.filter(n=>n.groundMark).length,4);
  assert.equal(compiled.scenes[3]!.vectorScene!.nodes.filter(n=>n.groundMark).length,3);
  assert.equal(evaluateVectorPart('trail-1',compiled.scenes[3]!,0,0).opacity,0);
  assert.deepEqual(compileVectorProject(compiled),compiled);
  assert.deepEqual(p,before,'compilation must preserve the source checkpoint');
});

test('a badly lowered fixed acting camera is balanced without changing scale, horizontal framing or world geometry',()=>{
  const p=createCanvasProject();p.width=720;p.height=1280;p.vectorAssets=assets;
  p.scenes=[{...shot({...world(),camera:[{t:0,x:360,y:640,zoom:1.65}]}),id:'acting'}];
  const before=structuredClone(p),compiled=compileVectorProject(p),s=compiled.scenes[0]!;
  const matrix=vectorWorldMatrix('guard',s,0,assets),head=vectorPoint(matrix,120,60),foot=vectorPoint(matrix,120,465);
  assert.ok(Math.abs((head.y+foot.y)/2-1280*.55)<.001);
  const old=p.scenes[0]!.vectorScene!.tracks.at(-1)!.frames[0]!,now=s.vectorScene!.tracks.at(-1)!.frames[0]!;
  assert.equal(now.dx,old.dx);assert.equal(now.scaleX,old.scaleX);assert.equal(now.scaleY,old.scaleY);
  assert.deepEqual(s.vectorScene!.nodes,before.scenes[0]!.vectorScene!.nodes);
  assert.deepEqual(compileVectorProject(compiled),compiled);assert.deepEqual(p,before);
});

test('a carrying transition begins at the preceding shoulder and elbow pose across a continuous cut',()=>{
  const p=createCanvasProject();p.width=720;p.height=1280;p.vectorAssets=assets;
  const first={...shot({...world(),tracks:[
    {target:'guard/arm-r',start:0,end:1,frames:[{t:0,rotation:-150}]},
    {target:'guard/forearm-r',start:0,end:1,frames:[{t:0,rotation:110}]},
    {target:'guard/upper-body',start:0,end:1,frames:[{t:0,rotation:-12}]},
  ]}),id:'before',vectorStageId:'yard'};
  const next={...shot({...world(),tracks:[
    {target:'guard/arm-r',start:0,end:.2,frames:[{t:0,rotation:12},{t:1,rotation:18,easing:'smooth'}]},
    {target:'guard/forearm-r',start:0,end:.2,frames:[{t:0,rotation:-5},{t:1,rotation:-10,easing:'smooth'}]},
    {target:'guard/upper-body',start:.2,end:.4,frames:[{t:0,rotation:0},{t:1,rotation:-4,easing:'smooth'}]},
  ]}),id:'after',vectorStageId:'yard'};
  p.scenes=[first,next,{...next,id:'elsewhere',vectorStageId:'other-yard'}];
  const source=structuredClone(p),compiled=compileVectorProject(p),after=compiled.scenes[1]!;
  assert.equal(evaluateVectorPart('guard/arm-r',after,0).rotation,-150);
  assert.equal(evaluateVectorPart('guard/forearm-r',after,0).rotation,110);
  assert.equal(evaluateVectorPart('guard/upper-body',after,0).rotation,-12);
  assert.equal(evaluateVectorPart('guard/arm-r',after,3000).rotation,18);
  assert.equal(evaluateVectorPart('guard/forearm-r',after,3000).rotation,-10);
  const beforeGrip=vectorPoint(vectorWorldMatrix('guard/hand-r',compiled.scenes[0]!,10000,assets),0,0);
  const afterGrip=vectorPoint(vectorWorldMatrix('guard/hand-r',after,0,assets),0,0);
  assert.ok(Math.hypot(beforeGrip.x-afterGrip.x,beforeGrip.y-afterGrip.y)<.001,'the grip must not teleport at the cut');
  assert.equal(evaluateVectorPart('guard/arm-r',compiled.scenes[2]!,0).rotation,12,'another location retains its authored pose');
  assert.deepEqual(compileVectorProject(compiled),compiled);assert.deepEqual(p,source);
});

test('a resumed fixed close-up widens once to keep the raised and lowered lamp inside the same world',()=>{
  const p=createCanvasProject();p.width=720;p.height=1280;p.vectorAssets=assets;
  const base=world(),w={...base,nodes:base.nodes.map(n=>n.id==='guard'?{...n,x:330}:n.id==='lamp'?{...n,width:100,height:160,hang:true}:n)};
  p.scenes=[{...shot({...w,camera:[{t:0,x:300,y:820,zoom:2.5}],
    reaches:[{actor:'guard',arm:'r',point:{x:215,y:180},start:0,end:.3}]}),id:'carry'}];
  const source=structuredClone(p),compiled=compileVectorProject(p),s=compiled.scenes[0]!;
  const camera=s.vectorScene!.tracks.find(t=>t.target==='camera-world')!;
  assert.equal(camera.frames.length,1,'keep an instant fixed cut, not an animated zoom');
  assert.ok(camera.frames[0]!.scaleX!<2.5);
  for(let i=0;i<=64;i++){
    const matrix=vectorWorldMatrix('lamp',s,i/64*s.durationMs,assets);
    const corners=[[0,0],[60,0],[0,100],[60,100]].map(([x,y])=>vectorPoint(matrix,x!,y!));
    assert.ok(corners.every(p=>p.x>=23&&p.x<=697),'the complete carried prop must stay inside the frame');
  }
  assert.deepEqual(s.vectorScene!.nodes,source.scenes[0]!.vectorScene!.nodes);
  assert.deepEqual(compileVectorProject(compiled),compiled);assert.deepEqual(p,source);
});

test('support anchors align buildings and human feet, survive a camera and canonical recompilation',()=>{
  const d=normalizeVectorScene(world(),assets);
  assert.equal(d.nodes.find(n=>n.id==='hut')!.y,680);
  assert.equal(d.nodes.find(n=>n.id==='gate')!.y,740);
  assert.equal(d.nodes.find(n=>n.id==='guard')!.y!+457*.75,980);
  const framed=frameVectorScene(d,[{t:0,x:350,y:800,zoom:1.6}]);
  assert.equal(framed.ground!.parent,'camera-world');
  assert.equal(framed.nodes.find(n=>n.id==='lamp')!.parent,undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeVectorScene(JSON.parse(JSON.stringify(framed)),assets))),JSON.parse(JSON.stringify(framed)));
  const shifted={...framed,nodes:framed.nodes.map(n=>n.id==='hut'?{...n,y:20}:n)};
  assert.equal(normalizeVectorScene(shifted,assets).nodes.find(n=>n.id==='hut')!.y,680);
  assert.throws(()=>normalizeVectorScene({...world(),ground:{y:980,targets:[{target:'hut'}]}},assets),/anchor/);
});
test('footsteps end at the door base, reveal in order and retain floor coordinates in later cuts',()=>{
  const command={id:'trail',from:'gate',to:'hut',count:5,size:36,start:.1,end:.12,cue:'dấu chân',stepMs:450};
  const d=normalizeVectorScene({...world(),footsteps:[command]},assets,'dấu chân');
  const marks=d.nodes.filter(n=>n.groundMark);
  assert.equal(marks.length,5);assert.equal(marks[0]!.x,550);assert.equal(marks[4]!.x,115);
  assert.ok(marks.every(n=>Math.abs(n.y!-980)<=13));
  assert.deepEqual(d.tracks.map(t=>t.cueOffsetMs),[0,450,900,1350,1800]);
  const {cue,...held}=command;
  const next=normalizeVectorScene({...world(),footsteps:[{...held,hold:true}]},assets);
  assert.deepEqual(next.nodes.filter(n=>n.groundMark).map(({opacity,...n})=>n),marks.map(({opacity,...n})=>n));
  assert.ok(next.nodes.filter(n=>n.groundMark).every(n=>n.opacity===1));
  assert.throws(()=>normalizeVectorScene({...d,nodes:d.nodes.map(n=>n.groundMark?{...n,y:600}:n)},assets),/surface/);
  assert.throws(()=>normalizeVectorScene({...d,tracks:[...d.tracks,{target:'trail-floor',start:0,end:1,frames:[{t:0,dy:0},{t:1,dy:-300}]}]},assets),/surface/);
});
test('walking plants stance feet in world space in both directions and finishes at rest',()=>{
  for(const to of ['gate','hut']){
    const s=shot({...world(),walks:[{actor:'guard',to,gap:70,start:0,end:1,carry:'r'}]});
    const d=s.vectorScene!,root=d.tracks.find(t=>t.target==='guard')!,distance=root.frames.at(-1)!.dx!;
    assert.equal(d.tracks.some(t=>t.target==='guard/arm-r'),false);
    assert.ok(d.tracks.find(t=>t.target==='guard/leg-l')!.frames.some(f=>Math.abs(f.rotation!)>10));
    for(const side of ['l','r']){
      const keys=d.tracks.find(t=>t.target==='guard/leg-'+side)!.frames;
      assert.ok(d.tracks.find(t=>t.target==='guard/knee-'+side)!.frames.every(f=>f.rotation!>=0),'knees never reverse their bend when travelling backwards');
      assert.equal(Math.abs(keys[0]!.rotation!),0);assert.equal(Math.abs(keys.at(-1)!.rotation!),0);
      for(const f of keys){
        const t=f.t;if(t<.08||t>.92)continue;
        const cycles=Math.ceil(Math.abs(distance/.75)/52),phase=cycles*t+(side==='r'?.5:0),fraction=phase-Math.floor(phase);
        if(fraction>.500001)continue; // only planted half of each stride
        const time=t*10000,r=evaluateVectorPart('guard',s,time),leg=evaluateVectorPart('guard/leg-'+side,s,time),knee=evaluateVectorPart('guard/knee-'+side,s,time);
        const a=leg.rotation*Math.PI/180,b=(leg.rotation+knee.rotation)*Math.PI/180;
        const x=r.dx+(.75*((side==='l'?88:152)-55*Math.sin(a)+6*Math.cos(b)-55*Math.sin(b)));
        const expected=.75*((side==='l'?88:152)+6)+Math.floor(phase)*distance/cycles;
        assert.ok(Math.abs(x-expected)<.001,`stance foot drift ${x-expected}`);
        const y=r.dy+.75*(55*Math.cos(a)+6*Math.sin(b)+55*Math.cos(b));
        assert.ok(Math.abs(y-82.5)<.001,`stance foot height ${y}`);
      }
    }
    assert.equal(root.frames.at(-1)!.dy,0);
    const target=to==='gate'?550:115;assert.equal(340+distance,target+(to==='gate'?-70:70));
  }
});

test('a fearful backstep starts at the held walk endpoint, retreats from either threat and articulates the free elbow',()=>{
  for(const to of ['gate','hut']){
    const s=shot({...world(),walks:[{actor:'guard',to,backstep:55,offsetX:40,start:.5,end:.8,carry:'r'}]});
    const direction=to==='gate'?-1:1;
    assert.equal(evaluateVectorPart('guard',s,0).dx,40);
    assert.equal(evaluateVectorPart('guard',s,5000).dx,40);
    assert.equal(evaluateVectorPart('guard',s,9000).dx,40+direction*55);
    assert.equal(evaluateVectorPart('guard',s,9000).dy,0);
    assert.ok(s.vectorScene!.tracks.find(t=>t.target==='guard/leg-l')!.frames.some(f=>Math.abs(f.rotation!)>10));
    assert.ok(s.vectorScene!.tracks.find(t=>t.target==='guard/forearm-l')!.frames.some(f=>Math.abs(f.rotation!)>=12));
    assert.equal(s.vectorScene!.tracks.some(t=>/guard\/(arm|forearm)-r/.test(t.target)),false,'preserve the occupied arm and lamp grip');
    assert.deepEqual(normalizeVectorScene(s.vectorScene,assets),s.vectorScene,'canonical compilation is idempotent');
  }
  assert.throws(()=>shot({...world(),walks:[{actor:'guard',to:'hut',backstep:500}]}),/motion value/);
});

test('a defensive retreat protects the chest, preserves its end pose across a cut, and keeps stance feet planted between keys',()=>{
  const command={actor:'guard',to:'gate',backstep:55,start:0,end:1,carry:'r'};
  const s=shot({...world(),walks:[command]});
  const raised=vectorPoint(vectorWorldMatrix('guard/hand-l',s,4000,assets),0,0);
  const belt=vectorPoint(vectorWorldMatrix('guard/upper-body',s,4000,assets),120,275);
  assert.ok(raised.y<belt.y-10,'defensive hand reads at the chest, not the crotch');
  for(const time of [7000,10000]){
    const hand=vectorPoint(vectorWorldMatrix('guard/hand-l',s,time,assets),0,0);
    const collar=vectorPoint(vectorWorldMatrix('guard/upper-body',s,time,assets),120,240);
    assert.ok(hand.y<collar.y,'defensive end pose must not relax into a hand-on-hip pose');
  }
  const held=shot({...world(),walks:[{...command,hold:true}]});
  for(const target of ['guard','guard/upper-body','guard/head-group','guard/arm-l','guard/forearm-l'])
    assert.deepEqual(evaluateVectorPart(target,held,0),evaluateVectorPart(target,s,10000),'held retreat retains the full pose');
  const sx=.75,distance=-55,cycles=Math.ceil(Math.abs(distance/sx)/52);
  for(let i=1;i<100;i++)for(const side of ['l','r']){
    const t=i/100,phase=cycles*t+(side==='r'?.5:0),f=phase-Math.floor(phase);
    if(t<.12||t>.88||f<.1||f>.4)continue;
    const foot=vectorPoint(vectorWorldMatrix('guard/foot-'+side,s,t*10000,assets),0,0);
    const rest=vectorPoint(vectorWorldMatrix('guard/foot-'+side,s,0,assets),0,0);
    assert.ok(Math.abs(foot.x-rest.x-Math.floor(phase)*distance/cycles)<1,'stance foot must not skate between authored keys');
    assert.ok(Math.abs(foot.y-rest.y)<1,'stance foot must not bounce off the support');
  }
});

test('wet native marks have a dark filled silhouette and saved white rims upgrade without changing reveal timing',()=>{
  const d=normalizeVectorScene({...world(),footsteps:[{id:'wet',from:'gate',to:'hut',count:4,start:.1,end:.12,stepMs:600}]},assets);
  const marks=new Set(d.nodes.filter(n=>n.groundMark).map(n=>n.id));
  const shapes=d.nodes.filter(n=>n.parent&&marks.has(n.parent));
  assert.ok(shapes.filter(n=>!n.id.endsWith('-heel')).every(n=>n.fill==='#0b1514'&&!n.stroke));
  assert.equal(shapes.find(n=>n.id==='wet-1-sole')!.type,'path','one joined filled sole instead of outlined ellipses');
  const old={...d,nodes:d.nodes.map(n=>n.parent&&marks.has(n.parent)?{...n,...(n.id.endsWith('-sole')?{type:'ellipse' as const,rx:5.5,ry:9,d:undefined}:{}),stroke:'#87a99e',strokeWidth:.65}:n)};
  const upgraded=normalizeVectorScene(old,assets);
  assert.deepEqual(upgraded,d);assert.deepEqual(old.tracks,upgraded.tracks);
  assert.equal(old.nodes.find(n=>n.id==='wet-1-sole')!.stroke,'#87a99e','do not mutate a saved checkpoint');
});
test('extinguishing controls only emitters, attachments reject missing targets and cycles',()=>{
  const s=shot({...world(),lights:[{target:'lamp',on:false,start:.5,end:.52}]});
  assert.deepEqual(s.vectorScene!.tracks.map(t=>t.target),['lamp/flame']);
  assert.equal(evaluateVectorPart('lamp/flame',s,9000).opacity,0);
  assert.equal(evaluateVectorPart('lamp/case',s,9000).opacity,1);
  assert.equal(evaluateVectorPart('lamp',s,9000).opacity,1);
  const missing={...world(),nodes:world().nodes.map(n=>n.id==='lamp'?{...n,attachTo:'guard/missing'}:n)};
  assert.throws(()=>normalizeVectorScene(missing,assets),/attachment target/);
  const cyclic={...world(),nodes:world().nodes.map(n=>n.id==='guard'?{...n,parent:'lamp'}:n),ground:undefined};
  assert.throws(()=>normalizeVectorScene(cyclic,assets),/cyclic attachment/);
});
test('reactions articulate connected torso and eyes while feet remain planted',()=>{
  const s=shot({...world(),reactions:[{actor:'guard',toward:'hut',kind:'startle',start:0,end:1}]});
  assert.ok(Math.abs(evaluateVectorPart('guard/upper-body',s,4500).rotation)>=9);
  assert.equal(evaluateVectorPart('guard/leg-l',s,4500).rotation,0);
  assert.equal(evaluateVectorPart('guard',s,4500).dx,0);
});

test('a directed look moves the eyes before the head, without a sustained head roll or permanent surprised mouth',()=>{
  const s=shot({...world(),reactions:[{actor:'guard',toward:'gate',kind:'look',start:0,end:1}]});
  assert.equal(evaluateVectorPart('guard/eyes',s,1500).dx,4);
  assert.ok(evaluateVectorPart('guard/head-group',s,1500).rotation<4);
  assert.ok(s.vectorScene!.tracks.find(t=>t.target==='guard/head-group')!.frames.every(f=>Math.abs(f.rotation||0)<=4));
  const scare=shot({...world(),reactions:[{actor:'guard',toward:'gate',kind:'startle',start:0,end:1}]});
  assert.equal(evaluateVectorPart('guard/mouth',scare,10000).scaleY,1);
});

test('new directed cuts retain root, defensive arm and gaze states without carrying clue opacity',()=>{
  const p=createCanvasProject();p.width=720;p.height=1280;p.vectorAssets=assets;
  const direction={purpose:'Continue the same action',location:'yard',shot:{size:'action' as const,focus:'guard',include:[]},beats:[]};
  const first={...shot({...world(),tracks:[
    {target:'guard',start:0,end:1,frames:[{t:0,dx:0},{t:1,dx:55}]},
    {target:'guard/arm-l',start:0,end:1,frames:[{t:0,rotation:0},{t:1,rotation:45}]},
    {target:'guard/head-group',start:0,end:1,frames:[{t:0,rotation:0},{t:1,rotation:-8}]},
    {target:'guard/eyes',start:0,end:1,frames:[{t:0,dx:0},{t:1,dx:4}]},
  ]}),id:'first',vectorStageId:'yard',vectorDirection:direction};
  const next={...shot({...world(),tracks:[{target:'guard/head-group',start:0,end:1,frames:[{t:0,rotation:0},{t:1,rotation:2}]}]}),
    id:'next',vectorStageId:'yard',vectorDirection:direction};
  p.scenes=[first,next];const original=structuredClone(p),compiled=compileVectorProject(p),s=compiled.scenes[1]!;
  assert.equal(evaluateVectorPart('guard',s,0).dx,55);
  assert.equal(evaluateVectorPart('guard/arm-l',s,0).rotation,45);
  assert.equal(evaluateVectorPart('guard/eyes',s,0).dx,4);
  assert.equal(evaluateVectorPart('guard/head-group',s,0).rotation,-8);
  assert.equal(evaluateVectorPart('guard/head-group',s,10000).rotation,2);
  assert.deepEqual(compileVectorProject(compiled),compiled);assert.deepEqual(p,original);
});

test('a protective startle solves the free hand to the chest and leaves the occupied arm unchanged',()=>{
  for(const carry of ['l','r']){
    const s=shot({...world(),reactions:[{actor:'guard',toward:'hut',kind:'startle',carry,start:0,end:1}]});
    const side=carry==='r'?'l':'r',hand=vectorPoint(vectorWorldMatrix('guard/hand-'+side,s,10000,assets),0,0);
    const chest=vectorPoint(vectorWorldMatrix('guard/upper-body',s,10000,assets),carry==='r'?110:130,235);
    assert.ok(Math.hypot(hand.x-chest.x,hand.y-chest.y)<.001,'free hand must reach a readable chest position');
    assert.equal(s.vectorScene!.tracks.some(t=>t.target==='guard/arm-'+carry||t.target==='guard/forearm-'+carry),false);
  }
});
test('a hanging lamp keeps its vertical axis and grip through arm, body and camera movement',()=>{
  const w=world();
  const s=shot({...w,nodes:w.nodes.map(n=>n.id==='lamp'?{...n,hang:true}:n),camera:[{t:0,x:360,y:800,zoom:1.5}],tracks:[
    {target:'guard/arm-r',start:0,end:1,frames:[{t:0,rotation:0},{t:1,rotation:-55}]},
    {target:'guard/forearm-r',start:0,end:1,frames:[{t:0,rotation:0},{t:1,rotation:-30}]},
    {target:'guard',start:0,end:1,frames:[{t:0,dx:0},{t:1,dx:60}]},
  ]});
  for(const t of [0,2500,5000,7500,10000]){
    const matrix=vectorWorldMatrix('lamp',s,t,assets),hand=vectorPoint(vectorWorldMatrix('guard/hand-r',s,t,assets),0,0);
    const handle=vectorPoint(matrix,30,0),base=vectorPoint(matrix,30,100);
    assert.ok(Math.abs(handle.x-hand.x)<.001&&Math.abs(handle.y-hand.y)<.001);
    assert.ok(Math.abs(base.x-handle.x)<.001&&base.y>handle.y,'suspended lamp remains vertical');
  }
});
test('native vertical hinges keep slats upright and preserve their open state at the next cut',()=>{
  const w=world(),nodes=[...w.nodes,{id:'leaf',type:'group',parent:'gate',x:20,y:0,pivotX:0,pivotY:120},
    {id:'bars',type:'rect',parent:'leaf',width:100,height:240,fill:'#777'}];
  const s=shot({...w,nodes,hinges:[{target:'leaf',open:true,start:.2,end:.6}]});
  assert.equal(evaluateVectorPart('leaf',s,9000).rotation,0);
  assert.equal(evaluateVectorPart('leaf',s,9000).scaleX,.15);
  const held=shot({...w,nodes,hinges:[{target:'leaf',open:true,hold:true}]});
  assert.equal(evaluateVectorPart('leaf',held,0).scaleX,.15);
});
test('grounded subject framing includes the actual walked endpoint and hanging prop throughout the shot',()=>{
  const w=world(),s=shot({...w,nodes:w.nodes.map(n=>n.id==='lamp'?{...n,hang:true}:n),
    walks:[{actor:'guard',to:'gate',gap:70,start:0,end:.5,carry:'r'}],shot:{target:'guard',height:.5}});
  for(const atMs of [0,2500,5000,10000]){
    const matrix=vectorWorldMatrix('lamp',s,atMs,assets);
    for(const [x,y] of [[0,0],[60,0],[0,100],[60,100]]){
      const point=vectorPoint(matrix,x!,y!);assert.ok(point.x>=20&&point.x<=700,`cropped lamp x ${point.x}`);
      assert.ok(point.y>=244&&point.y<=1250,`cropped lamp y ${point.y}`);
    }
  }
});

test('a close-up crops shared architecture instead of widening the acting subject back into a wide shot',()=>{
  const s=shot({...world(),shot:{target:'guard',height:.6,include:['hut','gate']}});
  const m=vectorWorldMatrix('guard',s,0,assets),head=vectorPoint(m,120,60),feet=vectorPoint(m,120,465);
  assert.ok((feet.y-head.y)/1280>=.59);
  const lamp=vectorWorldMatrix('lamp',s,0,assets);
  for(const [x,y] of [[0,0],[60,0],[0,100],[60,100]]){
    const point=vectorPoint(lamp,x!,y!);assert.ok(point.x>=31&&point.x<=689);
  }
  assert.ok(s.vectorScene!.nodes.some(n=>n.id==='hut'),'architecture remains in the same world');
});
