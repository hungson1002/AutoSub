import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCanvasObject,type CanvasStudioProject} from '../shared/canvasAnimationStudio';
import {run} from '../server/services/ffmpeg';
const root=path.resolve('tmp/chiec-den-cuoi-ban-v3');
const project=JSON.parse(await readFile(path.join(root,'project.json'),'utf8')) as CanvasStudioProject;
const index=project.scenes.findIndex(s=>s.name.endsWith('hot-water')),scene=project.scenes[index]!;
scene.objects=scene.objects.filter(o=>!['tea-pot','tea-stream','pouring-hand'].includes(o.id));
const grandma=structuredClone(project.scenes.flatMap(s=>s.objects).find(o=>o.characterKey==='lanh')!);
Object.assign(grandma,{x:480,y:410,width:198,height:310,zIndex:24,pose:'point',lookAtId:'hot-cup',motion:'none',keyframes:undefined});
scene.objects.push(grandma,createCanvasObject('prop',{id:'tea-pot',label:'Ấm trà',variant:'teapot',assetRef:'prop:teapot',heldBy:grandma.id,pouringInto:'hot-cup',x:660,y:470,width:140,height:100,zIndex:38,motion:'none',rotation:8}));
scene.camera={shot:'medium',motion:'none',focusX:600,focusY:420,zoom:1.02};
scene.animationBeats=[];
await writeFile(path.join(root,'project.json'),JSON.stringify(project,null,2),'utf8');
const patch={...project,id:randomUUID(),name:'Kiểm tra rót trà',scenes:[scene]};
const response=await fetch(`http://127.0.0.1:8787/api/canvas-animation-studio/projects/${patch.id}/render-jobs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:patch})});
if(!response.ok)throw new Error(await response.text());
const {id}=await response.json() as {id:string};console.log(`JOB=${id}`);
let clip='';
for(let i=0;i<600;i++){
  await new Promise(r=>setTimeout(r,1000));
  const job=await (await fetch(`http://127.0.0.1:8787/api/animation-studio/render-jobs/${id}`)).json() as {status:string;result?:{path:string};error?:string};
  if(job.status==='failed')throw new Error(job.error);
  if(job.status==='completed'){clip=job.result!.path;break;}
}
if(!clip)throw new Error('Render still active');
const start=project.scenes.slice(0,index).reduce((n,s)=>n+Math.round(s.durationMs*30/1000),0),frames=Math.round(scene.durationMs*30/1000),end=start+frames;
const original=path.join(root,'chiec-den-cuoi-ban-5-phut-v3.mp4'),patched=path.join(root,'tea-corrected.mp4');
await run('ffmpeg',['-y','-i',original,'-i',clip,'-filter_complex',`[0:v]trim=end_frame=${start},setpts=PTS-STARTPTS[v0];[1:v]trim=end_frame=${frames},setpts=PTS-STARTPTS[v1];[0:v]trim=start_frame=${end},setpts=PTS-STARTPTS[v2];[v0][v1][v2]concat=n=3:v=1:a=0[v]`,'-map','[v]','-map','0:a','-c:v','libx264','-threads','2','-preset','fast','-crf','18','-r','30','-frames:v','9000','-c:a','copy','-movflags','+faststart',patched]);
await rename(original,path.join(root,'before-tea-correction.mp4'));await rename(patched,original);
await run('ffmpeg',['-y','-ss',String((start+frames*.55)/30),'-i',original,'-frames:v','1',path.join(root,'tea-check.jpg')]);
console.log(`VIDEO=${original}`);process.exit(0);
