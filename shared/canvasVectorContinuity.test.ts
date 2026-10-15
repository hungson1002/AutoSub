import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasProject,type CanvasStudioScene,type CanvasVectorDirection} from './canvasAnimationStudio';
import {compileVectorProject,evaluateVectorPart,normalizeVectorAssets,normalizeVectorScene,vectorTrackTiming} from './canvasVectorScene';
import {vectorPoint,vectorWorldMatrix} from './canvasVectorTransform';
import {continueVectorHandPlan} from './canvasVectorContinuity';

test('small mirrored lantern retains inherited size and orientation when released and across cuts',()=>{
  const library=normalizeVectorAssets({hero:{rig:'simple-puppet',design:'village'},lamp:{rig:'lantern'}});
  for(const facing of [-1,1]){
    const p=createCanvasProject();p.width=720;p.height=720;p.vectorAssets=library;
    const held={actor:'hero',arm:'r' as const,prop:'lamp',hang:true};
    p.scenes=['carry','carry-cut','drop','after'].map((id,i)=>({...p.scenes[0]!,id,durationMs:4000,narration:'wait then drop lamp',dialogue:undefined,
      vectorStageId:'yard',vectorDirection:{purpose:'Keep the same lamp',location:'yard',shot:{size:'wide' as const,focus:'hero',include:['lamp']},beats:[],
        heldProps:i<2?[held]:[],...(i===2?{propEvents:[{prop:'lamp',action:'release' as const,cue:'drop lamp'}]}:{})},
      vectorScene:normalizeVectorScene({width:720,height:720,nodes:[
        {id:'hero',type:'instance',asset:'hero',x:300,y:500,width:180*.285714,height:280*.285714},
        {id:'lamp',type:'instance',asset:'lamp',width:i?65:70,height:i?108:115},
      ],ground:{y:600,targets:[{target:'hero'}]},carries:i<2?[held]:undefined,tracks:[
        {target:'hero/upper-body',start:0,end:1,frames:[{t:0,scaleX:facing}]},
      ]},library)}));
    const original=structuredClone(p),fixed=compileVectorProject(p),carry=fixed.scenes[1]!,drop=fixed.scenes[2]!;
    const at=vectorTrackTiming({target:'lamp',start:0,end:1,cue:'drop lamp',frames:[]},drop).start;
    const before=vectorWorldMatrix('lamp',carry,4000),lengths=(m:ReturnType<typeof vectorWorldMatrix>)=>[Math.hypot(m.a,m.b),Math.hypot(m.c,m.d)];
    for(const t of [0,at-1,at,at+100,at+650,4000]){
      const actual=vectorWorldMatrix('lamp',drop,t);
      lengths(actual).forEach((value,i)=>assert.ok(Math.abs(value-lengths(before)[i]!)<1e-6,'release cannot inflate the lantern'));
      assert.equal(Math.sign(actual.a*actual.d-actual.b*actual.c),Math.sign(before.a*before.d-before.b*before.c));
    }
    for(const point of [[0,0],[30,6],[60,100]]){
      const a=vectorPoint(before,point[0]!,point[1]!),b=vectorPoint(vectorWorldMatrix('lamp',drop,0),point[0]!,point[1]!);
      assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-6,'the entire lamp keeps its pre-release pose');
    }
    const landed=vectorWorldMatrix('lamp',drop,4000);
    assert.ok(Math.abs(Math.max(...[[0,0],[60,0],[0,100],[60,100]].map(([x,y])=>vectorPoint(landed,x!,y!).y))-600)<1e-6);
    assert.deepEqual(compileVectorProject(fixed),fixed);assert.deepEqual(p,original);
  }
});

const assets=normalizeVectorAssets({person:{rig:'simple-human'},light:{rig:'lantern'},tool:{width:30,height:90,grip:{x:15,y:15},nodes:[
  {id:'handle',type:'rect',x:10,y:0,width:10,height:30,fill:'#753'},
  {id:'blade',type:'rect',x:10,y:30,width:10,height:60,fill:'#ccc'},
]}});

test('village lantern stays raised, lowers for inspection and returns before the next cut without losing grip',()=>{
  const a=normalizeVectorAssets({hero:{rig:'simple-puppet',design:'village'},lamp:{rig:'lantern'}});
  for(const arm of ['l','r'] as const)for(const facing of [-1,1]){
    const p=createCanvasProject();p.width=720;p.height=720;p.vectorAssets=a;
    const hand=a.hero!.nodes.find(n=>n.id==='hand-'+arm)!;
    p.scenes=[0,1,2].map(i=>({...p.scenes[0]!,id:'lamp-'+i,durationMs:4000,narration:'inspect the hoof',dialogue:undefined,
      vectorStageId:'yard',vectorDirection:{purpose:'Inspect then retreat',location:'yard',shot:{size:'action' as const,focus:'person',include:['lamp']},beats:[]},
      vectorScene:normalizeVectorScene({width:720,height:720,nodes:[{id:'person',type:'instance',asset:'hero',x:250,y:300},
        {id:'lamp',type:'instance',asset:'lamp',width:48,height:80}],carries:[{actor:'person',arm,prop:'lamp',hang:true}],
        tracks:[{target:'person/upper-body',start:0,end:1,frames:[{t:0,scaleX:facing}]}],
        ...(i===1?{reaches:[{actor:'person',arm,point:{x:hand.x,y:235},start:.15,end:.8,cue:'inspect the hoof'}]}:{}),
      },a)}));
    const fixed=compileVectorProject(p),target='person/hand-'+arm,rest=134-hand.y!;
    for(const s of fixed.scenes){
      assert.equal(evaluateVectorPart(target,s,0).dy,rest);
      assert.equal(evaluateVectorPart(target,s,0).dx,arm==='r'?28:-28,'raised hand stays beside the face instead of covering the mouth');
      assert.equal(evaluateVectorPart(target,s,4000).dy,rest,'inspection cannot strand the lamp at the hem');
      let previous=vectorPoint(vectorWorldMatrix(target,s,0),0,0);
      for(let ms=0;ms<=4000;ms+=1000/30){
        const h=vectorPoint(vectorWorldMatrix(target,s,ms),0,0),g=vectorPoint(vectorWorldMatrix('lamp',s,ms),30,6);
        assert.ok(Math.hypot(h.x-g.x,h.y-g.y)<1e-7,'handle is attached to the visible hand');
        assert.ok(Math.hypot(h.x-previous.x,h.y-previous.y)<12,'no hand teleport');previous=h;
      }
    }
    const gesture=fixed.scenes[1]!.vectorScene!.tracks.find(t=>t.target===target&&t.cue)!;
    assert.ok(gesture.frames.some(f=>f.dy===235-hand.y!), 'narrated lowering still reaches the intended height');
    assert.deepEqual(compileVectorProject(fixed),fixed);
  }
  for(const explicit of [{hold:true},{withdraw:false}]){
    const d=normalizeVectorScene({width:720,height:720,nodes:[{id:'person',type:'instance',asset:'hero'},{id:'lamp',type:'instance',asset:'lamp'}],
      carries:[{actor:'person',arm:'r',prop:'lamp',hang:true}],reaches:[{actor:'person',arm:'r',point:{x:133,y:220},start:0,end:1,...explicit}]},a);
    assert.equal(d.tracks.find(t=>t.target==='person/hand-r')!.frames.at(-1)!.dy,38,'explicit held height is preserved');
  }
});

test('continued cutout routes rebase every intermediate key without a backward jerk, preserving both destinations and grip',()=>{
  const a=normalizeVectorAssets({hero:{rig:'simple-puppet',design:'village'},lamp:{rig:'lantern'}});
  for(const sign of [-1,1]){
    const p=createCanvasProject();p.width=720;p.height=720;p.vectorAssets=a;
    p.scenes=[75,145,-75].map((destination,i)=>({...p.scenes[0]!,id:'route-'+i,durationMs:4000,narration:'walk',dialogue:undefined,
      vectorStageId:'yard',vectorDirection:{purpose:'A continuous route',location:'yard',shot:{size:'action' as const,focus:'person',include:['lamp']},
        beats:[{cue:'walk',kind:'travel' as const,targets:['person'],motionTargets:['person'],before:'at previous position',after:'at destination'}]},
      vectorScene:normalizeVectorScene({width:720,height:720,nodes:[{id:'person',type:'instance',asset:'hero',x:250,y:350},
        {id:'lamp',type:'instance',asset:'lamp'}],carries:[{actor:'person',arm:'r',prop:'lamp',hang:true}],tracks:[
        {target:'person',start:0,end:1,cue:'walk',frames:[{t:0,dx:0,dy:0},{t:.08,dx:destination*sign*.025,dy:destination*.025,easing:'ease-in'},
          {t:.92,dx:destination*sign*.975,dy:destination*.975,easing:'linear'},{t:1,dx:destination*sign,dy:destination,easing:'ease-out'}]},
      ]},a)}));
    const fixed=compileVectorProject(p);
    for(let i=1;i<fixed.scenes.length;i++){
      const previous=fixed.scenes[i-1]!,s=fixed.scenes[i]!,initial=evaluateVectorPart('person',previous,4000);
      for(const key of ['dx','dy'] as const){
        assert.equal(evaluateVectorPart('person',s,0)[key],initial[key]);
        const end=[75,145,-75][i]!*(key==='dx'?sign:1),direction=Math.sign(end-initial[key]);let last=initial[key];
        for(let ms=0;ms<=4000;ms+=1000/30){
          const value=evaluateVectorPart('person',s,ms)[key];
          assert.ok((value-last)*direction>=-1e-7,`${key}: no backwards second key after a cut`);
          assert.ok(Math.abs(value-last)<8,'no one-frame jump');last=value;
          const h=vectorPoint(vectorWorldMatrix('person/hand-r',s,ms),0,0),g=vectorPoint(vectorWorldMatrix('lamp',s,ms),30,6);
          assert.ok(Math.hypot(h.x-g.x,h.y-g.y)<1e-7);
        }
        assert.equal(evaluateVectorPart('person',s,4000)[key],end);
      }
    }
    assert.deepEqual(compileVectorProject(fixed),fixed);
  }
});
const hands=[{actor:'keeper',arm:'l' as const,prop:'light',hang:true},{actor:'keeper',arm:'r' as const,prop:'tool'}];
const direction=(extra:Partial<CanvasVectorDirection>={}):CanvasVectorDirection=>({purpose:'Observe the same world',location:'room',shot:{size:'action',focus:'keeper',include:[]},beats:[],...extra});
function scene(id:string,extra:Partial<CanvasVectorDirection>={},omit=false):CanvasStudioScene {
  return {...createCanvasProject().scenes[0]!,id,durationMs:6000,narration:'wait then drop tool',audioUrl:'/existing-speech.wav',
    dialogue:[{id:'voice',speaker:'narrator',text:'wait then drop tool',durationMs:6000,atMs:0}],vectorStageId:'room',vectorDirection:direction(extra),
    vectorScene:normalizeVectorScene({width:720,height:1280,nodes:[
      {id:'keeper',type:'instance',asset:'person',x:300,y:500,width:180,height:360},
      ...(!omit?[{id:'light',type:'instance',asset:'light',x:120,y:600,width:48,height:80},
        {id:'tool',type:'instance',asset:'tool',x:180,y:800,width:30,height:90}]:[]),
    ],ground:{y:980,targets:[{target:'keeper'}]},tracks:[
      {target:'keeper/arm-l',start:0,end:1,frames:[{t:0,rotation:-65}]},
      {target:'keeper/forearm-l',start:0,end:1,frames:[{t:0,rotation:0}]},
      {target:'keeper/arm-r',start:0,end:1,frames:[{t:0,rotation:65}]},
    ]},assets)};
}
function film(scenes:CanvasStudioScene[]){return {...createCanvasProject(),width:720,height:1280,vectorAssets:assets,scenes};}
const hand=(s:CanvasStudioScene,side:string,t:number)=>vectorPoint(vectorWorldMatrix('keeper/hand-'+side,s,t,assets),0,0);
const grip=(s:CanvasStudioScene,id:string,t:number)=>vectorPoint(vectorWorldMatrix(id,s,t,assets),id==='light'?30:15,id==='light'?6:15);
const near=(a:{x:number;y:number},b:{x:number;y:number})=>assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1e-6,JSON.stringify({a,b}));

test('two occupied hands survive omitted close-up inventory and geometry without crossed arms or changed audio',()=>{
  const p=film([scene('wide',{heldProps:hands}),scene('detail',{heldProps:[]},true),scene('return',{heldProps:[]})]);
  const original=structuredClone(p),fixed=compileVectorProject(p);
  for(const s of fixed.scenes){
    assert.deepEqual(s.vectorDirection!.heldProps,hands);
    for(const h of hands){
      assert.equal(s.vectorScene!.nodes.find(n=>n.id===h.prop)!.attachTo,'keeper/hand-'+h.arm);
      for(let t=0;t<=s.durationMs;t+=50){
        near(grip(s,h.prop,t),hand(s,h.arm,t));
        const m=vectorWorldMatrix('keeper/upper-body',s,t,assets),p=hand(s,h.arm,t),det=m.a*m.d-m.b*m.c;
        const localX=(m.d*(p.x-m.e)-m.c*(p.y-m.f))/det;
        assert.ok(h.arm==='l'?localX<72:localX>168,'holding hand stays on its own side');
        const elbow=evaluateVectorPart('keeper/forearm-'+h.arm,s,t).rotation;
        assert.ok(Math.abs(elbow)<=120+.001,'carrying must not overfold the elbow');
      }
    }
  }
  for(let i=1;i<fixed.scenes.length;i++)for(const h of hands)near(grip(fixed.scenes[i-1]!,h.prop,6000),grip(fixed.scenes[i]!,h.prop,0));
  assert.deepEqual(fixed.scenes.map(s=>[s.audioUrl,s.dialogue,s.narration,s.durationMs]),p.scenes.map(s=>[s.audioUrl,s.dialogue,s.narration,s.durationMs]));
  assert.deepEqual(compileVectorProject(fixed),fixed);assert.deepEqual(p,original);
});

test('a release follows the hand up to its cue, lands on the floor and remains there through later cuts',()=>{
  const event={prop:'tool',action:'release' as const,cue:'drop tool'};
  const p=film([scene('carry',{heldProps:hands}),scene('drop',{heldProps:[hands[0]!],propEvents:[event]}),scene('after',{heldProps:[],beats:[
    {cue:'wait',kind:'motion',targets:['keeper','tool'],motionTargets:['keeper/eyes'],before:'looking away',after:'looking at the dropped tool'},
  ]})]);
  p.scenes[2]!.vectorScene!.nodes.find(n=>n.id==='tool')!.attachTo='keeper/hand-r'; // stale reusable-stage carry
  const fixed=compileVectorProject(p),s=fixed.scenes[1]!,after=fixed.scenes[2]!;
  const at=vectorTrackTiming({target:'tool',start:0,end:1,cue:event.cue,frames:[]},s).start;
  for(const t of [0,at/2,at-1])near(grip(s,'tool',t),hand(s,'r',t));
  assert.equal(s.vectorScene!.nodes.find(n=>n.id==='tool')!.attachTo,undefined);
  assert.deepEqual(after.vectorDirection!.heldProps,[hands[0]]);
  near(grip(s,'tool',6000),grip(after,'tool',0));
  const m=vectorWorldMatrix('tool',s,6000,assets);
  const bottom=Math.max(...[[0,0],[30,0],[0,90],[30,90]].map(([x,y])=>vectorPoint(m,x!,y!).y));
  assert.ok(Math.abs(bottom-980)<1e-6);
  assert.deepEqual(compileVectorProject(fixed),fixed);
});

test('an explicitly authored instance grip survives omitted cuts and release without a default asset grip',()=>{
  for(const hasDefault of [false,true]){
    const library=normalizeVectorAssets({...assets,light:{width:60,height:100,...(hasDefault?{grip:{x:30,y:6}}:{}),nodes:[
      {id:'custom-shell',type:'rect',x:10,y:25,width:40,height:70,fill:'#453'},
    ]}});
    const first=scene('take',{heldProps:[hands[0]!]});
    first.vectorScene=normalizeVectorScene({...first.vectorScene,carries:[{...hands[0]!,grip:{x:28,y:11}}]},library);
    const drop=scene('drop',{heldProps:[],propEvents:[{prop:'light',action:'release',cue:'drop tool'}]});
    const p={...film([first,scene('detail',{heldProps:[]},true),scene('return',{heldProps:[]}),drop,scene('after',{heldProps:[]})]),vectorAssets:library};
    const original=structuredClone(p),fixed=compileVectorProject(p);
    const atGrip=(s:CanvasStudioScene,t:number)=>vectorPoint(vectorWorldMatrix('light',s,t,library),28,11);
    const atHand=(s:CanvasStudioScene,t:number)=>vectorPoint(vectorWorldMatrix('keeper/hand-l',s,t,library),0,0);
    for(const s of fixed.scenes.slice(0,3))for(let t=0;t<=6000;t+=100)near(atGrip(s,t),atHand(s,t));
    const released=fixed.scenes[3]!,after=fixed.scenes[4]!;
    near(atGrip(released,0),atHand(released,0));
    assert.equal(released.vectorScene!.nodes.find(n=>n.id==='light')!.attachTo,undefined);
    assert.equal(after.vectorScene!.nodes.find(n=>n.id==='light')!.attachTo,undefined);
    near(atGrip(released,6000),atGrip(after,0));
    assert.deepEqual(compileVectorProject(fixed),fixed);assert.deepEqual(p,original);
  }
});

test('raising a carried lamp crosses the angle wrap smoothly while staying on its shoulder side',()=>{
  const raw=scene('raise',{heldProps:[hands[0]!]});
  raw.vectorScene!.tracks=raw.vectorScene!.tracks.map(t=>t.target==='keeper/arm-l'?{...t,frames:[
    {t:0,rotation:-65,easing:'smooth' as const},{t:.5,rotation:-180,easing:'smooth' as const},{t:1,rotation:-65,easing:'smooth' as const},
  ]}:t);
  const fixed=compileVectorProject(film([raw])),s=fixed.scenes[0]!;
  for(const track of s.vectorScene!.tracks.filter(t=>t.target==='keeper/arm-l'))for(let i=1;i<track.frames.length;i++)
    assert.ok(Math.abs(track.frames[i]!.rotation!-track.frames[i-1]!.rotation!)<180,'never interpolate the long way around a wrap');
  let previous=hand(s,'l',0);
  for(let ms=0;ms<=s.durationMs;ms+=1000/30){
    const current=hand(s,'l',ms);near(grip(s,'light',ms),current);
    assert.ok(Math.hypot(current.x-previous.x,current.y-previous.y)<8,'no per-frame hand teleport');previous=current;
  }
  assert.deepEqual(compileVectorProject(fixed),fixed);
});

test('a neck-level folded carry is solved with the elbow below its shoulder on both arms, including a tilted torso',()=>{
  const raw=scene('folded',{heldProps:hands});
  raw.vectorScene!.tracks=[{target:'keeper/upper-body',start:0,end:1,frames:[{t:0,rotation:12}]},
    ...(['l','r'] as const).flatMap(side=>[
      {target:'keeper/arm-'+side,start:0,end:1,frames:[{t:0,rotation:side==='l'?216:-216}]},
      {target:'keeper/forearm-'+side,start:0,end:1,frames:[{t:0,rotation:side==='l'?-141:141}]},
    ])];
  const p=film([raw]),before=structuredClone(p),fixed=compileVectorProject(p),s=fixed.scenes[0]!;
  for(const h of hands)for(let t=0;t<=6000;t+=100){
    const body=vectorWorldMatrix('keeper/upper-body',s,t,assets),shoulder=vectorPoint(body,h.arm==='l'?80:160,190);
    const elbow=vectorPoint(vectorWorldMatrix('keeper/forearm-'+h.arm,s,t,assets),0,0),det=body.a*body.d-body.b*body.c;
    const localDy=(-body.b*(elbow.x-shoulder.x)+body.a*(elbow.y-shoulder.y))/det;
    assert.ok(localDy>15,'elbow hangs below its own shoulder rather than folding into the neck');
    assert.ok(Math.abs(evaluateVectorPart('keeper/forearm-'+h.arm,s,t).rotation)<=120);
    near(grip(s,h.prop,t),hand(s,h.arm,t));
  }
  assert.deepEqual(compileVectorProject(fixed),fixed);assert.deepEqual(p,before);
});

test('hung props stay upright on their support, and left-behind props do not respawn in a new location',()=>{
  const hanging=scene('hang',{heldProps:[],propEvents:[{prop:'light',action:'release',cue:'hang lamp'}]});
  hanging.narration='hang lamp';hanging.dialogue![0]!.text='hang lamp';
  const elsewhere={...scene('elsewhere',{heldProps:[]}),vectorStageId:'outside'};
  const p=film([scene('carry',{heldProps:[hands[0]!]}),hanging,scene('after',{heldProps:[]}),elsewhere]);
  const fixed=compileVectorProject(p),s=fixed.scenes[1]!,next=fixed.scenes[2]!;
  assert.equal(evaluateVectorPart('light',s,6000).rotation,0);
  near(grip(s,'light',6000),grip(next,'light',0));
  assert.ok(!fixed.scenes[3]!.vectorScene!.nodes.some(n=>n.id==='light'));
  assert.deepEqual(compileVectorProject(fixed),fixed);
});

test('hand conflicts need an explicit release, while an intentional time jump resets inherited inventory and pose',()=>{
  assert.throws(()=>continueVectorHandPlan(direction({heldProps:[{...hands[0]!,prop:'other'}]}),[hands[0]!]),/occupied hand/);
  assert.throws(()=>continueVectorHandPlan(direction({heldProps:[{...hands[0]!,arm:'r'}]}),[hands[0]!]),/changes hands/);
  const p=film([scene('carry',{heldProps:hands}),scene('later',{heldProps:[],continuity:'reset'})]);
  const fixed=compileVectorProject(p),s=fixed.scenes[1]!;
  assert.deepEqual(s.vectorDirection!.heldProps,[]);
  assert.ok(s.vectorScene!.nodes.filter(n=>['light','tool'].includes(n.id)).every(n=>!n.attachTo));
  assert.equal(evaluateVectorPart('keeper/arm-l',s,0).rotation,-65);
  assert.deepEqual(compileVectorProject(fixed),fixed);
});
