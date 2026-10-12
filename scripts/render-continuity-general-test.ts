import {randomUUID} from 'node:crypto';
import {copyFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {renderCanvasAnimationProject} from '../server/services/animationRender';
import {compileCanvasProjectLayout} from '../shared/canvasLayoutCompiler';
import {evaluateCanvasCamera,evaluateCanvasObject} from '../src/canvasAnimationStudio/runtime';

const actor=(id:string,key:string,slot:string,role:'focal'|'support'='support')=>({
  id,kind:'character',label:key,characterKey:key,archetype:'worker',hair:key==='lead'?'short':'hat',
  role,slot,depth:'midground',sizeClass:role==='focal'?'large':'medium',
  pose:'idle',expression:'neutral',facing:slot.includes('right')?'left':'right',
  x:640,y:430,width:180,height:320,scale:1,rotation:0,opacity:1,color:key==='lead'?'#6b7f89':'#7c6556',
  secondaryColor:'#4b5050',accent:'#272421',zIndex:30,motion:'none',motionDurationMs:500,motionCurve:'smooth',motionIntensity:1
});
const prop=(id:string,variant:any,slot:string,role:'focal'|'support'='support')=>({
  id,kind:'prop',variant,assetRef:'prop:'+variant,label:variant,role,slot,depth:'midground',sizeClass:role==='focal'?'large':'medium',
  x:640,y:430,width:140,height:110,scale:1,rotation:0,opacity:1,color:'#79644f',secondaryColor:'#4f443a',accent:'#272421',
  zIndex:24,motion:'none',motionDurationMs:500,motionCurve:'smooth',motionIntensity:1
});
const cam=(shot:any='medium',zoom=1)=>({shot,motion:'none',focusX:640,focusY:360,zoom,keyframes:[{atMs:0,zoom},{atMs:4200,zoom:zoom+.025,easing:'ease-in-out'}]});
const scene=(id:string,objects:any[],extra:any={})=>({
  id,name:id,durationMs:4200,background:'room',backgroundRef:'bg:room-study',template:'two-shot',
  narration:'',dialogue:[],visualBrief:'continuous room scene continuity test',camera:cam(),effects:[],animationBeats:[],objects,...extra
});

const project:any={
  version:1,id:randomUUID(),name:'General continuity render',width:1280,height:720,fps:30,
  sourcePrompt:'general editorial animation continuity test',
  scenes:[
    scene('A - established room',[
      actor('lead','lead','hero-left','focal'),
      prop('table','table','mid-center'),
      prop('lamp','lantern','support-right'),
    ]),
    scene('B - add many supports',[
      actor('lead','lead','hero-right','focal'),
      actor('helper','helper','hero-right','support'),
      prop('table','table','support-left'),
      prop('lamp','lantern','support-right'),
      prop('chair','chair','background-left'),
      prop('box','box','background-right'),
      prop('note','note','mid-right'),
    ],{template:'hero-right',camera:cam('wide',1.12)}),
    scene('C - support churn',[
      actor('lead','lead','mid-center','focal'),
      actor('helper','helper','hero-right','support'),
      prop('table','table','foreground-left'),
      prop('rope','rope','support-left'),
      prop('bowl','bowl','support-right'),
      prop('box','box','background-right'),
    ],{template:'wide-establishing',camera:cam('wide',1.08)}),
    scene('D - intentional close insert',[
      actor('lead','lead','hero','focal'),
      prop('phone','phone','support-right'),
    ],{template:'close-reaction',camera:cam('close-up',1.2)}),
  ]
};

const compiled=compileCanvasProjectLayout(project);
for(const [i,s] of compiled.scenes.entries()){
  const lead=s.objects.find((o:any)=>o.characterKey==='lead');
  const c0=evaluateCanvasCamera(s,0,compiled.width,compiled.height),c1=evaluateCanvasCamera(s,s.durationMs,compiled.width,compiled.height);
  const o0=lead?evaluateCanvasObject(lead,s,0):undefined,o1=lead?evaluateCanvasObject(lead,s,s.durationMs):undefined;
  const screen=(o:any,c:any)=>o?{x:c.focusX+(o.x-c.focusX)*c.scale+c.offsetX,y:c.focusY+(o.y-c.focusY)*c.scale+c.offsetY}:undefined;
  console.log('SCENE',i+1,{template:s.template,shot:s.camera?.shot,continuity:s.continuityCameraCharacterKeys,leadX:lead?.x,leadY:lead?.y,leadW:lead?.width,leadH:lead?.height,c0,c1,screen0:screen(o0,c0),screen1:screen(o1,c1)});
}
if(process.env.INSPECT_ONLY==='1')process.exit(0);
const result=await renderCanvasAnimationProject(compiled,undefined,p=>console.log('progress',Math.round(p*100)));
const qaDir=path.resolve('workdir/qa-tests');
await mkdir(qaDir,{recursive:true});
const out=path.join(qaDir,'continuity-general-test-v1.mp4');
await copyFile(result.path,out);
console.log(JSON.stringify({out,size:result.size,cached:result.cached},null,2));
