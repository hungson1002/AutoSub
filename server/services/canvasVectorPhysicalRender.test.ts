import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {createCanvasProject} from '../../shared/canvasAnimationStudio';
import {compileVectorProject,normalizeVectorScene,normalizeVectorAssets,evaluateVectorPart} from '../../shared/canvasVectorScene';
import {renderCanvasPreviewFrames} from './canvasFastRender';
import {resolveBrowserExecutable} from './animationBrowser';
import {animationRenderSourceSignature} from './animationRenderSource';

test('real SVG frames keep a carried prop on the moving hand and extinguish light without losing hardware',async()=>{
  const root=path.resolve('tmp/vector-physical-render-tests');await mkdir(root,{recursive:true});
  const directory=await mkdtemp(path.join(root,'attached-')),executable=resolveBrowserExecutable();assert.ok(executable);
  const p=createCanvasProject();p.width=320;p.height=320;
  p.vectorAssets=normalizeVectorAssets({arm:{width:100,height:100,nodes:[{id:'elbow',type:'group'},
    {id:'hand',type:'ellipse',parent:'elbow',y:40,rx:3,ry:3,fill:'#00ff00'}]},lamp:{rig:'lantern'}});
  // Make the casing independently identifiable while leaving its emitter real.
  p.vectorAssets.lamp!.nodes.find(n=>n.id==='case')!.stroke='#ff0000';
  const base=p.scenes[0]!;
  p.scenes=[{...base,id:'carried',durationMs:1000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({width:320,height:320,
    nodes:[{id:'sky',type:'rect',width:320,height:320,fill:'#000000'},
      {id:'actor',type:'instance',asset:'arm',x:100,y:150,width:100,height:100},
      {id:'prop',type:'ellipse',attachTo:'actor/hand',y:12,rx:6,ry:6,fill:'#ff0000'}],
    camera:[{t:0,x:160,y:180,zoom:1.2}],tracks:[
      {target:'actor',start:0,end:1,frames:[{t:0,dx:0},{t:1,dx:65}]},
      {target:'actor/elbow',start:0,end:1,frames:[{t:0,rotation:0},{t:1,rotation:75}]}]},p.vectorAssets)},
    {...base,id:'light',durationMs:1000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({width:320,height:320,
      nodes:[{id:'sky',type:'rect',width:320,height:320,fill:'#000000'},
        {id:'lamp',type:'instance',asset:'lamp',x:130,y:150,width:60,height:100}],lights:[{target:'lamp',on:false,start:.3,end:.4}]},p.vectorAssets)}];
  p.scenes.push({...p.scenes[0]!,id:'hanging',vectorScene:normalizeVectorScene({...p.scenes[0]!.vectorScene!,
    nodes:p.scenes[0]!.vectorScene!.nodes.map(n=>n.id==='prop'?{...n,type:'rect',x:-4,y:0,width:8,height:30,hang:true,pivotX:4,pivotY:0}:n)},p.vectorAssets)});
  p.scenes.push({...base,id:'floor',durationMs:1000,narration:'',dialogue:undefined,objects:[],vectorScene:normalizeVectorScene({width:320,height:320,
    nodes:[{id:'sky',type:'rect',width:320,height:320,fill:'#000000'},
      {id:'hut',type:'rect',x:20,y:0,width:40,height:80,fill:'#111111'},
      {id:'entrance',type:'rect',x:260,y:0,width:40,height:80,fill:'#111111'}],
    ground:{y:260,targets:[{target:'hut'},{target:'entrance'}]},footsteps:[{id:'trail',from:'entrance',to:'hut',count:5,size:36,hold:true}]},p.vectorAssets)});
  try{
    const project=compileVectorProject(p),sheets=await renderCanvasPreviewFrames(project,directory,{executable,signature:await animationRenderSourceSignature(path.resolve('.')),assetOrigin:'http://127.0.0.1:8787'});
    for(const sheet of sheets){
      const {data,info}=await sharp(sheet.file).removeAlpha().raw().toBuffer({resolveWithObject:true});
      for(let frame=0;frame<sheet.times.length;frame++){
        const left=frame%3*240,top=Math.floor(frame/3)*240;let count=0,sx=0,sy=0,warm=0,marks=0;
        for(let y=0;y<240;y++)for(let x=0;x<240;x++){
          const at=((top+y)*info.width+left+x)*info.channels,r=data[at]!,g=data[at+1]!,b=data[at+2]!;
          if(r>180&&g<40&&b<40){count++;sx+=x;sy+=y;}
          if(r>35&&g>15&&r>g*1.2&&g>b*1.3)warm++;
          if(sheet.sceneId==='floor'&&r<20&&g>r+6&&b>r+6){marks++;assert.ok(y>=184&&y<=215,'filled wet footprints must render at floor level');}
        }
        if(sheet.sceneId==='floor'){assert.ok(marks>50,'footprints must remain visible above the opaque floor');continue;}
        assert.ok(count>20,'prop/casing remains visible');
        if(sheet.sceneId==='carried'){
          const scene=project.scenes[0]!,time=sheet.times[frame]!,angle=evaluateVectorPart('actor/elbow',scene,time).rotation*Math.PI/180;
          const actor=evaluateVectorPart('actor',scene,time),camera=evaluateVectorPart('camera-world',scene,time);
          const x=(100+actor.dx-52*Math.sin(angle))*camera.scaleX+camera.dx;
          const y=(150+52*Math.cos(angle))*camera.scaleY+camera.dy;
          assert.ok(Math.abs(sx/count-x*.75)<1.5,`attached prop x drift at ${time}`);
          assert.ok(Math.abs(sy/count-y*.75)<1.5,`attached prop y drift at ${time}`);
        }else if(sheet.sceneId==='hanging'){
          const scene=project.scenes[2]!,time=sheet.times[frame]!,angle=evaluateVectorPart('actor/elbow',scene,time).rotation*Math.PI/180;
          const actor=evaluateVectorPart('actor',scene,time),camera=evaluateVectorPart('camera-world',scene,time);
          const x=(100+actor.dx-40*Math.sin(angle))*camera.scaleX+camera.dx;
          const y=(150+40*Math.cos(angle)+15)*camera.scaleY+camera.dy;
          assert.ok(Math.abs(sx/count-x*.75)<1.5&&Math.abs(sy/count-y*.75)<1.5,'hanging prop must remain upright at the moving grip');
        }else if(sheet.times[frame]!>450)assert.ok(warm<900,'source/halo must disappear while red casing stays visible');
        else if(sheet.times[frame]!<250)assert.ok(warm>1200,'lit source must actually emit a halo');
      }
    }
  }finally{assert.ok(path.resolve(directory).startsWith(root+path.sep));await rm(directory,{recursive:true,force:true});}
});
