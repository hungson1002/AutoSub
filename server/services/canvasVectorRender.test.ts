import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {createCanvasProject} from '../../shared/canvasAnimationStudio';
import {compileVectorProject,normalizeVectorScene,normalizeVectorAssets} from '../../shared/canvasVectorScene';
import {renderCanvasPreviewFrames} from './canvasFastRender';
import {resolveBrowserExecutable} from './animationBrowser';
import {animationRenderSourceSignature} from './animationRenderSource';
import {parseVectorPlan} from './canvasVectorDirector';

test('a footprint attached to the boat floor renders above its opaque loose plank',async()=>{
  const root=path.resolve('tmp/vector-render-tests');await mkdir(root,{recursive:true});
  const directory=await mkdtemp(path.join(root,'deck-'));
  const executable=resolveBrowserExecutable();assert.ok(executable);
  const p=parseVectorPlan(JSON.stringify({vectorStages:{river:{template:'folk-river-boat'}},scenes:[{
    durationMs:1000,narration:'Footprint.',vectorScene:{stage:'river',camera:[{t:0,x:330,y:870,zoom:1.8}],
      nodes:[{id:'step',type:'instance',parent:'deck',asset:'folk-wet-footprint',x:300,y:22,width:24,height:20}],
    },
  }]}),'folk-horror',{width:720,height:1280});
  for(const n of p.vectorAssets!['folk-wet-footprint']!.nodes)n.fill='#ff0000';
  try{
    const sheets=await renderCanvasPreviewFrames(compileVectorProject(p),directory,{executable,signature:await animationRenderSourceSignature(path.resolve('.')),assetOrigin:'http://127.0.0.1:8787'});
    const {data,info}=await sharp(sheets[0]!.file).removeAlpha().raw().toBuffer({resolveWithObject:true});
    let red=0;
    for(let i=0;i<data.length;i+=info.channels)if(data[i]!>180&&data[i+1]!<40&&data[i+2]!<40)red++;
    assert.ok(red>150,`the actual foot silhouette must remain visible on the floor; found ${red} red pixels`);
  }finally{assert.ok(path.resolve(directory).startsWith(root+path.sep));await rm(directory,{recursive:true,force:true});}
});

test('native SVG places the solved hand on its actual collar endpoint',async()=>{
  const root=path.resolve('tmp/vector-render-tests');await mkdir(root,{recursive:true});
  const directory=await mkdtemp(path.join(root,'reach-'));
  const executable=resolveBrowserExecutable();assert.ok(executable);
  const p=createCanvasProject();p.width=320;p.height=640;
  p.vectorAssets=normalizeVectorAssets({actor:{rig:'simple-human',nodes:[{id:'hand-r',fill:'#ff0000'}]}});
  p.scenes=[{...p.scenes[0]!,durationMs:1000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({
    width:320,height:640,nodes:[{id:'person',type:'instance',asset:'actor',x:40,y:40,width:240,height:480}],
    reaches:[{actor:'person',arm:'r',point:{x:120,y:182},hold:true}],tracks:[],
  },p.vectorAssets)}];
  try{
    const sheets=await renderCanvasPreviewFrames(compileVectorProject(p),directory,{executable,signature:await animationRenderSourceSignature(path.resolve('.')),assetOrigin:'http://127.0.0.1:8787'});
    const {data,info}=await sharp(sheets[0]!.file).removeAlpha().raw().toBuffer({resolveWithObject:true});
    for(let frame=0;frame<sheets[0]!.times.length;frame++){
      const left=frame%3*240,top=Math.floor(frame/3)*480;let count=0,sx=0,sy=0;
      for(let y=0;y<480;y++)for(let x=0;x<240;x++){
        const at=((top+y)*info.width+left+x)*info.channels;
        if(data[at]!>180&&data[at+1]!<40&&data[at+2]!<40){count++;sx+=x;sy+=y;}
      }
      assert.ok(count>40);assert.ok(Math.abs(sx/count-120)<1);assert.ok(Math.abs(sy/count-166.5)<1);
    }
  }finally{assert.ok(path.resolve(directory).startsWith(root+path.sep));await rm(directory,{recursive:true,force:true});}
});

test('actual frame renderer clips an animated red particle outside the protected caption region',async()=>{
  const root=path.resolve('tmp/vector-render-tests');await mkdir(root,{recursive:true});
  const directory=await mkdtemp(path.join(root,'clip-'));
  const executable=resolveBrowserExecutable();assert.ok(executable,'production browser renderer must be available');
  const p=createCanvasProject();p.width=320;p.height=320;p.vectorAssets={};
  p.scenes=[{...p.scenes[0]!,durationMs:1000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({
    width:320,height:320,nodes:[{id:'sky',type:'rect',width:320,height:320,fill:'#000'},
      {id:'safe',type:'group',clip:{x:0,y:100,width:320,height:220}},
      {id:'particle',type:'ellipse',parent:'safe',x:160,y:180,rx:15,ry:15,fill:'#ff0000'}],
    tracks:[{target:'particle',start:0,end:1,frames:[{t:0,dy:0},{t:1,dy:-200}]}],
  },{})}];
  try{
    const sheets=await renderCanvasPreviewFrames(compileVectorProject(p),directory,{executable,signature:await animationRenderSourceSignature(path.resolve('.')),assetOrigin:'http://127.0.0.1:8787'});
    const {data,info}=await sharp(sheets[0]!.file).removeAlpha().raw().toBuffer({resolveWithObject:true});
    let inside=0,outside=0;
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
      const at=(y*info.width+x)*info.channels;
      if(data[at]!>180&&data[at+1]!<40&&data[at+2]!<40){if(y%240<74)outside++;else inside++;}
    }
    assert.ok(inside>0,'the particle must really render inside the safe region');
    assert.equal(outside,0,'no red pixels may cross into the caption region as the track moves upward');
  }finally{
    assert.ok(path.resolve(directory).startsWith(root+path.sep));await rm(directory,{recursive:true,force:true});
  }
});
test('an eye with an SVG center pivot stays centered while rotating and scaling in real rendered frames',async()=>{
  const root=path.resolve('tmp/vector-render-tests');await mkdir(root,{recursive:true});
  const directory=await mkdtemp(path.join(root,'eye-'));
  const executable=resolveBrowserExecutable();assert.ok(executable);
  const p=createCanvasProject();p.width=320;p.height=320;p.vectorAssets={};
  p.scenes=[{...p.scenes[0]!,durationMs:1000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({
    width:320,height:320,nodes:[{id:'sky',type:'rect',width:320,height:320,fill:'#000'},
      {id:'eye',type:'ellipse',x:160,y:200,pivotX:160,pivotY:200,rotation:18,rx:20,ry:10,fill:'#ff0000'}],
    tracks:[{target:'eye',start:0,end:1,frames:[{t:0,scaleX:1,scaleY:1},{t:1,scaleX:1.4,scaleY:1.4}]}],
  },{})}];
  try{
    const sheets=await renderCanvasPreviewFrames(compileVectorProject(p),directory,{executable,signature:await animationRenderSourceSignature(path.resolve('.')),assetOrigin:'http://127.0.0.1:8787'});
    const {data,info}=await sharp(sheets[0]!.file).removeAlpha().raw().toBuffer({resolveWithObject:true});
    for(let frame=0;frame<sheets[0]!.times.length;frame++){
      const left=frame%3*240,top=Math.floor(frame/3)*240;let count=0,sumX=0,sumY=0;
      for(let y=0;y<240;y++)for(let x=0;x<240;x++){
        const at=((top+y)*info.width+left+x)*info.channels;
        if(data[at]!>180&&data[at+1]!<40&&data[at+2]!<40){count++;sumX+=x;sumY+=y;}
      }
      assert.ok(count>0);assert.ok(Math.abs(sumX/count-120)<1);assert.ok(Math.abs(sumY/count-150)<1);
    }
  }finally{assert.ok(path.resolve(directory).startsWith(root+path.sep));await rm(directory,{recursive:true,force:true});}
});
test('nested joint geometry and attached props move at the scaled actor position in native SVG frames',async()=>{
  const root=path.resolve('tmp/vector-render-tests');await mkdir(root,{recursive:true});
  const directory=await mkdtemp(path.join(root,'joint-'));
  const executable=resolveBrowserExecutable();assert.ok(executable);
  const p=createCanvasProject();p.width=320;p.height=320;
  p.vectorAssets=normalizeVectorAssets({actor:{width:200,height:200,nodes:[{id:'jaw',type:'group',x:50,y:120,children:[{id:'eye',type:'ellipse',rx:10,ry:10,fill:'#ff0000'}]}]}});
  p.scenes=[{...p.scenes[0]!,durationMs:1000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({width:320,height:320,nodes:[{id:'sky',type:'rect',width:320,height:320,fill:'#000'},{id:'person',type:'instance',asset:'actor',x:40,y:80,width:100,height:100},{id:'prop',type:'ellipse',parent:'person',x:150,y:100,rx:10,ry:10,fill:'#00ff00'}],tracks:[{target:'person/jaw',start:0,end:1,frames:[{t:0,dx:0},{t:1,dx:100,easing:'linear'}]}]},p.vectorAssets)}];
  try{
    const sheets=await renderCanvasPreviewFrames(compileVectorProject(p),directory,{executable,signature:await animationRenderSourceSignature(path.resolve('.')),assetOrigin:'http://127.0.0.1:8787'});
    const {data,info}=await sharp(sheets[0]!.file).removeAlpha().raw().toBuffer({resolveWithObject:true});
    for(let frame=0;frame<sheets[0]!.times.length;frame++){
      const left=frame%3*240,top=Math.floor(frame/3)*240;let red=0,green=0,rx=0,ry=0,gx=0,gy=0;
      for(let y=0;y<240;y++)for(let x=0;x<240;x++){
        const at=((top+y)*info.width+left+x)*info.channels;
        if(data[at]!>180&&data[at+1]!<40){red++;rx+=x;ry+=y;}
        if(data[at+1]!>180&&data[at]!<40){green++;gx+=x;gy+=y;}
      }
      assert.ok(red>0&&green>0);
      assert.ok(Math.abs(rx/red-(48.75+sheets[0]!.times[frame]!/1000*37.5))<1);
      assert.ok(Math.abs(ry/red-105)<1);
      assert.ok(Math.abs(gx/green-86.25)<1);assert.ok(Math.abs(gy/green-97.5)<1);
    }
  }finally{assert.ok(path.resolve(directory).startsWith(root+path.sep));await rm(directory,{recursive:true,force:true});}
});

test('a real native SVG camera close-up keeps the actor, boat and mounted prop together',async()=>{
  const root=path.resolve('tmp/vector-render-tests');await mkdir(root,{recursive:true});
  const directory=await mkdtemp(path.join(root,'camera-'));
  const executable=resolveBrowserExecutable();assert.ok(executable);
  const p=createCanvasProject();p.width=320;p.height=320;p.vectorAssets={};
  p.scenes=[{...p.scenes[0]!,durationMs:1000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({
    width:320,height:320,nodes:[{id:'sky',type:'rect',width:320,height:320,fill:'#000'},
      {id:'actor',type:'ellipse',x:160,y:180,rx:15,ry:20,fill:'#fff'},
      {id:'boat',type:'rect',x:80,y:240,width:180,height:25,fill:'#ff0000'},
      {id:'mast',type:'line',x:110,y:170,x2:0,y2:70,stroke:'#00ff00',strokeWidth:5}],
    camera:[{t:0,x:160,y:160,zoom:1},{t:1,x:160,y:200,zoom:1.5}],tracks:[],
  },{})}];
  try{
    const sheets=await renderCanvasPreviewFrames(compileVectorProject(p),directory,{executable,signature:await animationRenderSourceSignature(path.resolve('.')),assetOrigin:'http://127.0.0.1:8787'});
    const {data,info}=await sharp(sheets[0]!.file).removeAlpha().raw().toBuffer({resolveWithObject:true});
    for(let frame=0;frame<sheets[0]!.times.length;frame++){
      const left=frame%3*240,top=Math.floor(frame/3)*240;let boat=0,actor=0,mast=0;
      for(let y=0;y<240;y++)for(let x=0;x<240;x++){
        const at=((top+y)*info.width+left+x)*info.channels,r=data[at]!,g=data[at+1]!,b=data[at+2]!;
        if(r>180&&g<40&&b<40)boat++;
        if(r>180&&g>180&&b>180)actor++;
        if(g>180&&r<40&&b<40)mast++;
      }
      assert.ok(boat>0&&actor>0&&mast>0,'camera cannot erase the boat or its attached context');
    }
  }finally{assert.ok(path.resolve(directory).startsWith(root+path.sep));await rm(directory,{recursive:true,force:true});}
});


test('native export turns a dark authored moon into a bright source with a visible halo',async()=>{
  const root=path.resolve('tmp/vector-render-tests');await mkdir(root,{recursive:true});
  const directory=await mkdtemp(path.join(root,'light-'));
  const executable=resolveBrowserExecutable();assert.ok(executable);
  const p=createCanvasProject();p.width=320;p.height=320;p.vectorAssets={};
  p.scenes=[{...p.scenes[0]!,durationMs:1000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({
    width:320,height:320,nodes:[{id:'sky',type:'rect',width:320,height:320,fill:'#000'},
      {id:'moon',type:'ellipse',x:160,y:160,rx:20,ry:20,fill:'#111',light:{kind:'moon',radius:70}}],tracks:[]}, {})}];
  try{
    const sheets=await renderCanvasPreviewFrames(compileVectorProject(p),directory,{executable,signature:await animationRenderSourceSignature(path.resolve('.')),assetOrigin:'http://127.0.0.1:8787'});
    const {data,info}=await sharp(sheets[0]!.file).removeAlpha().raw().toBuffer({resolveWithObject:true});
    const pixel=(x:number,y:number)=>data[(y*info.width+x)*info.channels]!;
    assert.ok(pixel(120,120)>220,'source must emit light despite its dark authored fill');
    assert.ok(pixel(147,120)>10,'halo must extend beyond the moon silhouette');
    assert.equal(pixel(190,120),0,'halo must stay local rather than brighten the entire sky');
  }finally{assert.ok(path.resolve(directory).startsWith(root+path.sep));await rm(directory,{recursive:true,force:true});}
});
