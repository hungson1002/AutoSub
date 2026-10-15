import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import sharp from 'sharp';
import {VectorSceneFrame} from './VectorSceneFrame';
import {approvedFolkSourceHash,approvedFolkWomanSourceHash} from '../../shared/canvasVectorApprovedArt';
import {APPROVED_FOLK_STYLE,handInkDrawing} from '../../shared/canvasVectorInk';
import {lockFolkInkAsset} from '../../shared/canvasVectorStyleLock';
import {createCanvasProject} from '../../shared/canvasAnimationStudio';
import {normalizeVectorAssets,normalizeVectorScene,evaluateVectorPart,compileVectorProject} from '../../shared/canvasVectorScene';
import {puppetHandOpacity,puppetMouthState,vectorPuppetFearTracks} from '../../shared/canvasVectorPuppet';
import {vectorWorldMatrix,vectorPoint} from '../../shared/canvasVectorTransform';
import {readableVectorNightAssets} from '../../shared/canvasVectorLight';

// tsx's standalone test runner uses the classic JSX runtime for this renderer.
(globalThis as unknown as {React:typeof React}).React=React;

test('approved no-hat variants remove cap and tie geometry in both views without changing the face',()=>{
  const make=(extra:Record<string,unknown>)=>normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',...extra})}).hero!;
  const base=make({});
  for(const hair of ['short','side-part','bun','braid','double-bun','long','bob','tied','wavy','cropped']){
    const a=make({headwear:'none',hair,facialHair:'none'});
    assert.equal(a.nodes.some(n=>n.parent==='headwear'),false,'no hat must have no cap paint: '+hair);
    assert.equal(a.nodes.some(n=>n.id==='rear-head-art-3'),false,'rear view must not retain a cap: '+hair);
    assert.notEqual(a.nodes.find(n=>n.id==='hair-back-ink-0')!.d,base.nodes.find(n=>n.id==='hair-back-ink-0')!.d,'remove the headwrap tie');
    assert.deepEqual(a.nodes.filter(n=>/^face|^eye-|^ear-/.test(n.id)),base.nodes.filter(n=>/^face|^eye-|^ear-/.test(n.id)),'preserve approved face, pupils and ears');
    assert.deepEqual(normalizeVectorAssets({hero:a}).hero,a,'saved variants remain stable');
  }
  const bun=make({headwear:'none',hair:'bun'}),short=make({headwear:'none',hair:'short'});
  assert.ok(bun.nodes.some(n=>n.id==='approved-bun-l'));
  assert.ok(bun.nodes.some(n=>n.id==='rear-approved-bun-l'));
  assert.ok(!short.nodes.some(n=>n.id==='approved-bun-l'));
  assert.notEqual(make({headwear:'none',hair:'side-part'}).nodes.find(n=>n.id==='approved-hair-fringe')!.d,
    make({headwear:'none',hair:'wavy'}).nodes.find(n=>n.id==='approved-hair-fringe')!.d);
});

test('skin stays on the approved model sheet unless an exact native swatch is selected',()=>{
  const make=(skin:string)=>normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',palette:{skin}})}).hero!;
  assert.equal(make('#d1b89d').nodes.find(n=>n.id==='face-ink-0')!.fill,'#e7bfa3');
  assert.equal(make('#C79B78').nodes.find(n=>n.id==='face-ink-0')!.fill,'#c79b78');
});

test('new character variants have no repeated cheek mark and retained artwork is not rewritten',async()=>{
  const source=JSON.parse(await fs.readFile(new URL('../../shared/assets/folk-approved/character.json',import.meta.url),'utf8')).drawing;
  const saved=structuredClone(source);
  assert.equal(source.nodes.filter((n:{parent?:string})=>n.parent==='age-lines').length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeVectorAssets({retained:source}).retained)),saved,'existing expanded artwork stays intact');
  for(const age of ['child','adult','elder'])for(const gender of ['male','female'])for(const expression of ['neutral','worried']){
    const assets=normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',age,gender,expression})});
    assert.ok(!assets.hero!.nodes.some(n=>n.parent==='age-lines'),'no fixed fold on '+[age,gender,expression].join('/'));
    const scene={...createCanvasProject().scenes[0]!,durationMs:3000,narration:'',vectorAssetLibrary:assets,
      vectorScene:normalizeVectorScene({width:250,height:340,nodes:[{id:'hero',type:'instance',asset:'hero',x:35,y:20}]},assets)};
    const html=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene,timeMs:700,width:250,height:340}));
    const {data,info}=await sharp(Buffer.from(html.match(/<svg.*<\/svg>/)![0])).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    // The female sheet has a lower fringe; sample her cheek below it.
    const [cx,cy]=gender==='female'&&age!=='child'?[50,65]:[59,30];
    const at=vectorPoint(vectorWorldMatrix('hero/head-group',scene,700),cx!,cy!),offset=(Math.round(at.y)*info.width+Math.round(at.x))*info.channels;
    const skin=assets.hero!.nodes.find(n=>n.id==='face-ink-0')!.fill!;
    assert.deepEqual([...data.subarray(offset,offset+4)],[1,3,5].map(i=>parseInt(skin.slice(i,i+2),16)).concat(255),'cheek is skin, not an ink mark');
  }
  assert.deepEqual(source,saved,'factory must not edit the source asset');
});

test('native fringe has no transparent hole above the approved forehead and hats have real silhouettes',async()=>{
  const assets=normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',headwear:'none',hair:'side-part'})});
  const scene={...createCanvasProject().scenes[0]!,durationMs:3000,narration:'',vectorAssetLibrary:assets,
    vectorScene:normalizeVectorScene({width:250,height:340,nodes:[{id:'bg',type:'rect',width:250,height:340,fill:'#ffffff'},
      {id:'hero',type:'instance',asset:'hero',x:35,y:20}]},assets)};
  const html=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene,timeMs:700,width:250,height:340}));
  const {data,info}=await sharp(Buffer.from(html.match(/<svg.*<\/svg>/)![0])).removeAlpha().raw().toBuffer({resolveWithObject:true});
  const at=vectorPoint(vectorWorldMatrix('hero/head-group',scene,700),20,-29),offset=(Math.round(at.y)*info.width+Math.round(at.x))*info.channels;
  assert.ok(data[offset]!<80&&data[offset+1]!<80&&data[offset+2]!<80,'fringe must cover the gap above the forehead');
  for(const headwear of ['headscarf','conical']){
    const a=normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',headwear})}).hero!;
    assert.ok(!a.nodes.some(n=>n.id==='headwear-ink-0'));
    const front=a.nodes.find(n=>n.id==='approved-'+headwear)!,rear=a.nodes.find(n=>n.id==='rear-approved-'+headwear)!;
    if(headwear==='conical')assert.equal(front.d,rear.d);
    else assert.notEqual(front.d,rear.d,'the rear scarf has a smooth back hem, not the front forehead cutout');
    assert.ok(a.nodes.indexOf(rear)>a.nodes.findIndex(n=>n.id==='rear-head-art-2'),'hat stays in front of rear hair');
  }
  const bald=normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',headwear:'none',hair:'none'})}).hero!;
  assert.equal(bald.nodes.find(n=>n.id==='hair')!.opacity,0);
  assert.equal(bald.nodes.find(n=>n.id==='rear-head-art-1')!.fill,'#e7bfa3');
  assert.match(bald.nodes.find(n=>n.id==='face-ink-0')!.d!,/C 76/,'keep the accepted jaw contour');
});

test('actual SVG renderer preserves the approved model sheet, including ink, cap folds and head position',async()=>{
  const source=await fs.readFile(new URL('../../shared/assets/folk-approved/character.svg',import.meta.url),'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'),approvedFolkSourceHash);
  assert.equal(approvedFolkSourceHash,'30aefbf78cc933e2ceb775ca7f29e1f0e8534277b01a94144aa18b733bd9c458');
  const scale=280/345,offset=90-100*scale;
  for(const expression of ['neutral','worried']){
    const assets=normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',expression})});
    const scene={...createCanvasProject().scenes[0]!,id:'comparison',durationMs:3000,narration:'',vectorAssetLibrary:assets,
      vectorScene:{width:195,height:355,nodes:[{id:'bg',type:'rect' as const,width:195,height:355,fill:'#b0b596'},
        {id:'hero',type:'instance' as const,asset:'hero',x:-offset/scale,y:0,width:180/scale,height:280/scale}],tracks:[]}};
    const html=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene,timeMs:700,width:195,height:355}));
    const actual=html.match(/<svg.*<\/svg>/)![0];
    const original=expression==='worried'?source:await fs.readFile(new URL('../../shared/assets/folk-approved/character-neutral.svg',import.meta.url),'utf8');
    // Only the cheek fold is intentionally removed from new characters.
    const cheekPaths=original.match(/<path\b[^>]*(?:id="cheek-fold"|d="M165\.9 117\.46)[^>]*\/>/g)!;
    assert.equal(cheekPaths.length,2,'the source has a centerline and an expanded ink fold');
    const expected=cheekPaths.reduce((svg,path)=>svg.replace(path,''),original).replace(/<g id="bucket"[\s\S]*?<\/g>/,'').replace(/(<svg[^>]*>)/,'$1<rect width="195" height="355" fill="#b0b596"/>');
    const a=await sharp(Buffer.from(expected)).resize(390,710).removeAlpha().raw().toBuffer();
    const b=await sharp(Buffer.from(actual)).resize(390,710).removeAlpha().raw().toBuffer();
    assert.equal(a.length,b.length);let difference=0;
    for(let i=0;i<a.length;i++)difference+=Math.abs(a[i]!-b[i]!);
    assert.ok(difference/a.length<.2,`${expression}: source-to-render difference ${difference/a.length}; contour compaction may differ only below a pixel`);
  }
});

test('woman SVG study and the production character renderer use the same face, lashes, bun and skirt',async()=>{
  const scale=280/345,offset=90-100*scale;
  for(const expression of ['neutral','worried']){
    const name=expression==='worried'?'character.svg':'character-neutral.svg';
    const source=await fs.readFile(new URL('../../shared/assets/folk-approved/woman/'+name,import.meta.url),'utf8');
    if(expression==='worried')assert.equal(createHash('sha256').update(source).digest('hex'),approvedFolkWomanSourceHash);
    const assets=normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',gender:'female',expression})});
    const scene={...createCanvasProject().scenes[0]!,durationMs:3000,narration:'',vectorAssetLibrary:assets,
      vectorScene:{width:195,height:355,nodes:[{id:'bg',type:'rect' as const,width:195,height:355,fill:'#c2af83'},{id:'hero',type:'instance' as const,asset:'hero',x:-offset/scale,y:0,width:180/scale,height:280/scale}],tracks:[]}};
    const html=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene,timeMs:700,width:195,height:355}));
    const a=await sharp(Buffer.from(source)).resize(390,710).flatten({background:'#c2af83'}).raw().toBuffer();
    const b=await sharp(Buffer.from(html.match(/<svg.*<\/svg>/)![0])).resize(390,710).flatten({background:'#c2af83'}).raw().toBuffer();
    assert.equal(a.length,b.length);let difference=0;for(let i=0;i<a.length;i++)difference+=Math.abs(a[i]!-b[i]!);
    assert.ok(difference/a.length<.2,expression+' source-to-tool mean difference: '+difference/a.length);
    assert.ok(assets.hero!.nodes.some(n=>n.id==='eyelashes'));
    assert.equal(assets.hero!.nodes.some(n=>n.id==='approved-bun-l'),false,'do not attach the old side bun to the reference top bun');
    assert.ok(assets.hero!.nodes.some(n=>n.parent==='rear-costume'&&n.fill==='#28272d'),'turning away retains the dark skirt');
    const by=(id:string)=>assets.hero!.nodes.find(n=>n.id===id)!;
    assert.equal(by('blink').pivotY,by('eye-l').y,'paired blink closes around the authored eye line');
    assert.equal(by('mouth').y,65,'dialogue uses the new sheet mouth anchor');
  }
  const glasses=normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',gender:'female',glasses:true})}).hero!;
  for(const [i,side] of ['l','r'].entries()){
    const lens=glasses.nodes.find(n=>n.id==='glasses-'+i)!,eye=glasses.nodes.find(n=>n.id==='eye-'+side)!;
    assert.deepEqual([lens.x,lens.y],[eye.x,eye.y],'glasses follow the selected model, not the old male eye coordinates');
  }
});

test('model descriptions cannot redraw approved anatomy and repeated normalization preserves saved artwork',()=>{
  const make=(extra:Record<string,unknown>)=>normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',...extra})}).hero!;
  const base=make({}),changed=make({design:'legacy',finish:'clean',faceShape:'long',eyeStyle:'giant',palette:{ink:'#ff00ff'}});
  assert.deepEqual(changed,base);assert.deepEqual(handInkDrawing(base),base);
  assert.deepEqual(readableVectorNightAssets({hero:base},'kinh dị ban đêm').hero,base,'night finishing must not lift black ink contours to gray');
  assert.deepEqual(normalizeVectorAssets({hero:JSON.parse(JSON.stringify(base))}).hero,base);
  assert.ok(base.nodes.some(n=>n.id===APPROVED_FOLK_STYLE));
  assert.ok(!base.nodes.some(n=>n.id==='bucket'||/^(arm|leg|forearm|knee)-/.test(n.id)));
  const fresh=make({});fresh.nodes.find(n=>n.id==='face-ink-0')!.fill='#ffffff';
  assert.notDeepEqual(fresh,base);assert.deepEqual(make({}),base,'one project cannot mutate the model sheet');
});

test('approved actor keeps grip contact and whole-body mirror direction throughout travel and turns',()=>{
  const assets=normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet'}),lamp:{rig:'lantern'}});
  const drawing=normalizeVectorScene({width:1280,height:720,nodes:[
    {id:'hero',type:'instance',asset:'hero',x:200,y:300,width:180,height:280},
    {id:'lamp',type:'instance',asset:'lamp',width:45,height:75},
    {id:'door',type:'rect',x:900,y:200,width:80,height:380,fill:'#765432'}],
    carries:[{actor:'hero',arm:'r',prop:'lamp',hang:true}],
    walks:[{actor:'hero',to:'door',gap:120,start:0,end:.5}],
    turns:[{actor:'hero',from:'right',to:'left',start:.5,end:.6},{actor:'hero',from:'left',to:'back',start:.7,end:.8}]},assets);
  drawing.tracks.push(...vectorPuppetFearTracks(drawing,assets,[{actor:'hero',start:.1,end:.4,level:'terrified'}],4000));
  const scene={...createCanvasProject().scenes[0]!,durationMs:4000,vectorScene:drawing,vectorAssetLibrary:assets};
  assert.equal(assets.hero!.nodes.find(n=>n.id==='hand-r')!.type,'path');
  for(let ms=0;ms<4000;ms+=1000/30){
    const hand=vectorPoint(vectorWorldMatrix('hero/hand-r',scene,ms),0,0),grip=vectorPoint(vectorWorldMatrix('lamp',scene,ms),30,6);
    assert.ok(Math.hypot(hand.x-grip.x,hand.y-grip.y)<1e-7);
    assert.equal(puppetHandOpacity('hero/hand-r',scene,ms),1);assert.equal(puppetHandOpacity('hero/hand-l',scene,ms),0);
    assert.equal(evaluateVectorPart('hero/eyes',scene,ms).scaleX,1,'fear cannot enlarge the eyes');
  }
  assert.equal(evaluateVectorPart('hero/upper-body',scene,2600).scaleX,-1);
  assert.equal(evaluateVectorPart('hero/rear-head',scene,3600,0).opacity,1);
  assert.equal(evaluateVectorPart('hero/front-head',scene,3600).opacity,0,'the front-paint ancestor hides face, eyes, hair and beard');
  assert.equal(evaluateVectorPart('hero/costume',scene,3600).opacity,0);
});

test('approved expression mouth uses visible ink while idle narration leaves it hidden',()=>{
  const assets=normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet'})});
  const scene={...createCanvasProject().scenes[0]!,durationMs:4000,narration:'Narrator only',vectorAssetLibrary:assets,
    vectorScene:normalizeVectorScene({width:1280,height:720,nodes:[{id:'hero',type:'instance',asset:'hero'}]},assets)};
  scene.vectorScene.tracks.push(...vectorPuppetFearTracks(scene.vectorScene,assets,[{actor:'hero',start:.2,end:.8,level:'terrified'}],4000));
  assert.equal(puppetMouthState('hero/mouth',assets.hero!,scene,0).opacity,0);
  assert.equal(puppetMouthState('hero/mouth',assets.hero!,scene,1800).opacity,1);
  const mouth=evaluateVectorPart('hero/mouth',scene,1800);
  assert.equal(mouth.fill,'#0e0c0b');assert.equal(mouth.d,assets.hero!.nodes.find(n=>n.id==='approved-fear-mouth')!.d);
  const startled=normalizeVectorScene({width:1280,height:720,nodes:[{id:'hero',type:'instance',asset:'hero'},
    {id:'threat',type:'rect',x:500,width:60,height:80,fill:'#765432'}],
    reactions:[{actor:'hero',kind:'startle',toward:'threat',start:0,end:1}]},assets);
  const reaction={...scene,vectorScene:startled};
  for(let ms=0;ms<=4000;ms+=40){
    assert.equal(evaluateVectorPart('hero/eyes',reaction,ms).scaleX,1);
    assert.equal(evaluateVectorPart('hero/eyes',reaction,ms).scaleY,1);
  }
  assert.equal(evaluateVectorPart('hero/mouth',reaction,1800).fill,'#0e0c0b');
});

test('native face and clothing choices change geometry, not only colors, while children stay grounded',()=>{
  const make=(extra:Record<string,unknown>)=>normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',...extra})}).hero!;
  const faces=['round','oval','broad'].map(faceShape=>make({faceShape}));
  assert.equal(new Set(faces.map(a=>a.nodes.find(n=>n.id==='face-ink-0')!.d)).size,3);
  for(const a of faces){
    for(const side of ['l','r'])assert.equal(a.nodes.find(n=>n.id==='eye-'+side)!.rx,faces[0]!.nodes.find(n=>n.id==='eye-'+side)!.rx,'pupils cannot grow with face variants');
    assert.ok(!a.nodes.some(n=>n.parent==='age-lines'));
    assert.deepEqual(normalizeVectorAssets({hero:a}).hero,a);
  }
  const costumes=['tunic','robe','ao-dai','vest','shawl'].map(outfit=>make({outfit}));
  assert.equal(new Set(costumes.map(a=>a.nodes.find(n=>n.id==='torso-ink-0')!.d)).size,5,'each outfit needs a real outer construction');
  for(const a of costumes.slice(1)){
    assert.ok(!a.nodes.some(n=>n.id.startsWith('costume-ink-')),'source tunic buttons/belt cannot leak into another outfit');
    assert.equal(a.nodes.find(n=>n.id==='approved-rear-garment')!.d,a.nodes.find(n=>n.id==='torso-ink-0')!.d,'turning keeps the same garment silhouette');
  }
  const man=make({gender:'male'}),woman=make({gender:'female'}),boy=make({age:'child',gender:'male'}),girl=make({age:'child',gender:'female'});
  assert.notEqual(man.nodes.find(n=>n.id==='torso-ink-0')!.d,woman.nodes.find(n=>n.id==='torso-ink-0')!.d);
  assert.equal(boy.nodes.find(n=>n.id==='torso-ink-0')!.d,girl.nodes.find(n=>n.id==='torso-ink-0')!.d,'children do not inherit the adult chest contour');
  assert.ok(boy.nodes.find(n=>n.id==='head-group')!.y!>man.nodes.find(n=>n.id==='head-group')!.y!,'child is shorter on the same ground');
  assert.ok(Math.abs(boy.nodes.find(n=>n.id==='torso')!.y!+345*boy.nodes.find(n=>n.id==='torso')!.scaleY!-280)<.01);
  assert.notEqual(make({facialHair:'moustache'}).nodes.find(n=>n.id==='approved-moustache')!.d,make({facialHair:'beard'}).nodes.find(n=>n.id==='approved-beard')!.d);
});

test('cast variants retain round authored contours and hats cannot rebuild an elongated jaw',()=>{
  const make=(extra:Record<string,unknown>)=>normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',...extra})}).hero!;
  const base=make({}),coords=(d:string)=>(d.match(/-?\d+(?:\.\d+)?/g)||[]).map(Number);
  for(const faceShape of ['oval','broad']){
    const a=make({faceShape});
    for(const id of ['face-ink-0','face-ink-1']){
      const original=coords(base.nodes.find(n=>n.id===id)!.d!),candidate=coords(a.nodes.find(n=>n.id===id)!.d!);
      assert.equal(candidate.length,original.length,'retain the source filled-ink outline, not a replacement pointed jaw');
      assert.ok(candidate.every((n,i)=>Math.abs(n-original[i]!)<=3.1),'face variations stay within three source pixels');
    }
    for(const id of ['eye-l','eye-r','eye-white-l','eye-white-r','ear-l'])
      assert.deepEqual(a.nodes.find(n=>n.id===id),base.nodes.find(n=>n.id===id),'identity variants cannot misalign eyes/ears');
  }
  for(const gender of ['male','female'])for(const headwear of ['headwrap','headscarf']){
    const bare=make({gender,headwear,hair:'none'}),withHair=make({gender,headwear});
    assert.deepEqual(bare.nodes.filter(n=>n.parent==='face'),withHair.nodes.filter(n=>n.parent==='face'),'hair hidden by a hat cannot reconstruct the face');
    assert.equal(bare.nodes.find(n=>n.id==='rear-head-art-2')!.opacity,0,'back views must not show the front fringe outline');
  }
  const scarf=make({gender:'female',hair:'braid',headwear:'headscarf',palette:{headwear:'#222222'}});
  assert.equal(scarf.nodes.find(n=>n.id==='approved-headscarf')!.fill,'#18171d','chosen dark cloth is not silently replaced by mustard');
  assert.notEqual(scarf.nodes.find(n=>n.id==='rear-approved-headscarf')!.d,scarf.nodes.find(n=>n.id==='approved-headscarf')!.d);
  const tied=make({gender:'female',hair:'tied',headwear:'headwrap'}),bun=make({gender:'female',hair:'bun'});
  assert.notEqual(tied.nodes.find(n=>n.id==='hair-back-ink-0')!.d,bun.nodes.find(n=>n.id==='hair-back-ink-0')!.d,'a tied hairstyle removes the default top bun even under a headwrap');
  assert.ok(tied.nodes.some(n=>n.id==='approved-headwrap'&&n.parent==='headwear'),'a female headwrap must actually exist');
  assert.ok(tied.nodes.some(n=>n.id==='rear-approved-headwrap'),'the chosen wrap persists on the back');
  for(const id of ['approved-wrap-folds','rear-approved-wrap-folds']){
    const folds=tied.nodes.find(n=>n.id===id)!;
    assert.ok(folds?.stroke&&folds.stroke!==tied.nodes.find(n=>n.id==='approved-headwrap')!.fill,'cloth folds distinguish the dark wrap from bare hair');
  }
  const assets={hero:scarf};
  const drawing=normalizeVectorScene({width:300,height:350,nodes:[{id:'hero',type:'instance',asset:'hero',x:40,y:20}],
    turns:[{actor:'hero',from:'front',to:'back',start:0,end:.1}]},assets);
  const scene={...createCanvasProject().scenes[0]!,durationMs:3000,vectorAssetLibrary:assets,vectorScene:drawing};
  assert.equal(evaluateVectorPart('hero/front-head',scene,1000).opacity,0,'hide every front hair/ear/hat together');
  assert.equal(evaluateVectorPart('hero/rear-head',scene,1000).opacity,1);
  assert.ok(drawing.tracks.length<=5,'six-person turns must not exhaust the animation track budget');
  const crowd=normalizeVectorScene({width:1280,height:720,
    nodes:Array.from({length:6},(_,i)=>({id:'person-'+i,type:'instance',asset:'hero',x:i*180,y:200})),
    turns:Array.from({length:6},(_,i)=>({actor:'person-'+i,from:'front',to:'back',start:0,end:.1}))},assets);
  assert.ok(crowd.tracks.length<=80,'a six-person crowd must fit the public generation limit');
});

test('the complete front-paint mask stays hidden after a back turn through a same-room cut',()=>{
  const p=createCanvasProject(),base=p.scenes[0]!;
  p.width=720;p.height=720;p.vectorAssets=normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',gender:'female',hair:'tied',headwear:'headwrap'})});
  p.scenes=[0,1].map(i=>({...base,id:'back-cut-'+i,durationMs:3000,narration:'The villager waits.',dialogue:undefined,
    vectorStageId:'room',vectorDirection:{purpose:'Retain the back view',location:'room',shot:{size:'wide',focus:'hero',include:[]},beats:[],heldProps:[]},
    vectorScene:normalizeVectorScene({width:720,height:720,nodes:[{id:'hero',type:'instance',asset:'hero',x:200,y:300,width:180,height:280}],
      ground:{y:600,targets:[{target:'hero'}]},...(i===0?{turns:[{actor:'hero',from:'front',to:'back',start:0,end:.1}]}:{})},p.vectorAssets!)}));
  const fixed=compileVectorProject(p);
  for(const ms of [0,1000,2999]){
    assert.equal(evaluateVectorPart('hero/rear-head',fixed.scenes[1]!,ms,0).opacity,1);
    assert.equal(evaluateVectorPart('hero/front-head',fixed.scenes[1]!,ms).opacity,0,'a cut must not expose the old face/fringe beneath the back drawing');
  }
  assert.deepEqual(compileVectorProject(fixed),fixed);
});

test('uncovered male hair joins the right temple without covering the authored ear',async()=>{
  const make=(hair:string)=>normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',headwear:'none',hair,facialHair:'none'})});
  for(const hair of ['short','side-part','cropped','wavy','bun','tied']){
    const assets=make(hair),scene={...createCanvasProject().scenes[0]!,durationMs:2000,narration:'',vectorAssetLibrary:assets,
      vectorScene:normalizeVectorScene({width:300,height:350,nodes:[{id:'bg',type:'rect',width:300,height:350,fill:'#ffffff'},
        {id:'hero',type:'instance',asset:'hero',x:35,y:20}]},assets)};
    const svg=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene,timeMs:500,width:300,height:350})).match(/<svg.*<\/svg>/)![0];
    const {data,info}=await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({resolveWithObject:true});
    for(const [x,y] of [[71,0],[20,-29],[-45,-25]]){
      const at=vectorPoint(vectorWorldMatrix('hero/head-group',scene,500),x!,y!),offset=(Math.round(at.y)*info.width+Math.round(at.x))*info.channels;
      assert.ok([...data.subarray(offset,offset+3)].every(n=>n<65),hair+' must cover the forehead/temple with continuous hair');
    }
    const ear=vectorPoint(vectorWorldMatrix('hero/head-group',scene,500),-71,12),offset=(Math.round(ear.y)*info.width+Math.round(ear.x))*info.channels;
    assert.ok(data[offset]!>120,'the hair must leave the visible ear skin attached: '+hair);
    const fringe=assets.hero!.nodes.find(n=>n.id==='approved-hair-fringe')!.d!;
    const top=fringe.slice(0,fringe.indexOf('L 68 17'));
    assert.ok(assets.hero!.nodes.find(n=>n.id==='rear-head-art-1')!.d!.startsWith(top),'the back view retains the same cropped/wavy crown outline');
  }
});

test('narrow eyes and crown tufts supply bounded supporting-character identities in the same model family',()=>{
  const make=(extra:Record<string,unknown>)=>normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',headwear:'none',...extra})}).hero!;
  for(const gender of ['male','female']){
    const round=make({gender}),half=make({gender,eyeShape:'half-lidded'});
    for(const side of ['l','r']){
      const original=round.nodes.find(n=>n.id==='eye-'+side)!,pupil=half.nodes.find(n=>n.id==='eye-'+side)!;
      assert.equal(pupil.x,original.x);assert.equal(pupil.rx,original.rx);assert.equal(pupil.ry,original.ry);
      assert.equal(pupil.y,original.y!+1.5,'center the small pupil in the remaining white');
      assert.ok(half.nodes.some(n=>n.id==='approved-half-eye-'+side));
    }
    assert.deepEqual(normalizeVectorAssets({hero:half}).hero,half,'saved narrow eyes stay unchanged');
  }
  const child=make({age:'child',hair:'tuft'});
  assert.ok(child.nodes.some(n=>n.id==='approved-hair-length'));
  assert.ok(child.nodes.some(n=>n.id==='rear-approved-hair-length'));
  assert.equal(child.nodes.find(n=>n.id==='hair')!.opacity,0,'a crown tuft cannot retain the old full haircut');
  assert.equal(child.nodes.find(n=>n.id==='rear-head-art-1')!.fill,'#e7bfa3');
  assert.throws(()=>make({eyeShape:'giant'}),/eye shape/);
});

test('child skull and conical-hat hair fit the head in both mirrored directions',async()=>{
  for(const config of [{age:'child',hair:'tuft',headwear:'none'},{hair:'short',headwear:'conical'}]){
    const assets=normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',facialHair:'none',...config})});
    for(const left of [false,true]){
      const scene={...createCanvasProject().scenes[0]!,durationMs:2000,narration:'',vectorAssetLibrary:assets,
        vectorScene:normalizeVectorScene({width:300,height:350,nodes:[{id:'bg',type:'rect',width:300,height:350,fill:'#ffffff'},
          {id:'hero',type:'instance',asset:'hero',x:35,y:20}],...(left?{turns:[{actor:'hero',from:'right',to:'left',hold:true}]}:{})},assets)};
      const svg=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene,timeMs:500,width:300,height:350})).match(/<svg.*<\/svg>/)![0];
      const {data,info}=await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({resolveWithObject:true});
      const sample=(x:number,y:number)=>{const p=vectorPoint(vectorWorldMatrix('hero/head-group',scene,500),x,y),at=(Math.round(p.y)*info.width+Math.round(p.x))*info.channels;return [...data.subarray(at,at+3)];};
      if(config.age==='child'){
        for(const p of [[-60,-15],[-50,0],[-8,78]])assert.deepEqual(sample(p[0]!,p[1]!),[231,191,163],'round child skull has no temple dent or extra seam: '+p+' left='+left);
      }else{
        for(const p of [[71,0],[68,8]])assert.ok(sample(p[0]!,p[1]!).every(v=>v<65),'hair meets the same skull below the hat');
        assert.ok(sample(-71,12)[0]!>120,'hat hair leaves the attached ear visible');
      }
      assert.equal(evaluateVectorPart('hero/upper-body',scene,500).scaleX,left?-1:1);
      assert.equal(evaluateVectorPart('hero/front-head',scene,500).opacity,1);
      assert.equal(evaluateVectorPart('hero/rear-head',scene,500,0).opacity,0,'mirroring must not select the rear artwork');
    }
    assert.deepEqual(normalizeVectorAssets(assets),assets,'saved expanded assets remain immutable');
  }
});

test('supporting occupations select distinct shirt, wrapped blouse and apron construction',()=>{
  const variants=['tunic','work-shirt','cross-collar','apron'].map(outfit=>normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',outfit})}).hero!);
  assert.equal(new Set(variants.map(a=>a.nodes.find(n=>n.id==='torso-ink-0')!.d)).size,4);
  for(const [i,detail] of ['approved-work-pocket','approved-cross-knot','approved-apron-bib'].entries()){
    assert.ok(variants[i+1]!.nodes.some(n=>n.id===detail));
    assert.ok(!variants[i+1]!.nodes.some(n=>n.id.startsWith('costume-ink-')),'the source belt/buttons cannot leak into other garments');
    assert.ok(!variants[i+1]!.nodes.some(n=>/^arm-|^leg-/.test(n.id)),'keep the approved limbless cutout');
  }
});

test('female hair variants keep native eyes and connected buns instead of reusing the male cap',()=>{
  const make=(hair:string)=>normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',gender:'female',headwear:'none',hair})}).hero!;
  const base=make('bun'),variants=['wavy','side-part','fringe'].map(make);
  assert.equal(new Set(variants.map(a=>a.nodes.find(n=>n.id==='approved-hair-fringe')!.d)).size,3);
  for(const a of variants)for(const side of ['l','r'])assert.deepEqual(a.nodes.find(n=>n.id==='eye-'+side),base.nodes.find(n=>n.id==='eye-'+side));
  const pair=make('double-bun').nodes.filter(n=>n.id.startsWith('approved-bun-'));
  assert.equal(pair.length,2);for(const n of pair){assert.ok(Math.abs(n.x!)<=50);assert.equal(n.y,-38);assert.equal(n.ry,18);}
  assert.match(make('braid').nodes.find(n=>n.id==='approved-hair-length')!.d!,/146/,'braid extends visibly beyond the neck');
});

test('signature clothing is visible above every native garment and mirrors with its owner',async()=>{
  for(const outfit of ['tunic','robe','ao-dai','vest','shawl','work-shirt','cross-collar','apron'])for(const left of [false,true]){
    const assets=normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',outfit,castRole:'lead',costumeDetail:'piping'})});
    const scene={...createCanvasProject().scenes[0]!,durationMs:2000,narration:'',vectorAssetLibrary:assets,
      vectorScene:normalizeVectorScene({width:300,height:350,nodes:[{id:'bg',type:'rect',width:300,height:350,fill:'#ffffff'},
        {id:'hero',type:'instance',asset:'hero',x:35,y:20}],...(left?{turns:[{actor:'hero',from:'right',to:'left',hold:true}]}:{})},assets)};
    const svg=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene,timeMs:500,width:300,height:350})).match(/<svg.*<\/svg>/)![0];
    const {data,info}=await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const p=vectorPoint(vectorWorldMatrix('hero/costume',scene,500),127,195),at=(Math.round(p.y)*info.width+Math.round(p.x))*info.channels;
    assert.deepEqual([...data.subarray(at,at+3)],[156,120,62],outfit+' signature clasp cannot be hidden under a filled costume');
  }
});

test('bald and tufted back views have a continuous skull and keep clothing behind the head',async()=>{
  for(const age of ['adult','child'])for(const hair of ['none','tuft']){
    const assets=normalizeVectorAssets({hero:lockFolkInkAsset({rig:'simple-puppet',age,hair,headwear:'none'})});
    const scene={...createCanvasProject().scenes[0]!,durationMs:2000,narration:'',vectorAssetLibrary:assets,
      vectorScene:normalizeVectorScene({width:300,height:350,nodes:[{id:'bg',type:'rect',width:300,height:350,fill:'#ffffff'},
        {id:'hero',type:'instance',asset:'hero',x:35,y:20}],turns:[{actor:'hero',from:'front',to:'back',start:0,end:.1}]},assets)};
    const svg=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene,timeMs:1000,width:300,height:350})).match(/<svg.*<\/svg>/)![0];
    const {data,info}=await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({resolveWithObject:true});
    for(const [x,y] of [[-62,0],[-8,78]]){
      const at=vectorPoint(vectorWorldMatrix('hero/head-group',scene,1000),x!,y!),offset=(Math.round(at.y)*info.width+Math.round(at.x))*info.channels;
      assert.deepEqual([...data.subarray(offset,offset+3)],[231,191,163],`${age}/${hair}: uninterrupted skin at the temple and lower skull`);
    }
    const nodes=assets.hero!.nodes;
    assert.ok(nodes.findIndex(n=>n.id==='rear-costume')<nodes.findIndex(n=>n.id==='head-group'),'rear clothes cannot overpaint a shortened child head');
  }
});
