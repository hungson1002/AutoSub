import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {createCanvasProject} from '../../shared/canvasAnimationStudio';
import {compileVectorProject,normalizeVectorScene,normalizeVectorAssets} from '../../shared/canvasVectorScene';

test('pig hind limbs never paint through the trunk in either facing, including rearing poses and old expanded rigs',async()=>{
  const React=await import('react');Object.assign(globalThis,{React});
  const {renderToStaticMarkup}=await import('react-dom/server');
  const {VectorSceneFrame}=await import('../remotion/VectorSceneFrame');
  const {vectorPoint,vectorWorldMatrix}=await import('../../shared/canvasVectorTransform');
  for(const facing of ['left','right'])for(const toes of [2,5])for(const rotation of [0,-35]){
    const p=createCanvasProject();p.width=520;p.height=400;p.vectorAssets=normalizeVectorAssets({pig:{rig:'simple-pig',facing,toes}});
    const rig=p.vectorAssets.pig!;
    // Reproduce the old expanded checkpoint ordering, rather than checking
    // only a fresh factory asset. Pink is a test stencil for hidden anatomy.
    const pose=rig.nodes.splice(rig.nodes.findIndex(n=>n.id==='body-pose'),1)[0]!;rig.nodes.splice(1,0,pose);
    p.scenes=[{...p.scenes[0]!,durationMs:2000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({width:520,height:400,nodes:[
      {id:'sky',type:'rect',width:520,height:400,fill:'#ffffff'},{id:'pig',type:'instance',asset:'pig',x:80,y:80}],
      tracks:[{target:'pig/body-pose',start:0,end:1,frames:[{t:0,rotation}]}],
    },p.vectorAssets)}];
    const fixed=compileVectorProject(p),s=fixed.scenes[0]!;
    assert.deepEqual(compileVectorProject(fixed),fixed);
    for(const n of fixed.vectorAssets!.pig!.nodes)if(/^(thigh|shin)-[fh]r$/.test(n.id))n.fill='#ff00ff';
    const html=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene:s,timeMs:1000,width:520,height:400}));
    const {data,info}=await sharp(Buffer.from(html.match(/<svg[\s\S]*?<\/svg>/)![0])).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const body=vectorWorldMatrix('pig/body',s,1000);let hiddenInk=0,exposedInk=0;
    for(let y=-55;y<=55;y+=2)for(let x=-100;x<=100;x+=2){
      if((x/112)**2+(y/65)**2>.8)continue;
      const point=vectorPoint(body,x,y),at=(Math.round(point.y)*info.width+Math.round(point.x))*info.channels;
      if(data[at]!>240&&data[at+1]!<20&&data[at+2]!>240)hiddenInk++;
    }
    for(let i=0;i<data.length;i+=info.channels)if(data[i]!>240&&data[i+1]!<20&&data[i+2]!>240)exposedInk++;
    assert.equal(hiddenInk,0,'the opaque torso masks the hidden hip/thigh, including mirrored views');
    assert.ok(exposedInk>20,'visible lower far limbs remain drawn; no blanket hiding');
  }
});

test('actual SVG shows only the talking village mouth and respects measured pauses, fear and rear views',async()=>{
  const React=await import('react');Object.assign(globalThis,{React});
  const {renderToStaticMarkup}=await import('react-dom/server');
  const {VectorSceneFrame}=await import('../remotion/VectorSceneFrame');
  const {vectorPoint,vectorWorldMatrix}=await import('../../shared/canvasVectorTransform');
  const p=createCanvasProject();p.width=720;p.height=480;
  p.vectorAssets=normalizeVectorAssets({hero:{rig:'simple-puppet',design:'village',expression:'soft',hair:'bun'},listener:{rig:'simple-puppet',design:'village',hair:'side-part'}});
  for(const rig of Object.values(p.vectorAssets)){
    const mouth=rig.nodes.find(n=>n.id==='mouth')!;mouth.stroke='#ff00ff';mouth.fill='#ff00ff';
  }
  p.scenes=[{...p.scenes[0]!,durationMs:4000,narration:'',objects:[],dialogue:[
    {id:'n',speaker:'Narrator',text:'A quiet crowd.',atMs:0,durationMs:800},
    {id:'s',speaker:'Lan',characterKey:'lan',text:'Hello.',atMs:1000,durationMs:1500,speechWindows:[{startMs:0,endMs:400},{startMs:900,endMs:1300}]},
  ],vectorScene:normalizeVectorScene({width:720,height:480,nodes:[
    {id:'background',type:'rect',width:720,height:480,fill:'#ffffff'},
    {id:'person',type:'instance',asset:'hero',characterKey:'lan',x:70,y:150},{id:'listener',type:'instance',asset:'listener',x:350,y:150}],
    reactions:[{actor:'person',kind:'fear',start:.65,end:.8}],
    turns:[{actor:'person',from:'front',to:'back',start:.82,end:.9}],
  },p.vectorAssets)}];
  const scene=compileVectorProject(p).scenes[0]!;
  for(const timeMs of [200,1200,1600,2100,2900,3900]){
    const html=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene,timeMs,width:p.width,height:p.height}));
    const {data,info}=await sharp(Buffer.from(html.match(/<svg[\s\S]*?<\/svg>/)![0])).removeAlpha().raw().toBuffer({resolveWithObject:true});
    for(const id of ['person','listener']){
      const point=vectorPoint(vectorWorldMatrix(id+'/mouth',scene,timeMs),0,0);let ink=0;
      for(let y=Math.floor(point.y-16);y<=Math.ceil(point.y+16);y++)for(let x=Math.floor(point.x-16);x<=Math.ceil(point.x+16);x++){
        const at=(y*info.width+x)*info.channels;
        if(data[at]!>240&&data[at+1]!<20&&data[at+2]!>240)ink++;
      }
      assert.equal(ink>3,id==='person'&&[1200,2100,2900].includes(timeMs),`${id} at ${timeMs}: only speech or a visible fear expression draws the mouth`);
    }
  }
});

test('actual village SVG has bold dark outer contours on the face and clothing',async()=>{
  const React=await import('react');Object.assign(globalThis,{React});
  const {renderToStaticMarkup}=await import('react-dom/server');
  const {VectorSceneFrame}=await import('../remotion/VectorSceneFrame');
  const {vectorPoint,vectorWorldMatrix}=await import('../../shared/canvasVectorTransform');
  const p=createCanvasProject();p.width=320;p.height=480;
  p.vectorAssets=normalizeVectorAssets({hero:{rig:'simple-puppet',design:'village',gender:'female',hair:'bun'}});
  p.scenes=[{...p.scenes[0]!,durationMs:2000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({width:320,height:480,
    nodes:[{id:'background',type:'rect',width:320,height:480,fill:'#ffffff'},{id:'person',type:'instance',asset:'hero',x:70,y:150}],
  },p.vectorAssets)}];
  const scene=compileVectorProject(p).scenes[0]!,html=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene,timeMs:0,width:320,height:480}));
  const {data,info}=await sharp(Buffer.from(html.match(/<svg[\s\S]*?<\/svg>/)![0])).removeAlpha().raw().toBuffer({resolveWithObject:true});
  for(const [part,x1,x2,y] of [['face',40,70,26],['torso',40,65,195]] as const){
    const m=vectorWorldMatrix('person/'+part,scene,0),a=vectorPoint(m,x1,y),b=vectorPoint(m,x2,y);
    let run=0,longest=0;
    for(let x=Math.floor(a.x);x<=Math.ceil(b.x);x++){
      const at=(Math.round(a.y)*info.width+x)*info.channels;
      const dark=[...data.subarray(at,at+3)].every(v=>v<45);
      run=dark?run+1:0;longest=Math.max(longest,run);
    }
    assert.ok(longest>=3,`${part}: bold black outline must survive rasterization, found ${longest} pixels`);
  }
});

test('village cast SVG paints small black dots inside both white eyes, including mirrored and child views',async()=>{
  const React=await import('react');Object.assign(globalThis,{React});
  const {renderToStaticMarkup}=await import('react-dom/server');
  const {VectorSceneFrame}=await import('../remotion/VectorSceneFrame');
  const {vectorPoint,vectorWorldMatrix}=await import('../../shared/canvasVectorTransform');
  for(const age of ['adult','child'])for(const facing of ['right','left'])for(const hair of ['bun','bob','tied']){
    const p=createCanvasProject();p.width=320;p.height=480;
    p.vectorAssets=normalizeVectorAssets({hero:{rig:'simple-puppet',design:'village',age,gender:'female',hair}});
    p.scenes=[{...p.scenes[0]!,durationMs:2000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({width:320,height:480,
      nodes:[{id:'sky',type:'rect',width:320,height:480,fill:'#ffffff'},{id:'person',type:'instance',asset:'hero',x:70,y:150}],
      turns:[{actor:'person',to:facing,hold:true}],
    },p.vectorAssets)}];
    const scene=compileVectorProject(p).scenes[0]!,html=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene,timeMs:0,width:320,height:480}));
    const {data,info}=await sharp(Buffer.from(html.match(/<svg[\s\S]*?<\/svg>/)![0])).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const pixel=(x:number,y:number)=>{const at=(Math.floor(y)*info.width+Math.floor(x))*info.channels;return [...data.subarray(at,at+3)];};
    for(const side of ['l','r']){
      const point=vectorPoint(vectorWorldMatrix('person/eye-'+side,scene,0),0,0);
      assert.ok(pixel(point.x,point.y).every(v=>v<75),`${age}/${facing}: pupil center is black`);
      assert.ok(pixel(point.x+4,point.y).every(v=>v>220),`${age}/${facing}/${hair}: white surrounds the tiny dot and back hair stays behind the face`);
    }
  }
});

test('fear sweat renders on the temple, follows facing and disappears when settled or behind a rear head',async()=>{
  const React=await import('react');Object.assign(globalThis,{React});
  const {renderToStaticMarkup}=await import('react-dom/server');
  const {VectorSceneFrame}=await import('../remotion/VectorSceneFrame');
  for(const design of ['legacy','village'])for(const view of ['front','left','back'])for(const timeMs of [100,1100,2700]){
    const p=createCanvasProject();p.width=320;p.height=480;
    p.vectorAssets=normalizeVectorAssets({hero:{rig:'simple-puppet',design,finish:'handdrawn',hair:'side-part'}});
    for(const n of p.vectorAssets.hero!.nodes)if(n.id.startsWith('sweat-drop-'))n.fill='#ff00ff';
    p.scenes=[{...p.scenes[0]!,durationMs:3000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({width:320,height:480,
      nodes:[{id:'sky',type:'rect',width:320,height:480,fill:'#ffffff'},{id:'person',type:'instance',asset:'hero',x:70,y:150}],
      turns:[{actor:'person',to:view,hold:true}],reactions:[{actor:'person',kind:'fear',level:'terrified',start:.2,end:.44}],
    },p.vectorAssets)}];
    // Native command timing above is normalized: inspect the same phase in a 3s shot.
    const s=compileVectorProject(p).scenes[0]!,html=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene:s,timeMs,width:320,height:480}));
    const {data,info}=await sharp(Buffer.from(html.match(/<svg[\s\S]*?<\/svg>/)![0])).removeAlpha().raw().toBuffer({resolveWithObject:true});
    let magenta=0;
    for(let i=0;i<data.length;i+=info.channels)if(data[i]!>240&&data[i+1]!<20&&data[i+2]!>240)magenta++;
    assert.equal(magenta>10,timeMs===1100&&view!=='back',`${view} at ${timeMs}: sweat stays on the visible face only`);
  }
});

test('actual SVG hides unused puppet hands, reveals one carrying hand and preserves the lantern',async()=>{
  const React=await import('react');Object.assign(globalThis,{React});
  const {renderToStaticMarkup}=await import('react-dom/server');
  const {VectorSceneFrame}=await import('../remotion/VectorSceneFrame');
  const {vectorPoint,vectorWorldMatrix}=await import('../../shared/canvasVectorTransform');
  for(const outfit of ['robe','tunic','ao-dai','vest','shawl'])for(const mode of ['idle','carry','gesture','finished']){
    const p=createCanvasProject();p.width=320;p.height=480;
    p.vectorAssets=normalizeVectorAssets({person:{rig:'simple-puppet',outfit,hair:'side-part'},lamp:{rig:'lantern'}});
    for(const n of p.vectorAssets.person!.nodes)if(/^hand-[lr]$/.test(n.id))n.fill='#ff0000';
    p.scenes=[{...p.scenes[0]!,durationMs:2000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({width:320,height:480,
      nodes:[{id:'background',type:'rect',width:320,height:480,fill:'#dad1b7'},
        {id:'person',type:'instance',asset:'person',x:70,y:150},
        ...(mode==='carry'?[{id:'lamp',type:'instance',asset:'lamp',width:45,height:75}]:[])],
      ...(mode==='carry'?{carries:[{actor:'person',arm:'r',prop:'lamp',hang:true}]}:{}),
      tracks:mode==='gesture'||mode==='finished'?[{target:'person/hand-l',start:.2,end:.8,frames:[{t:0,dy:0},{t:.5,dy:-14},{t:1,dy:0}]}]:[],
    },p.vectorAssets)}];
    const s=compileVectorProject(p).scenes[0]!,timeMs=mode==='finished'?1900:1000;
    const html=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene:s,timeMs,width:320,height:480}));
    const {data,info}=await sharp(Buffer.from(html.match(/<svg[\s\S]*?<\/svg>/)![0])).removeAlpha().raw().toBuffer({resolveWithObject:true});
    for(const side of ['l','r']){
      const point=vectorPoint(vectorWorldMatrix('person/hand-'+side,s,timeMs),0,0);
      const at=(Math.round(point.y)*info.width+Math.round(point.x))*info.channels;
      const red=data[at]!>240&&data[at+1]!<20&&data[at+2]!<20;
      assert.equal(red,mode==='carry'&&side==='r'||mode==='gesture'&&side==='l',`${outfit}/${mode}: only the required ${side} dot may be drawn`);
    }
    if(mode==='carry'){
      let gold=0;
      for(let y=350;y<415;y++)for(let x=180;x<220;x++){
        const at=(y*info.width+x)*info.channels;
        if(data[at]!>180&&data[at+1]!>130&&data[at+2]!<170)gold++;
      }
      assert.ok(gold>50,'hiding the unused hand must preserve the attached lantern hardware and flame');
    }
  }
});

test('left/right exports are horizontal mirrors of the same character and carried lamp',async()=>{
  const React=await import('react');Object.assign(globalThis,{React});
  const {renderToStaticMarkup}=await import('react-dom/server');
  const {VectorSceneFrame}=await import('../remotion/VectorSceneFrame');
  for(const design of ['legacy','village']){
  const frames:Buffer[]=[];
  for(const view of ['right','left']){
    const p=createCanvasProject();p.width=320;p.height=480;
    p.vectorAssets=normalizeVectorAssets({person:{rig:'simple-puppet',design,finish:'handdrawn',hair:'side-part'},lamp:{rig:'lantern'}});
    p.scenes=[{...p.scenes[0]!,durationMs:2000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({width:320,height:480,
      nodes:[{id:'sky',type:'rect',width:320,height:480,fill:'#ffffff'},{id:'person',type:'instance',asset:'person',x:70,y:150},
        {id:'lamp',type:'instance',asset:'lamp',width:45,height:75}],
      carries:[{actor:'person',arm:'r',prop:'lamp',hang:true}],turns:[{actor:'person',to:view,hold:true}],
    },p.vectorAssets)}];
    const s=compileVectorProject(p).scenes[0]!,html=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene:s,timeMs:1000,width:320,height:480}));
    let raster=sharp(Buffer.from(html.match(/<svg[\s\S]*?<\/svg>/)![0])).removeAlpha();
    if(view==='left')raster=raster.flop();
    frames.push(await raster.raw().toBuffer());
  }
  const error=frames[0]!.reduce((sum,value,i)=>sum+Math.abs(value-frames[1]![i]!),0)/(frames[0]!.length*255);
  assert.ok(error<.002,`${design}: same original silhouette, face, hair and held lamp mirrored; pixel error ${error}`);
  }
});

test('native collars meet the short neck without a shoulder stroke or decorative line crossing it',async()=>{
  const React=await import('react');Object.assign(globalThis,{React});
  const {renderToStaticMarkup}=await import('react-dom/server');
  const {VectorSceneFrame}=await import('../remotion/VectorSceneFrame');
  for(const outfit of ['tunic','ao-dai'])for(const view of ['left','right']){
    const p=createCanvasProject();p.width=320;p.height=480;
    const skin='#ead2b3';
    p.vectorAssets=normalizeVectorAssets({person:{rig:'simple-puppet',finish:'handdrawn',outfit,hair:'bun',palette:{skin}}});
    assert.equal(p.vectorAssets.person!.nodes.some(n=>n.id==='handdrawn-collar-thread'),false);
    p.scenes=[{...p.scenes[0]!,durationMs:2000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({width:320,height:480,
      nodes:[{id:'sky',type:'rect',width:320,height:480,fill:'#ffffff'},{id:'person',type:'instance',asset:'person',x:70,y:150}],
      turns:[{actor:'person',to:view,hold:true}],
    },p.vectorAssets)}];
    const s=compileVectorProject(p).scenes[0]!,html=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene:s,timeMs:1000,width:320,height:480}));
    const {data,info}=await sharp(Buffer.from(html.match(/<svg[\s\S]*?<\/svg>/)![0])).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const at=(306*info.width+160)*info.channels;
    assert.deepEqual([...data.subarray(at,at+3)],[234,210,179],`${outfit}/${view}: the shoulder outline must go around the visible neck, not across it`);
    // On the tunic, the collar now occupies the band directly under the neck;
    // the previous misplaced collar started down at y=160.7 on the chest.
    if(outfit==='tunic'){
      const edge=(309*info.width+160)*info.channels;
      assert.notDeepEqual([...data.subarray(edge,edge+3)],[234,210,179],'standing collar touches the base of the neck');
    }
    assert.deepEqual(compileVectorProject(compileVectorProject(p)),compileVectorProject(p));
  }
});

test('rear-facing puppets occlude hands and held props with their body, while exposed parts stay visible',async()=>{
  const React=await import('react');Object.assign(globalThis,{React});
  const {renderToStaticMarkup}=await import('react-dom/server');
  const {VectorSceneFrame}=await import('../remotion/VectorSceneFrame');
  const {vectorPoint,vectorWorldMatrix}=await import('../../shared/canvasVectorTransform');
  for(const design of ['legacy','village'])for(const facing of ['front','back'])for(const extended of [false,true]){
    const assets=normalizeVectorAssets({person:{rig:'simple-puppet',design,finish:'handdrawn',hair:'short',palette:{shirt:'#3060b0'}},
      prop:{width:60,height:80,grip:{x:30,y:0},nodes:[{id:'case',type:'rect',width:60,height:80,fill:'#ff00ff'}]}});
    for(const hand of assets.person!.nodes.filter(n=>/^hand-[lr]$/.test(n.id)))hand.fill='#ff0000';
    const p=createCanvasProject();p.width=320;p.height=480;p.vectorAssets=assets;
    p.scenes=[{...p.scenes[0]!,durationMs:2000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({width:320,height:480,
      nodes:[{id:'sky',type:'rect',width:320,height:480,fill:'#ffffff'},
        {id:'person',type:'instance',asset:'person',x:70,y:150},
        {id:'prop',type:'instance',asset:'prop'}],
      carries:[{actor:'person',arm:'r',prop:'prop'}],turns:[{actor:'person',to:facing,hold:true}],
      ...(extended?{reaches:[{actor:'person',arm:'r',point:{x:200,y:182},hold:true}]}:{}),
    },assets)}];
    const s=compileVectorProject(p).scenes[0]!,timeMs=1000;
    const html=renderToStaticMarkup(React.createElement(VectorSceneFrame,{scene:s,timeMs,width:320,height:480}));
    const {data,info}=await sharp(Buffer.from(html.match(/<svg[\s\S]*?<\/svg>/)![0])).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const pixel=(x:number,y:number)=>{
      const point=vectorPoint(vectorWorldMatrix('person/hand-r',s,timeMs),x,y);
      const at=(Math.round(point.y)*info.width+Math.round(point.x))*info.channels;
      return [data[at]!,data[at+1]!,data[at+2]!];
    };
    const red=(p:number[])=>p[0]!>240&&p[1]!<20&&p[2]!<20;
    const magenta=(p:number[])=>p[0]!>240&&p[1]!<20&&p[2]!>240;
    assert.equal(red(pixel(-12,0)),facing==='front'||extended,'the body covers the inward hand portion only in rear view');
    assert.equal(magenta(pixel(-12,35)),facing==='front'||extended,'the carried object shares hand depth, not a floating front layer');
    assert.equal(magenta(pixel(22,35)),true,'exposed hardware remains visible; no blanket hand/prop hiding');
    assert.deepEqual(normalizeVectorScene(s.vectorScene,assets),s.vectorScene,'occlusion must not mutate saved geometry');
  }
});

