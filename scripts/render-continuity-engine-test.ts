import { randomUUID } from 'node:crypto';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { renderCanvasAnimationProject } from '../server/services/animationRender';
import { compileCanvasProjectLayout } from '../shared/canvasLayoutCompiler';

const now=new Date().toISOString();
const actor=(id:string,key:string,x:number,slot:any,role:any='focal',extra:any={})=>({
  id,kind:'character',label:key,characterKey:key,archetype:'worker',hair:key==='minh'?'short':'crop',
  role,slot,depth:'midground',sizeClass:'large',pose:'idle',expression:'neutral',facing:'right',
  x,y:430,width:180,height:320,scale:1,rotation:0,opacity:1,color:key==='minh'?'#607786':'#856b58',
  secondaryColor:'#4d5355',accent:'#282421',zIndex:30,motion:'none',delayMs:0,motionDurationMs:500,
  motionCurve:'smooth',motionIntensity:1,visualStyle:'story',...extra
});
const prop=(id:string,variant:string,x:number,slot:any,role:any='support')=>({
  id,kind:'prop',variant,assetRef:'prop:'+variant,label:variant,role,slot,depth:'midground',sizeClass:'medium',
  x,y:440,width:120,height:100,scale:1,rotation:0,opacity:1,color:'#7b654d',secondaryColor:'#4f443a',
  accent:'#282421',zIndex:22,motion:'none',delayMs:0,motionDurationMs:500,motionCurve:'smooth',motionIntensity:1
});
const scene=(name:string,template:any,objects:any[],camera:any,narration:string)=>({
  id:randomUUID(),name,durationMs:4000,template,background:'room',backgroundRef:'bg:room-study',
  narration,dialogue:[],visualBrief:'continuous indoor conversation; keep spatial continuity unless this shot is an explicit close insert',
  camera,effects:[],animationBeats:[],objects
});
const project:any={
  version:1,id:randomUUID(),name:'Generic continuity engine render test',width:1280,height:720,fps:30,
  createdAt:now,updatedAt:now,sourcePrompt:'generic indoor scene continuity test; not horror specific',
  scenes:[
    scene('Base medium','two-shot',[
      actor('actor:minh','minh',330,'hero-left')
    ],{shot:'medium',motion:'none',focusX:560,focusY:360,zoom:1,keyframes:[{atMs:0,zoom:1,dx:0},{atMs:4000,zoom:1.025,dx:6}]},
    'Minh remains on the left side of the room.'),
    scene('Add focal prop','hero-right',[
      actor('actor:minh','minh',650,'hero-right'),
      prop('prop:lantern','lantern',820,'mid-right','focal')
    ],{shot:'medium',motion:'none',focusX:820,focusY:340,zoom:1.1,keyframes:[{atMs:0,zoom:1.1,dx:-20},{atMs:4000,zoom:1.14,dx:8}]},
    'A lantern is added to the same room without changing the established camera stage.'),
    scene('Add focal actor','hero-right',[
      actor('actor:minh','minh',610,'hero-right'),
      prop('prop:lantern','lantern',820,'mid-right','support'),
      actor('actor:panh','panh',910,'hero-right','focal',{facing:'left'})
    ],{shot:'medium',motion:'none',focusX:850,focusY:350,zoom:1.08,keyframes:[{atMs:0,zoom:1.08,dx:-10},{atMs:4000,zoom:1.11,dx:12}]},
    'A second person enters the same medium shot. The existing actor and camera should not jump.'),
    scene('Intentional close reaction','close-reaction',[
      actor('actor:minh','minh',930,'hero-right','focal',{expression:'surprised',facing:'left'})
    ],{shot:'close-up',motion:'none',focusX:920,focusY:350,zoom:1.22},
    'Intentional close reaction of Minh. This is a real cut, but screen direction must remain stable.')
  ]
};
const compiled=compileCanvasProjectLayout(project);
for(const [index,s] of compiled.scenes.entries()){
  console.log('SCENE',index+1,JSON.stringify({
    template:s.template,shot:s.camera?.shot,focusX:s.camera?.focusX,zoom:s.camera?.zoom,
    objects:s.objects.filter((o:any)=>o.kind!=='text').map((o:any)=>({id:o.id,key:o.characterKey,variant:o.variant,x:o.x,y:o.y,slot:o.slot,facing:o.facing,keyframes:o.keyframes}))
  }));
}
const result=await renderCanvasAnimationProject(compiled,undefined,p=>console.log('progress',Math.round(p*100)));
const qaDir=path.resolve('workdir/qa-tests');
await mkdir(qaDir,{recursive:true});
const out=path.join(qaDir,'generic-continuity-engine-v1.mp4');
await copyFile(result.path,out);
console.log(JSON.stringify({out,source:result.path,size:result.size,cached:result.cached},null,2));
