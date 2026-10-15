import test from 'node:test';
import assert from 'node:assert/strict';
import {vectorPuppetRig,vectorPuppetTravelTracks} from '../../shared/canvasVectorPuppet';
import {illustratedPlace} from './canvasVectorIllustratedPlace';
import {parseVectorPlan,vectorStoryCapabilities,applySelectedHorrorFinish,VECTOR_REVIEW_CONTRACT} from './canvasVectorDirector';
import {evaluateVectorPart,normalizeVectorAssets,normalizeVectorScene} from '../../shared/canvasVectorScene';
import type {CanvasStudioScene} from '../../shared/canvasAnimationStudio';
import {vectorPoint,vectorWorldMatrix} from '../../shared/canvasVectorTransform';
import {vectorPropGrip} from '../../shared/canvasVectorProps';

test('visual review cannot pass a geometrically valid but visually underdesigned film by default',()=>{
  assert.match(VECTOR_REVIEW_CONTRACT,/VISUAL QUALITY FLOOR/);
  assert.match(VECTOR_REVIEW_CONTRACT,/at least 8\/10 overall/);
  assert.match(VECTOR_REVIEW_CONTRACT,/identical geometric houses/);
  assert.match(VECTOR_REVIEW_CONTRACT,/A model.s self-awarded number alone is not evidence/);
});
test('actual folk-horror recipe selects compact cutout motion from screenplay, not just director prose',()=>{
  assert.equal(vectorStoryCapabilities('video 60 giây\\n\\n[folk-horror] Truyện kinh dị').compactCast,true);
  assert.equal(vectorStoryCapabilities('[ma-xo] chuyện ma bí ẩn').compactCast,true);
  assert.equal(vectorStoryCapabilities('Mình muốn nhân vật simple-human articulated [folk-horror]').compactCast,false);
  assert.equal(vectorStoryCapabilities('chuyện vui biểu cảm').compactCast,false);
});

test('natural elevated-village briefs choose compatible primary IDs before drawing, without forcing other places',()=>{
  assert.equal(vectorStoryCapabilities('[folk-horror] Ngõ làng nhìn từ trên xuống').nativePerson,true);
  assert.equal(vectorStoryCapabilities('[folk-horror] Cảnh làng rộng từ trên cao').nativePerson,true);
  assert.equal(vectorStoryCapabilities('Model A elevated village').nativePerson,true);
  assert.equal(vectorStoryCapabilities('[folk-horror] Rừng cây nhìn từ trên xuống').nativePerson,false);
  assert.equal(vectorStoryCapabilities('[folk-horror] Ngõ làng nhìn từ trên xuống simple-human articulated').nativePerson,false);
  assert.equal(vectorStoryCapabilities('illustrated-place forest').nativePerson,true,'explicit component keeps its supported ID contract');
});
const approved={rig:'simple-puppet',hair:'side-part',outfit:'tunic',
  palette:{skin:'#e9d0b0',shirt:'#687685',hair:'#362d2c',accent:'#c09d7b',trim:'#d8b992'}};

test('reference-inspired faces stay balanced and readable without painted bags under every eye',()=>{
  const asset=vectorPuppetRig({...approved,finish:'handdrawn'});
  assert.ok(!asset.nodes.some(n=>n.id==='handdrawn-eye-lower'||n.id==='handdrawn-hair-etch'));
  for(const side of ['l','r']){
    assert.equal(asset.nodes.find(n=>n.id==='eye-white-'+side)?.parent,'eyes');
    assert.equal(asset.nodes.find(n=>n.id==='eye-'+side)?.parent,'eyes');
    assert.ok(asset.nodes.find(n=>n.id==='eye-white-'+side)!.rx!>asset.nodes.find(n=>n.id==='eye-'+side)!.rx!);
  }
  assert.equal(asset.nodes.find(n=>n.id==='eyes')?.parent,'blink');
  assert.equal(asset.nodes.find(n=>n.id==='face')?.strokeWidth,3);
  assert.equal(vectorPuppetRig({...approved,finish:'clean'}).nodes.some(n=>n.id.startsWith('eye-white-')),false);
  const tired=vectorPuppetRig({...approved,finish:'handdrawn',eyeStyle:'tired'});
  assert.ok(tired.nodes.find(n=>n.id==='eye-white-l')!.ry!>tired.nodes.find(n=>n.id==='eye-white-l')!.rx!,'tired brows need not flatten eye anatomy');
  assert.ok(asset.nodes.filter(n=>/^button-\d$/.test(n.id)).every(n=>n.opacity===0),'no repeated ornate clasps on a rural tunic');
});

test('compact reference travel moves steadily both ways, stays rigid and holds its endpoint',()=>{
  const assets=normalizeVectorAssets({hero:{...approved,finish:'handdrawn'}});
  for(const destination of [70,620]){
    const drawing=normalizeVectorScene({width:1000,height:720,nodes:[
      {id:'person',type:'instance',asset:'hero',x:300,y:300},
      {id:'goal',type:'rect',x:destination,y:300,width:80,height:280},
    ],walks:[{actor:'person',to:'goal',gap:70,start:.1,end:.8}]},assets);
    const scene={durationMs:10000,vectorScene:drawing,vectorAssetLibrary:assets} as CanvasStudioScene;
    const a=evaluateVectorPart('person',scene,3000).dx,b=evaluateVectorPart('person',scene,4000).dx,c=evaluateVectorPart('person',scene,5000).dx;
    assert.ok(Math.abs(b-a)>10);assert.ok(Math.abs((b-a)-(c-b))<1e-7,'constant central travel speed');
    assert.equal(evaluateVectorPart('person',scene,8500).dx,evaluateVectorPart('person',scene,10000).dx);
    assert.equal(evaluateVectorPart('person/upper-body',scene,8500).rotation,0);
    assert.equal(evaluateVectorPart('person/upper-body',scene,4000).scaleY,1);
  }
});
test('selected horror recipe enforces ink on NEW descriptors, while other recipes are unchanged',()=>{
  const raw=JSON.stringify({vectorAssets:{hero:{rig:'simple-puppet',outfit:'tunic'},approved:{rig:'simple-puppet',finish:'clean'},animal:{rig:'simple-pig'}},
    vectorStages:{village:{template:'illustrated-place',place:'village',cast:{person:'hero'}},custom:{width:200,height:200,nodes:[]}}});
  assert.equal(applySelectedHorrorFinish(raw,'[vui-ve] truyện vui'),raw);
  const data=JSON.parse(applySelectedHorrorFinish(raw,'[folk-horror] truyện ma'));
  assert.equal(data.vectorAssets.hero.finish,'handdrawn');
  assert.equal(data.vectorAssets.hero.design,'village','new recipe cast uses the approved drawing factory even if the AI omits design');
  assert.equal(data.vectorAssets.approved.finish,'handdrawn','a newly authored clean descriptor cannot override the selected recipe');
  assert.equal(data.vectorAssets.approved.design,'village');
  assert.equal(data.vectorAssets.animal.finish,undefined);
  assert.equal(data.vectorStages.village.finish,'handdrawn');
  assert.equal(data.vectorStages.village.view,'elevated');
  assert.equal(data.vectorStages.custom.finish,undefined);
  assert.equal(JSON.parse(applySelectedHorrorFinish(raw,'[ma-xo] bí ẩn')).vectorAssets.hero.finish,'handdrawn');
});

test('new horror village and market default wide, retain explicit camera view, and ink custom settings',()=>{
  const stages={clean:{template:'illustrated-place',place:'village',finish:'clean'},
    eye:{template:'illustrated-place',place:'village',view:'eye-level'},
    market:{template:'illustrated-place',place:'village',setting:'market'},
    original:{width:720,height:1280,nodes:[{id:'approved',type:'rect',width:720,height:1280,fill:'#abc'}]}};
  const upgraded=JSON.parse(applySelectedHorrorFinish(JSON.stringify({vectorStages:stages}),'[folk-horror]'));
  assert.equal(upgraded.vectorStages.clean.view,'elevated');
  assert.equal(upgraded.vectorStages.clean.finish,'handdrawn');
  assert.equal(upgraded.vectorStages.eye.view,'eye-level');
  assert.equal(upgraded.vectorStages.market.view,'elevated');
  assert.equal(upgraded.vectorStages.original.nodes[0].type,'path');
  assert.equal(upgraded.vectorStages.original.nodes[0].width,720);
  assert.equal(upgraded.vectorStages.original.nodes[0].height,1280);
    assert.ok(upgraded.vectorStages.original.nodes.some((n:{id:string})=>n.id==='folk-ink-v3-approved'));
});

test('linked steps follow a sloped road both ways and keep the actual lantern grip through arrival',()=>{
  const assets=normalizeVectorAssets({hero:{...approved,finish:'handdrawn'},lamp:{rig:'lantern'}});
  for(const direction of [-1,1]){
    const drawing=normalizeVectorScene({width:1000,height:720,nodes:[
      {id:'person',type:'instance',asset:'hero',x:400,y:300,width:90,height:140},
      {id:'goal',type:'instance',asset:'hero',x:400+direction*200,y:220,width:90,height:140},
      {id:'lamp',type:'instance',asset:'lamp',width:25,height:42},
    ],walks:[{actor:'person',to:'goal',gap:70,followDepth:true,start:.1,end:.8}],
      carries:[{actor:'person',arm:'r',prop:'lamp',hang:true}]},assets);
    const scene={durationMs:5000,vectorScene:drawing,vectorAssetLibrary:assets} as CanvasStudioScene;
    assert.equal(evaluateVectorPart('person',scene,4000).dy,-80,'arrive at the actual deeper floor');
    let positive=0,negative=0;
    const grip=vectorPropGrip(assets.lamp,drawing.nodes.find(n=>n.id==='lamp'))!;
    for(let time=0;time<=5000;time+=1000/30){
      const body=evaluateVectorPart('person/upper-body',scene,time);
      if(body.rotation>1)positive++;if(body.rotation< -1)negative++;
      const hand=vectorPoint(vectorWorldMatrix('person/hand-r',scene,time,assets),0,0);
      const lamp=vectorPoint(vectorWorldMatrix('lamp',scene,time,assets),grip.x,grip.y);
      assert.ok(Math.hypot(hand.x-lamp.x,hand.y-lamp.y)<1e-7,'grip follows every step, not just the final pose');
      if(time>4000){assert.equal(body.rotation,0);assert.equal(body.dy,0);}
    }
    assert.ok(positive>5&&negative>5,'alternating steps in both directions');
    assert.deepEqual(normalizeVectorScene(drawing,assets),drawing,'saved tracks do not acquire duplicate loops');
  }
});
test('handdrawn finish improves compact illustration without changing identity, anchoring or inventing limbs',()=>{
  const original=vectorPuppetRig(approved),ink=vectorPuppetRig({...approved,finish:'handdrawn'});
  assert.equal(original.width,ink.width);assert.equal(original.height,ink.height);
  for(const id of ['puppet-root','upper-body','head-group','hand-l','hand-r']){
    const a=original.nodes.find(n=>n.id===id)!,b=ink.nodes.find(n=>n.id===id)!;
    for(const key of ['parent','x','y','pivotX','pivotY'] as const)assert.equal(b[key],a[key],id+' '+key);
  }
  assert.ok(ink.nodes.some(n=>n.id==='handdrawn-finish'));
  assert.equal(ink.nodes.find(n=>n.id==='face')?.type,'path','irregular hand-authored face outline');
  assert.equal(original.nodes.find(n=>n.id==='face')?.type,'ellipse','legacy faces must be unchanged');
  assert.ok(ink.nodes.some(n=>n.id==='handdrawn-fabric'));
  assert.ok(!original.nodes.some(n=>n.id==='handdrawn-finish'));
  assert.ok(!ink.nodes.some(n=>/^leg-|^arm-|^knee-|^foot-/.test(n.id)),'no skeletal limbs');
  assert.ok(ink.nodes.length<160);
  assert.throws(()=>vectorPuppetRig({...approved,finish:'unknown'}),/puppet finish/);
});
test('handdrawn travel repeats linked steps while moving, with no detached head or idle loop',()=>{
  const asset=vectorPuppetRig({...approved,finish:'handdrawn'});
  const tracks=vectorPuppetTravelTracks('person',asset,130,{start:0,end:.85});
  const body=tracks.find(t=>t.target==='person/upper-body')!,head=tracks.find(t=>t.target==='person/head-group')!;
  assert.equal(body.frames[0]!.rotation,0);assert.equal(body.frames.at(-1)!.rotation,0);
  assert.equal(head.frames.at(-1)!.rotation,0);
  const peaks=body.frames.filter(f=>Math.abs(f.rotation??0)>2);
  assert.ok(peaks.length>=4,'both left and right poses repeat throughout real travel');
  assert.ok(peaks.some(f=>f.rotation!>0)&&peaks.some(f=>f.rotation!<0));
  assert.ok(peaks.every(f=>f.dy!<0),'small lift on each alternating step');
  assert.ok(body.frames.every(f=>Math.abs(f.rotation??0)<=2.8&&f.scaleY===undefined),'no rubber-body stretch');
  assert.ok(head.frames.every(f=>f.rotation===0&&f.dy===undefined),'head inherits the linked silhouette');
  assert.equal(body.frames.at(-1)!.dy,0,'land on the destination surface');
  assert.deepEqual(vectorPuppetTravelTracks('person',asset,130,{start:0,end:1},true).flatMap(t=>t.frames),
    [{t:0,rotation:0,dy:0},{t:0,rotation:0}],'a held arrival never keeps stepping');
  assert.ok(vectorPuppetTravelTracks('person',asset,1000,{start:0,end:1}).every(t=>t.frames.length<=32));
  const clean=vectorPuppetTravelTracks('person',vectorPuppetRig(approved),130,{start:0,end:.85});
  assert.ok(clean[0]!.frames.length>7,'old motion unaffected');
});
for(const place of ['village','forest','waterside','street','corridor'] as const){
  test('storybook ink stage '+place+' changes authored asset lines, not the actual place or cast',()=>{
    const clean=illustratedPlace({place,light:'dusk',seed:11});
    const enhanced=illustratedPlace({place,light:'dusk',seed:11,finish:'handdrawn'});
    assert.ok(enhanced.stage.nodes.length>clean.stage.nodes.length);
    assert.notEqual(enhanced.stage.nodes.find(n=>n.id==='paint-sky')?.fill,clean.stage.nodes.find(n=>n.id==='paint-sky')?.fill,'reference-inspired colour is opt-in');
    assert.ok(enhanced.stage.nodes.length<160);
    assert.equal(enhanced.stage.nodes.find(n=>n.id==='person')?.x,clean.stage.nodes.find(n=>n.id==='person')?.x);
    assert.equal(enhanced.stage.ground.y,clean.stage.ground.y);
    assert.deepEqual(enhanced,illustratedPlace({place,light:'dusk',seed:11,finish:'handdrawn'}));
  });
}
test('market dressing is optional, non-repeated, and cannot turn a forest into a generic village',()=>{
  const quiet=illustratedPlace({place:'village',finish:'handdrawn'},{width:1280,height:720});
  const market=illustratedPlace({place:'village',finish:'handdrawn',setting:'market',view:'eye-level'},{width:1280,height:720});
  assert.equal(quiet.stage.nodes.some(n=>n.id==='market-stall'),false);
  assert.ok(market.stage.nodes.some(n=>n.id==='market-stall-awning'));
  assert.ok(market.stage.nodes.some(n=>n.id==='market-sign-board'));
  assert.ok(market.stage.nodes.some(n=>n.id==='market-thatch-roof'),'extra straw stall must have its own roof silhouette');
  assert.equal(market.stage.nodes.find(n=>n.id==='house-mid-window')?.type,'path','hand-drawn house openings');
  assert.equal(quiet.stage.nodes.find(n=>n.id==='house-mid-window')?.type,'path','variant does not replace location');
  assert.ok(market.stage.nodes.some(n=>n.id==='handdrawn-distant-pines'),'far distance has its own natural silhouette');
  assert.equal(market.stage.nodes.find(n=>n.id==='village-street')?.d,quiet.stage.nodes.find(n=>n.id==='village-street')?.d,
    'a market changes props without relocating the same village road');
  const clean=illustratedPlace({place:'village'},{width:1280,height:720});
  assert.notEqual(market.stage.nodes.find(n=>n.id==='village-street')?.d,clean.stage.nodes.find(n=>n.id==='village-street')?.d,
    'hand-ink path should be organic, while legacy clean scene stays unchanged');
  assert.ok(market.stage.nodes.length<=159,'room for a camera');
  assert.equal(market.stage.nodes.find(n=>n.id==='person')?.x,quiet.stage.nodes.find(n=>n.id==='person')?.x);
  assert.throws(()=>illustratedPlace({place:'forest',setting:'market'}),/market setting/);
});
test('hand-ink compact character shows facial shock without generating extra limbs',()=>{
  const project=parseVectorPlan(JSON.stringify({vectorAssets:{hero:{...approved,finish:'handdrawn'}},
    vectorStages:{scene:{template:'illustrated-place',place:'village',finish:'handdrawn',cast:{person:'hero'}}},
    scenes:[{durationMs:4000,narration:'Nghe tiếng động, cô khựng lại.',vectorScene:{stage:'scene',
      nodes:[{id:'noise-source',type:'group',x:600,y:900}],
      reactions:[{actor:'person',kind:'startle',toward:'noise-source',start:.12,end:.56}]}}]}),
    'Horror reaction in place',{width:720,height:1280},4);
  const tracks=project.scenes[0]!.vectorScene!.tracks;
  const brow=tracks.find(t=>t.target==='person/brow-l');
  const mouth=tracks.find(t=>t.target==='person/mouth');
  assert.ok(brow,'eyebrow reaction communicates fear');
  assert.ok(mouth);
  assert.ok((mouth!.frames[1]?.scaleY??1)>3,'visible open mouth at the action accent');
  assert.ok((mouth!.frames[1]?.scaleX??1)>2,'readable wider shocked mouth at mobile size');
  assert.ok((tracks.find(t=>t.target==='person/eyes')?.frames[1]?.scaleY??1)>1.2,'wide eyes convey surprise');
  assert.ok((mouth!.frames.at(-1)?.scaleY??1)>1.8,'held fearful expression');
  assert.equal(tracks.some(t=>/person\/(?:arm|knee|leg|foot)-/.test(t.target)),false);
});
test('high angle village keeps the illustrated finish with a bounded node count',()=>{
  const scene=illustratedPlace({place:'village',view:'elevated',finish:'handdrawn'},{width:1280,height:720});
  assert.ok(scene.stage.nodes.some(n=>n.id==='house-mid-handdrawn-planks'));
  assert.ok(scene.stage.nodes.length<160);
});
test('compilation binds approved handdrawn actor and produces physical root travel, without new arm-leg nodes',()=>{
  const project=parseVectorPlan(JSON.stringify({vectorAssets:{hero:{...approved,finish:'handdrawn'}},
    vectorStages:{yard:{template:'illustrated-place',place:'village',finish:'handdrawn',light:'dusk',seed:12,cast:{person:'hero'}}},
    scenes:[{durationMs:5000,narration:'Cô gái bước lại gần ngôi nhà.',vectorScene:{stage:'yard',
      nodes:[{id:'destination',type:'group',x:600,y:980,groundAnchor:{x:0,y:0}}],
      walks:[{actor:'person',to:'destination',gap:55,start:.04,end:.65}]}}]}),'A new small horror story',{width:720,height:1280},5);
  const s=project.scenes[0]!,scene=s.vectorScene!;
  assert.equal(scene.nodes.find(n=>n.id==='person')?.asset,'hero');
  const root=scene.tracks.find(t=>t.target==='person'&&t.frames.some(f=>f.dx!==undefined))!;
  assert.ok(root,'real travel');
  assert.ok(root.frames[1]!.dx!==root.frames[0]!.dx,'travel begins without a long frozen anticipation');
  assert.ok(root.frames[2]!.dx!==root.frames[3]!.dx,'travel settles without an early frozen plateau');
  assert.equal(evaluateVectorPart('person',s,4900).dx,evaluateVectorPart('person',s,5000).dx,'holds after arrival');
  assert.ok(scene.tracks.some(t=>t.target==='person/head-group'));
  assert.ok(!project.vectorAssets!.hero!.nodes.some(n=>n.id==='leg-l'));
});
