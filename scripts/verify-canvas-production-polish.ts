import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCanvasObject,type CanvasStudioProject} from '../shared/canvasAnimationStudio';
const root=path.resolve('tmp/chiec-den-cuoi-ban-v3');await mkdir(root,{recursive:true});
const source=JSON.parse(await readFile('tmp/chiec-den-cuoi-ban-v2/project.json','utf8')) as CanvasStudioProject;
const project=structuredClone(source);project.id=randomUUID();project.name='Chiếc đèn cuối bản · chuyển động và khẩu hình mới';
// Migrate the old sailboat staging once; future Director plans use these fields.
for(const scene of project.scenes){
  if(!scene.name.endsWith('memory-ferry'))continue;
  const boat=scene.objects.find(o=>o.kind==='ship')!;boat.assetRef='ship:wooden-ferry';boat.motion='float';boat.motionIntensity=.6;
  for(const [key,seat] of [['father',-.22],['duy',.2]] as const){
    const actor=scene.objects.find(o=>o.characterKey===key)!;actor.onBoat=boat.id;actor.boatSeat=seat;
    actor.height=key==='father'?195:185;actor.width=actor.height*.64;
    if(key==='duy')actor.pose='sit';
  }
  scene.objects=scene.objects.filter(o=>o.id!=='oar');
  const father=scene.objects.find(o=>o.characterKey==='father')!;
  scene.objects.push(createCanvasObject('prop',{id:'oar',variant:'oar',assetRef:'prop:oar',heldBy:father.id,label:'Mái chèo gỗ',x:650,y:450,width:250,height:42,zIndex:boat.zIndex+10,motion:'none',
    keyframes:Array.from({length:Math.ceil(scene.durationMs/800)},(_,i)=>({atMs:i*800,rotation:i%2?18:-12,easing:'ease-in-out'}))}));
}
await writeFile(path.join(root,'project.json'),JSON.stringify(project,null,2),'utf8');
const full=process.argv.includes('--full');
const test={...project,name:project.name+' · kiểm tra',scenes:[project.scenes.find(s=>s.name.endsWith('question'))!,project.scenes.find(s=>s.name.endsWith('planning'))!,project.scenes.find(s=>s.name.endsWith('walking-party'))!,project.scenes.find(s=>s.name.endsWith('memory-ferry'))!]};
const submitted=full?project:test;
await writeFile(path.join(root,full?'submitted-full.json':'submitted-test.json'),JSON.stringify(submitted,null,2),'utf8');
const response=await fetch(`http://127.0.0.1:8787/api/canvas-animation-studio/projects/${submitted.id}/render-jobs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:submitted})});
if(!response.ok)throw new Error(await response.text());
const initial=await response.json() as {id:string};console.log(`JOB=${initial.id}`);
await writeFile(path.join(root,'job.json'),JSON.stringify(initial,null,2));
let previous=-1;
for(let i=0;i<3600;i++){
  await new Promise(r=>setTimeout(r,1000));
  const status=await fetch(`http://127.0.0.1:8787/api/animation-studio/render-jobs/${initial.id}`);
  const job=await status.json() as {status:string;progress:number;error?:string;result?:{path:string}};
  const progress=Math.floor(job.progress);if(progress!==previous){console.log(`RENDER ${progress}% ${job.status}`);previous=progress;}
  if(job.status==='failed')throw new Error(job.error||'Render failed');
  if(job.status==='completed'){
    const output=path.join(root,full?'chiec-den-cuoi-ban-5-phut-v3.mp4':'kiem-tra-khau-hinh-chuyen-dong-do-go.mp4');
    await copyFile(job.result!.path,output);await writeFile(path.join(root,'completed-job.json'),JSON.stringify(job,null,2));
    console.log(`VIDEO=${output}`);process.exit(0);
  }
}
throw new Error('Timed out without canceling the production job');
