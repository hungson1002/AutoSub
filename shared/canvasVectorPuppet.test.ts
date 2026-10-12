import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvasProject} from './canvasAnimationStudio';
import {compileVectorProject,normalizeVectorAssets,normalizeVectorScene,evaluateVectorPart} from './canvasVectorScene';
import {vectorPoint,vectorWorldMatrix} from './canvasVectorTransform';
import {readableVectorNightAssets} from './canvasVectorLight';
import {puppetHandOpacity} from './canvasVectorPuppet';

test('village fear has the reference wavy mouth, forehead stress and small alternating temple drops instead of a giant O',()=>{
  const assets=normalizeVectorAssets({hero:{rig:'simple-puppet',design:'village'}});
  const s={...createCanvasProject().scenes[0]!,durationMs:4000,narration:'',vectorAssetLibrary:assets,
    vectorScene:normalizeVectorScene({width:720,height:1280,nodes:[{id:'person',type:'instance',asset:'hero'}],
      reactions:[{actor:'person',kind:'fear',level:'terrified',start:.2,end:.8}]},assets)};
  const body=s.vectorScene.tracks.find(t=>t.target==='person/upper-body')!;
  assert.ok(body.frames.every(f=>Math.abs(f.dx??0)<=1.8&&Math.abs(f.rotation??0)<=.25));
  const mouth=evaluateVectorPart('person/mouth',s,1400);
  assert.match(mouth.d!,/Q/);assert.ok(!mouth.d!.includes('A'));assert.equal(mouth.fill,'none');assert.equal(mouth.scaleY,1);
  assert.equal(evaluateVectorPart('person/fear-stress',s,1400,0).opacity,1);
  for(const side of ['l','r'])assert.ok(assets.hero!.nodes.find(n=>n.id==='sweat-'+side)!.scaleX!<.7);
  for(let ms=0;ms<=4000;ms+=1000/30){
    const left=evaluateVectorPart('person/sweat-l',s,ms,0).opacity,right=evaluateVectorPart('person/sweat-r',s,ms,0).opacity;
    assert.ok(left<.05||right<.05,'small drops take turns; they are not two huge tears');
    assert.equal(puppetHandOpacity('person/hand-l',s,ms),0);
  }
  assert.equal(evaluateVectorPart('person/fear-stress',s,3500,0).opacity,0);
});

test('native fear shivers briefly with a readable face, staggered sweat and a stable held prop',()=>{
  const assets=normalizeVectorAssets({hero:{rig:'simple-puppet',finish:'handdrawn'},lamp:{rig:'lantern'}});
  const d=normalizeVectorScene({width:720,height:1280,nodes:[{id:'person',type:'instance',asset:'hero',x:100,y:400},
    {id:'lamp',type:'instance',asset:'lamp',width:42,height:70}],carries:[{actor:'person',arm:'r',prop:'lamp',hang:true}],
    reactions:[{actor:'person',kind:'fear',level:'terrified',start:.2,end:.44}]},assets);
  const s={...createCanvasProject().scenes[0]!,durationMs:10000,vectorScene:d,vectorAssetLibrary:assets};
  const body=d.tracks.find(t=>t.target==='person/upper-body')!;
  assert.ok(body.frames.filter(f=>(f.dx??0)>0).length>=9,'fast small shivers, not a slow sway');
  assert.ok(body.frames.every(f=>Math.abs(f.dx??0)<=3&&Math.abs(f.rotation??0)<=.55));
  assert.equal(evaluateVectorPart('person/upper-body',s,1800).dx,0);
  assert.equal(evaluateVectorPart('person/upper-body',s,4500).dx,0);
  assert.ok(evaluateVectorPart('person/eyes',s,2600).scaleY>1.2);
  assert.ok(evaluateVectorPart('person/mouth',s,2600).scaleY>3);
  assert.ok(evaluateVectorPart('person/sweat-l',s,2600,0).opacity>.8);
  assert.equal(evaluateVectorPart('person/sweat-r',s,2200,0).opacity,0);
  for(let at=0;at<=10000;at+=1000/30){
    const hand=vectorPoint(vectorWorldMatrix('person/hand-r',s,at),0,0),grip=vectorPoint(vectorWorldMatrix('lamp',s,at),30,6);
    assert.ok(Math.hypot(hand.x-grip.x,hand.y-grip.y)<1e-7);
    assert.equal(puppetHandOpacity('person/hand-l',s,at),0,'fear never invents an unused hand');
  }
  for(const part of ['sweat-l','sweat-r'])assert.equal(evaluateVectorPart('person/'+part,s,4500,0).opacity,0);
  assert.equal(evaluateVectorPart('person/eyes',s,4500).scaleY,1);
  assert.deepEqual(normalizeVectorScene(d,assets),d);
  assert.throws(()=>normalizeVectorScene({...d,reactions:[{actor:'person',kind:'fear',level:'wild'}]},assets),/fear level/);
});

test('native puppet head cannot detach when a repair duplicates root travel',()=>{
  const assets=normalizeVectorAssets({person:{rig:'simple-puppet'}});
  const d=normalizeVectorScene({width:720,height:1280,nodes:[{id:'person',type:'instance',asset:'person'}],tracks:[
    {target:'person/head-group',start:0,end:1,frames:[{t:0,dx:0,dy:0},{t:1,dx:-55,dy:40}]},
  ]},assets);
  assert.equal(d.tracks[0]!.frames[1]!.dx,-4);
  assert.equal(d.tracks[0]!.frames[1]!.dy,3);
  assert.deepEqual(normalizeVectorScene(d,assets),d);
});

test('native dot-hand contact reaches the actual target under nested and scaled world transforms',()=>{
  const assets=normalizeVectorAssets({person:{rig:'simple-puppet'},lamp:{rig:'lantern'}});
  for(const side of ['l','r']){
    const drawing=normalizeVectorScene({width:720,height:1280,nodes:[
      {id:'world',type:'group',x:30,y:100,scaleX:1.2,scaleY:1.2},
      {id:'person',type:'instance',parent:'world',asset:'person',x:100,y:300},
      {id:'lamp',type:'instance',parent:'world',asset:'lamp',x:240,y:435},
    ],reaches:[{actor:'person',arm:side,target:'lamp',start:.1,end:.6}]},assets);
    const s={...createCanvasProject().scenes[0]!,durationMs:2000,vectorScene:drawing,vectorAssetLibrary:assets};
    const hand=vectorPoint(vectorWorldMatrix('person/hand-'+side,s,1200),0,0);
    const grip=vectorPoint(vectorWorldMatrix('lamp',s,1200),30,6);
    assert.ok(Math.hypot(hand.x-grip.x,hand.y-grip.y)<1e-7);
    assert.equal(puppetHandOpacity('person/hand-'+side,s,1200),1);
    assert.equal(puppetHandOpacity('person/hand-'+(side==='r'?'l':'r'),s,1200),0);
    assert.equal(drawing.tracks.some(t=>/\/arm-|\/forearm-/.test(t.target)),false);
    assert.deepEqual(normalizeVectorScene(drawing,assets),drawing);
  }
});

test('a dot hand prepares, taps in contact, withdraws and disappears while the body settles',()=>{
  const assets=normalizeVectorAssets({person:{rig:'simple-puppet'},bell:{width:40,height:50,nodes:[{id:'case',type:'rect',width:40,height:50,fill:'#bda66a'}]}});
  const d=normalizeVectorScene({width:720,height:1280,nodes:[
    {id:'person',type:'instance',asset:'person',x:100,y:300},
    {id:'bell',type:'instance',asset:'bell',x:230,y:405},
  ],strikes:[{actor:'person',arm:'r',target:'bell',start:0,end:1}]},assets);
  const s={...createCanvasProject().scenes[0]!,durationMs:2000,vectorScene:d,vectorAssetLibrary:assets};
  const hand=vectorPoint(vectorWorldMatrix('person/hand-r',s,760),0,0);
  const target=vectorPoint(vectorWorldMatrix('bell',s,760),20,27.5);
  assert.ok(Math.hypot(hand.x-target.x,hand.y-target.y)<1e-7);
  assert.equal(puppetHandOpacity('person/hand-r',s,760),1);
  assert.equal(puppetHandOpacity('person/hand-l',s,760),0);
  assert.equal(puppetHandOpacity('person/hand-r',s,2000),0);
  assert.equal(evaluateVectorPart('person/hand-r',s,2000).dx,0);
  assert.equal(d.tracks.some(t=>t.frames.some(f=>Object.values(f).some(v=>typeof v==='number'&&!Number.isFinite(v)))),false);
});

test('puppet reaches reject remote targets instead of pretending that a chest wobble is contact',()=>{
  const assets=normalizeVectorAssets({person:{rig:'simple-puppet'}});
  const nodes=[{id:'person',type:'instance',asset:'person',x:100,y:300},{id:'rope',type:'rect',x:600,y:350,width:8,height:200}];
  assert.throws(()=>normalizeVectorScene({width:720,height:1280,nodes,reaches:[{actor:'person',arm:'r',target:'rope'}]},assets),/out of reach/);
  assert.throws(()=>normalizeVectorScene({width:720,height:1280,nodes,reaches:[{actor:'person',arm:'r',target:'missing'}]},assets),/fixed object/);
});

test('a tap after walking solves contact at the arrived position instead of the old resting position',()=>{
  const assets=normalizeVectorAssets({person:{rig:'simple-puppet'},bell:{width:40,height:50,nodes:[{id:'case',type:'rect',width:40,height:50,fill:'#bda66a'}]}});
  const d=normalizeVectorScene({width:720,height:1280,nodes:[
    {id:'person',type:'instance',asset:'person',x:100,y:300},
    {id:'door',type:'rect',x:500,y:300,width:80,height:280,fill:'#776655'},
    {id:'bell',type:'instance',asset:'bell',x:400,y:450},
  ],walks:[{actor:'person',to:'door',gap:200,start:0,end:.3}],
    strikes:[{actor:'person',arm:'r',target:'bell',start:.5,end:1}]},assets);
  const s={...createCanvasProject().scenes[0]!,durationMs:2000,vectorScene:d,vectorAssetLibrary:assets};
  const at=1380,hand=vectorPoint(vectorWorldMatrix('person/hand-r',s,at),0,0);
  const target=vectorPoint(vectorWorldMatrix('bell',s,at),20,27.5);
  assert.equal(evaluateVectorPart('person',s,at).dx,150);
  assert.ok(Math.hypot(hand.x-target.x,hand.y-target.y)<1e-7,'the actual hand must touch after travel');
  assert.deepEqual(normalizeVectorScene(d,assets),d);
});

test('puppet anatomy is one robe and a round head without articulated limbs',()=>{
  const assets=normalizeVectorAssets({person:{rig:'simple-puppet',palette:{shirt:'#65543f'}}});
  const rig=assets.person!;
  assert.equal(rig.width,180);assert.equal(rig.height,280);
  assert.equal(rig.nodes.some(n=>/^(arm|forearm|leg|knee|foot)-/.test(n.id)),false);
  assert.ok(rig.nodes.some(n=>n.id==='torso'&&n.fill==='#65543f'));
  for(const side of ['l','r']){
    assert.equal(rig.nodes.find(n=>n.id==='eye-'+side)!.parent,'eyes');
    assert.equal(rig.nodes.find(n=>n.id==='hand-'+side)!.parent,'upper-body');
  }
  assert.deepEqual(normalizeVectorAssets(assets),assets);
});

test('puppets have round contact hands, scalp-attached hair and an explicit bald option',()=>{
  const assets=normalizeVectorAssets({person:{rig:'simple-puppet'},bald:{rig:'simple-puppet',hair:'none'},tied:{rig:'simple-puppet',hair:'tied'}});
  const rig=assets.person!;
  for(const id of ['hand-l','hand-r']){
    const hand=rig.nodes.find(n=>n.id===id)!;
    assert.equal(hand.rx,17);assert.equal(hand.ry,17);assert.notEqual(hand.opacity,0);
  }
  assert.equal(rig.nodes.find(n=>n.id==='hair')!.parent,'head-group');
  assert.equal(rig.nodes.find(n=>n.id==='hair-tip')!.parent,'head-group');
  assert.equal(rig.nodes.find(n=>n.id==='blink')!.parent,'head-group');
  assert.equal(rig.nodes.find(n=>n.id==='eyes')!.parent,'blink');
  assert.equal(assets.bald!.nodes.some(n=>/^hair/.test(n.id)),false);
  assert.notEqual(assets.tied!.nodes.find(n=>n.id==='hair-tip')!.d,rig.nodes.find(n=>n.id==='hair-tip')!.d);
  const night=readableVectorNightAssets(assets,'night horror');
  assert.equal(night.person!.nodes.find(n=>n.id==='hair')!.fill,rig.nodes.find(n=>n.id==='hair')!.fill);
  assert.throws(()=>normalizeVectorAssets({person:{rig:'simple-puppet',hair:'unknown'}}),/hairstyle/);
});

test('puppet costumes and hair change real silhouettes and details while preserving the rig',()=>{
  const outfits=['robe','tunic','ao-dai','vest','shawl'],hair=['short','side-part','bun','long','tied','none'];
  const clothing=new Set<string>(),hairstyles=new Set<string>();
  for(const outfit of outfits)for(const style of hair){
    const assets=normalizeVectorAssets({person:{rig:'simple-puppet',outfit,hair:style,palette:{shirt:'#466f68',accent:'#b89d6a',inner:'#d9cbb2'}}});
    const rig=assets.person!;
    assert.equal(rig.nodes.find(n=>n.id==='hand-r')!.x,133);
    assert.equal(rig.nodes.find(n=>n.id==='upper-body')!.pivotY,280);
    assert.equal(rig.nodes.some(n=>/^(arm|forearm|leg|knee|foot)-/.test(n.id)),false);
    clothing.add(JSON.stringify(rig.nodes.filter(n=>n.parent==='costume')));
    hairstyles.add(JSON.stringify(rig.nodes.filter(n=>/^hair/.test(n.id))));
    assert.deepEqual(normalizeVectorAssets(assets),assets);
  }
  assert.equal(clothing.size,outfits.length);assert.equal(hairstyles.size,hair.length);
  assert.throws(()=>normalizeVectorAssets({person:{rig:'simple-puppet',outfit:'unknown'}}),/outfit/);
  assert.throws(()=>normalizeVectorAssets({person:{rig:'simple-puppet',palette:{accent:'invalid'}}}),/palette/);
});

test('chibi proportions use a near-circular large head and a short rounded body',()=>{
  const rig=normalizeVectorAssets({person:{rig:'simple-puppet'}}).person!;
  const head=rig.nodes.find(n=>n.id==='head-group')!,face=rig.nodes.find(n=>n.id==='face')!;
  const faceWidth=face.rx!*2*head.scaleX!,faceHeight=face.ry!*2*head.scaleY!;
  assert.ok(Math.abs(faceWidth/faceHeight-1)<.04,'the visible face must be round, not a tall oval');
  assert.ok(faceHeight>280-162,'the head is taller than the compact body');
  assert.ok((rig.nodes.find(n=>n.id==='torso')!.d!.match(/Q/g)||[]).length>=5,'shoulders and hem need actual curved geometry');
  assert.equal(rig.nodes.find(n=>n.id==='costume')!.scaleY,.78);
  for(const side of ['l','r'])assert.equal(rig.nodes.find(n=>n.id==='hand-'+side)!.y,182);
  assert.ok(rig.nodes.some(n=>n.id==='cheek-l'));assert.ok(rig.nodes.some(n=>n.id==='cheek-r'));
});

test('Model A uses layered palette-aware hair and decorated robes without side arm or sleeve shapes',()=>{
  const assets=normalizeVectorAssets({
    traveler:{rig:'simple-puppet',outfit:'robe',hair:'side-part'},
    woman:{rig:'simple-puppet',outfit:'ao-dai',hair:'bun'},
    elder:{rig:'simple-puppet',outfit:'tunic',hair:'side-part',facialHair:'moustache',palette:{hair:'#a0a0a0'}},
  });
  for(const rig of Object.values(assets)){
    assert.equal(rig.nodes.some(n=>/arm|sleeve|forearm|leg|foot|knee/.test(n.id)),false);
    assert.equal(rig.nodes.filter(n=>/^hand-[lr]$/.test(n.id)).length,2);
    assert.ok(rig.nodes.some(n=>n.id==='hair-layer'));
    assert.ok(rig.nodes.some(n=>n.id==='hair-part'));
    assert.deepEqual(normalizeVectorAssets({actor:rig}).actor,rig);
  }
  for(const id of ['collar','lapel-l','lapel-r','sash','sash-knot','sash-end','hem-trim'])
    assert.ok(assets.traveler!.nodes.some(n=>n.id===id),id);
  for(const id of ['wrap-l','wrap-r','fabric-flower','fastener-0','hair-pin','hair-bun'])
    assert.ok(assets.woman!.nodes.some(n=>n.id===id),id);
  assert.equal(assets.elder!.nodes.find(n=>n.id==='hair-layer')!.fill,'#aaaaaa');
  assert.equal(assets.elder!.nodes.find(n=>n.id==='moustache')!.fill,'#a0a0a0');
  assert.equal(assets.traveler!.nodes.some(n=>n.id==='moustache'),false);
  assert.throws(()=>normalizeVectorAssets({person:{rig:'simple-puppet',facialHair:'invalid'}}),/facial hair/);
});

test('puppet reactions arrive, settle once and hold without cyclic swaying or phantom hands',()=>{
  const assets=normalizeVectorAssets({person:{rig:'simple-puppet'}}),p=createCanvasProject();p.vectorAssets=assets;
  for(const kind of ['look','startle']){
    const drawing=normalizeVectorScene({width:720,height:1280,nodes:[
      {id:'person',type:'instance',asset:'person',x:100},
      {id:'door',type:'rect',x:400,width:80,height:280,fill:'#776655'},
    ],ground:{y:980,targets:[{target:'person'},{target:'door'}]},reactions:[{actor:'person',toward:'door',kind,start:0,end:1}]},assets);
    const scene={...p.scenes[0]!,durationMs:2000,vectorScene:drawing};
    for(const part of ['upper-body','head-group','eyes','mouth']){
      const first=evaluateVectorPart('person/'+part,scene,1200),last=evaluateVectorPart('person/'+part,scene,2000);
      assert.equal(first.rotation,last.rotation);assert.equal(first.dx,last.dx);assert.equal(first.scaleY,last.scaleY);
    }
    assert.equal(puppetHandOpacity('person/hand-l',scene,500),0);
    assert.equal(puppetHandOpacity('person/hand-r',scene,500),0);
    assert.ok(Math.abs(evaluateVectorPart('person/upper-body',scene,440).rotation)<=6);
  }
});

test('the short chibi body keeps a full-size hanging lantern above ground during a lean',()=>{
  const p=createCanvasProject();p.width=720;p.height=1280;p.vectorAssets=normalizeVectorAssets({person:{rig:'simple-puppet'},lamp:{rig:'lantern'}});
  for(const side of ['l','r']){
    p.scenes=[{...p.scenes[0]!,durationMs:2000,vectorScene:normalizeVectorScene({width:p.width,height:p.height,nodes:[
      {id:'person',type:'instance',asset:'person',x:150},
      {id:'lamp',type:'instance',asset:'lamp',width:60,height:100},
    ],ground:{y:980,targets:[{target:'person'}]},carries:[{actor:'person',arm:side,prop:'lamp',hang:true}],tracks:[
      {target:'person/upper-body',start:0,end:1,frames:[{t:0,rotation:-10},{t:1,rotation:10}]},
      {target:'lamp',start:0,end:1,frames:[{t:0,rotation:-5},{t:1,rotation:5}]},
    ]},p.vectorAssets)}];
    const s=compileVectorProject(p).scenes[0]!;
    for(let ms=0;ms<=2000;ms+=20){
      const m=vectorWorldMatrix('lamp',s,ms);
      for(const x of [8,52])assert.ok(vectorPoint(m,x,92).y<980,'the actual case including its outline must not sink into the ground');
      const hand=vectorPoint(vectorWorldMatrix('person/hand-'+side,s,ms),0,0),grip=vectorPoint(m,30,6);
      assert.ok(Math.hypot(hand.x-grip.x,hand.y-grip.y)<1e-7);
    }
  }
});

test('only a carrying or actively gesturing puppet hand is visible',()=>{
  const p=createCanvasProject();p.vectorAssets=normalizeVectorAssets({person:{rig:'simple-puppet'},lamp:{rig:'lantern'}});
  const nodes=[{id:'person',type:'instance',asset:'person',x:100,y:300},{id:'lamp',type:'instance',asset:'lamp',width:45,height:75}];
  p.scenes=[{...p.scenes[0]!,durationMs:2000,vectorScene:normalizeVectorScene({width:p.width,height:p.height,nodes,
    carries:[{actor:'person',arm:'r',prop:'lamp',hang:true}],tracks:[{target:'person/hand-l',start:.2,end:.6,
      frames:[{t:0,dy:0},{t:.5,dy:-14},{t:1,dy:0}]}]},p.vectorAssets)}];
  const s=compileVectorProject(p).scenes[0]!;
  for(const ms of [0,300,800,1300,2000])assert.equal(puppetHandOpacity('person/hand-r',s,ms),1);
  assert.equal(puppetHandOpacity('person/hand-l',s,0),0);
  assert.equal(puppetHandOpacity('person/hand-l',s,800),1);
  assert.equal(puppetHandOpacity('person/hand-l',s,440),.5);
  assert.equal(puppetHandOpacity('person/hand-l',s,1300),0);
  const released={...s,vectorScene:{...s.vectorScene!,nodes:s.vectorScene!.nodes.map(n=>n.id==='lamp'?{...n,attachTo:undefined}:n)}};
  assert.equal(puppetHandOpacity('person/hand-r',released,0),0);
  const hidden={...s,vectorScene:{...s.vectorScene!,nodes:s.vectorScene!.nodes.map(n=>n.id==='lamp'?{...n,opacity:0}:n)}};
  assert.equal(puppetHandOpacity('person/hand-r',hidden,0),0);
  const pose={...released,vectorScene:{...released.vectorScene,tracks:[{target:'person/hand-l',start:0,end:1,frames:[
    {t:0,opacity:0},{t:.25,opacity:1},{t:.75,opacity:1},{t:1,opacity:0},
  ]}]}};
  assert.equal(puppetHandOpacity('person/hand-l',pose,1000),1);
  assert.equal(puppetHandOpacity('person/hand-r',pose,1000),0);
  assert.equal(puppetHandOpacity('person/hand-l',pose,2000),0);
});

test('puppet travel keeps a quiet cutout lean, stable props and no automatic cloth or hair wobble',()=>{
  const assets=normalizeVectorAssets({person:{rig:'simple-puppet'},lamp:{rig:'lantern'}}),p=createCanvasProject();
  p.width=720;p.height=1280;p.vectorAssets=assets;
  p.scenes=[{...p.scenes[0]!,durationMs:4000,vectorScene:normalizeVectorScene({width:720,height:1280,nodes:[
    {id:'person',type:'instance',asset:'person',x:100,width:180,height:280},
    {id:'lamp',type:'instance',asset:'lamp',width:45,height:75},
    {id:'door',type:'rect',x:500,width:80,height:360,fill:'#554433'},
  ],ground:{y:980,targets:[{target:'person'},{target:'door'}]},carries:[{actor:'person',arm:'r',prop:'lamp',hang:true}],
  walks:[{actor:'person',to:'door',gap:100,start:.1,end:.9}]},assets)}];
  const fixed=compileVectorProject(p),s=fixed.scenes[0]!;
  const parts=['upper-body','head-group'];
  for(const part of parts){
    const t=s.vectorScene!.tracks.find(t=>t.target==='person/'+part)!;
    assert.ok(t.frames.length<=32);assert.ok(t.frames.some(f=>Math.abs(f.rotation??0)>.3));
    assert.equal(t.frames[0]!.rotation,0);assert.equal(t.frames.at(-1)!.rotation,0);
  }
  assert.ok(!s.vectorScene!.tracks.some(t=>['person/robe-fold','person/hair-tip'].includes(t.target)));
  let last=-1;
  for(let ms=400;ms<=3600;ms+=20){
    const root=evaluateVectorPart('person',s,ms);
    assert.ok(root.dx>last);last=root.dx;
    assert.equal(root.dy,0);
    assert.ok(Math.abs(evaluateVectorPart('person/upper-body',s,ms).rotation)<2.4);
    const hand=vectorPoint(vectorWorldMatrix('person/hand-r',s,ms),0,0),grip=vectorPoint(vectorWorldMatrix('lamp',s,ms),30,6);
    assert.ok(Math.hypot(hand.x-grip.x,hand.y-grip.y)<1e-7);
  }
  assert.deepEqual(compileVectorProject(fixed),fixed);
});

test('whole-body turns keep the planted center and occupied hand, without a zero-width collapse',()=>{
  const assets=normalizeVectorAssets({person:{rig:'simple-puppet',finish:'handdrawn',hair:'side-part'},lamp:{rig:'lantern'}});
  const drawing=normalizeVectorScene({width:720,height:1280,nodes:[
    {id:'person',type:'instance',asset:'person',x:200,y:600},
    {id:'lamp',type:'instance',asset:'lamp',width:45,height:75},
  ],carries:[{actor:'person',arm:'r',prop:'lamp',hang:true}],
  turns:[{actor:'person',from:'right',to:'left',start:.1,end:.2},{actor:'person',from:'left',to:'back',start:.4,end:.5}]},assets);
  const s={...createCanvasProject().scenes[0]!,durationMs:4000,vectorScene:drawing,vectorAssetLibrary:assets};
  for(let t=0;t<=4000;t+=1000/30){
    const center=vectorPoint(vectorWorldMatrix('person/upper-body',s,t),90,280);
    assert.ok(Math.hypot(center.x-290,center.y-880)<1e-7,'turn about planted center, never jump sideways');
    assert.ok(Math.abs(evaluateVectorPart('person/upper-body',s,t).scaleX)>=.76-1e-7);
    const hand=vectorPoint(vectorWorldMatrix('person/hand-r',s,t),0,0),grip=vectorPoint(vectorWorldMatrix('lamp',s,t),30,6);
    assert.ok(Math.hypot(hand.x-grip.x,hand.y-grip.y)<1e-7);
  }
  assert.equal(evaluateVectorPart('person/upper-body',s,1000).scaleX,-1,'the body and occupied hand both change side');
  assert.equal(evaluateVectorPart('person/rear-head',s,2400,0).opacity,1,'actual rear drawing');
  for(const part of ['blink','brow-l','brow-r','mouth','costume'])assert.equal(evaluateVectorPart('person/'+part,s,2400).opacity,0,'front detail hidden: '+part);
  assert.deepEqual(normalizeVectorScene(drawing,assets),drawing);
});

test('backwards compact travel retains the facing selected by a whole-body turn',()=>{
  const assets=normalizeVectorAssets({person:{rig:'simple-puppet',finish:'handdrawn'}});
  const d=normalizeVectorScene({width:720,height:1280,nodes:[
    {id:'person',type:'instance',asset:'person',x:200,y:600},
    {id:'threat',type:'rect',x:30,y:600,width:50,height:280},
  ],turns:[{actor:'person',to:'left',hold:true}],walks:[{actor:'person',to:'threat',backstep:80,start:.1,end:.8}]},assets);
  const s={...createCanvasProject().scenes[0]!,durationMs:4000,vectorScene:d,vectorAssetLibrary:assets};
  assert.equal(evaluateVectorPart('person',s,3200).dx,80,'retreat away from threat on the left');
  for(let t=0;t<=4000;t+=40)assert.equal(evaluateVectorPart('person/upper-body',s,t).scaleX,-1,'retreat does not turn around');
});

test('a rear pose persists through a same-location cut, then an explicit front turn restores the face',()=>{
  const p=createCanvasProject();p.width=720;p.height=1280;p.vectorAssets=normalizeVectorAssets({person:{rig:'simple-puppet',finish:'handdrawn'}});
  const world={width:720,height:1280,nodes:[{id:'person',type:'instance',asset:'person',x:200,y:600}]};
  const direction={purpose:'hold',location:'room',shot:{size:'wide',focus:'person',include:[]},beats:[]} as any;
  p.scenes=[{...p.scenes[0]!,id:'turn',durationMs:2000,vectorStageId:'room',vectorDirection:direction,
    vectorScene:normalizeVectorScene({...world,turns:[{actor:'person',to:'back',start:0,end:.2}]},p.vectorAssets)},
    {...p.scenes[0]!,id:'hold',durationMs:2000,vectorStageId:'room',vectorDirection:direction,vectorScene:normalizeVectorScene(world,p.vectorAssets)},
    {...p.scenes[0]!,id:'front',durationMs:2000,vectorStageId:'room',vectorDirection:direction,
      vectorScene:normalizeVectorScene({...world,turns:[{actor:'person',from:'back',to:'front',start:.2,end:.4}]},p.vectorAssets)}];
  const fixed=compileVectorProject(p);
  assert.equal(fixed.vectorAssets!.person!.nodes.find(n=>n.id==='rear-hair')!.fill,
    fixed.vectorAssets!.person!.nodes.find(n=>n.id==='hair')!.fill,'night readability must preserve the same hair color on the back');
  assert.equal(evaluateVectorPart('person/rear-head',fixed.scenes[1]!,0,0).opacity,1);
  assert.equal(evaluateVectorPart('person/blink',fixed.scenes[1]!,0).opacity,0);
  assert.equal(evaluateVectorPart('person/upper-body',fixed.scenes[1]!,0).scaleX,-1);
  assert.equal(evaluateVectorPart('person/rear-head',fixed.scenes[2]!,2000,0).opacity,0);
  assert.equal(evaluateVectorPart('person/blink',fixed.scenes[2]!,2000).opacity,1);
  assert.deepEqual(compileVectorProject(fixed),fixed);
});

test('left and right facing flips keep the original full-width drawing and prop grip in both directions',()=>{
  for(const finish of ['clean','handdrawn']){
    const assets=normalizeVectorAssets({person:{rig:'simple-puppet',finish,hair:'side-part'},lamp:{rig:'lantern'}});
    assert.equal(assets.person!.nodes.some(n=>n.id==='side-head'),false,'no newly invented side-profile artwork');
    const d=normalizeVectorScene({width:720,height:1280,nodes:[
      {id:'person',type:'instance',asset:'person',x:200,y:600},{id:'lamp',type:'instance',asset:'lamp',width:45,height:75},
    ],carries:[{actor:'person',arm:'r',prop:'lamp',hang:true}],turns:[
      {actor:'person',from:'right',to:'left',start:.1,end:.2},
      {actor:'person',from:'left',to:'right',start:.6,end:.7},
    ]},assets);
    const s={...createCanvasProject().scenes[0]!,durationMs:4000,vectorScene:d,vectorAssetLibrary:assets};
    for(let at=0;at<=4000;at+=1000/60){
      const body=evaluateVectorPart('person/upper-body',s,at);
      assert.equal(Math.abs(body.scaleX),1,'an image-style flip never squeezes, spins or collapses');
      assert.equal(body.rotation,0);
      const center=vectorPoint(vectorWorldMatrix('person/upper-body',s,at),90,280);
      assert.ok(Math.hypot(center.x-290,center.y-880)<1e-7);
      const hand=vectorPoint(vectorWorldMatrix('person/hand-r',s,at),0,0),grip=vectorPoint(vectorWorldMatrix('lamp',s,at),30,6);
      assert.ok(Math.hypot(hand.x-grip.x,hand.y-grip.y)<1e-7);
      assert.equal(evaluateVectorPart('person/blink',s,at).opacity,1,'keep the same original front face');
    }
    assert.equal(evaluateVectorPart('person/upper-body',s,1000).scaleX,-1);
    assert.equal(evaluateVectorPart('person/upper-body',s,3200).scaleX,1,'the missing other direction is tested too');
  }
});

test('automatic puppet blinks share both eyes and do not reset the rhythm at cuts',()=>{
  const p=createCanvasProject();p.vectorAssets=normalizeVectorAssets({person:{rig:'simple-puppet'}});
  const stage=normalizeVectorScene({width:p.width,height:p.height,nodes:[{id:'person',type:'instance',asset:'person',x:100,y:300}],tracks:[
    {target:'person/eyes',start:0,end:1,frames:[{t:0,scaleY:1.3}]},
  ]},p.vectorAssets);
  p.scenes=[{...p.scenes[0]!,id:'one',durationMs:4000,vectorScene:stage},{...p.scenes[0]!,id:'two',durationMs:4000,vectorScene:stage}];
  const before=structuredClone(p),fixed=compileVectorProject(p);
  assert.equal(evaluateVectorPart('person/blink',fixed.scenes[0]!,1872).scaleY,.08);
  assert.equal(evaluateVectorPart('person/blink',fixed.scenes[1]!,1972).scaleY,.08);
  assert.equal(evaluateVectorPart('person/blink',fixed.scenes[1]!,1872).scaleY,1);
  assert.equal(evaluateVectorPart('person/eyes',fixed.scenes[0]!,1872).scaleY,1.3);
  assert.equal(fixed.scenes[0]!.vectorScene!.tracks.some(t=>/\/eye-[lr]$/.test(t.target)),false);
  assert.equal(fixed.scenes[0]!.vectorScene!.tracks.some(t=>/\/(head-group|upper-body)$/.test(t.target)),false);
  assert.deepEqual(compileVectorProject(fixed),fixed);assert.deepEqual(p,before);
});

test('puppet travel, look and carried lamp survive a cut without creating phantom arm tracks',()=>{
  const p=createCanvasProject();p.width=720;p.height=1280;p.sourcePrompt='Truyện kinh dị ban đêm';
  p.vectorAssets=normalizeVectorAssets({person:{rig:'simple-puppet'},lamp:{rig:'lantern'}});
  const stage={width:720,height:1280,nodes:[
    {id:'person',type:'instance',asset:'person',x:100,width:180,height:280},
    {id:'lamp',type:'instance',asset:'lamp',width:45,height:75},
    {id:'door',type:'rect',x:500,width:80,height:360,fill:'#554433'},
  ],ground:{y:980,targets:[{target:'person'},{target:'door'}]},carries:[{actor:'person',arm:'r',prop:'lamp',hang:true}]};
  const scene=normalizeVectorScene({...stage,walks:[{actor:'person',to:'door',gap:100,start:0,end:.5}],
    reactions:[{actor:'person',kind:'look',toward:'door',start:.6,end:1,carry:'r'}]},p.vectorAssets);
  const follow=normalizeVectorScene({...stage,walks:[{actor:'person',to:'door',gap:100,hold:true}]},p.vectorAssets);
  p.scenes=[{...p.scenes[0]!,id:'travel',durationMs:4000,vectorStageId:'room',vectorScene:scene},
    {...p.scenes[0]!,id:'hold',durationMs:4000,vectorStageId:'room',vectorScene:follow}];
  const before=structuredClone(p),fixed=compileVectorProject(p);
  for(const s of fixed.scenes){
    assert.equal(s.vectorScene!.tracks.some(t=>/\/(?:arm|forearm|leg|knee|foot)-/.test(t.target)),false);
    for(let ms=0;ms<=4000;ms+=200){
      const hand=vectorPoint(vectorWorldMatrix('person/hand-r',s,ms),0,0),grip=vectorPoint(vectorWorldMatrix('lamp',s,ms),30,6);
      assert.ok(Math.hypot(hand.x-grip.x,hand.y-grip.y)<1e-7);
      assert.ok(Math.abs(vectorPoint(vectorWorldMatrix('person',s,ms),90,280).y-980)<1e-7);
      assert.equal(evaluateVectorPart('person/eyes',s,ms).scaleY,1);
    }
  }
  assert.deepEqual(compileVectorProject(fixed),fixed);assert.deepEqual(p,before);
});
