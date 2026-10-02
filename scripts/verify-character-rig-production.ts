import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {parsePlan} from '../server/services/canvasAnimationDirector';
import {run} from '../server/services/ffmpeg';

// Exercise the same plan normalization and render queue as generated films.
const directory=path.resolve('tmp/character-rig-production');
await mkdir(directory,{recursive:true});
const source={name:'Character rig production regression',scenes:['right','left'].map(facing=>({
  name:`Point, sit and phone — ${facing}`,durationMs:3000,background:'room',backgroundRef:'bg:room-stilt-house',
  template:'two-shot',narration:'Kiểm tra tay chỉ, chân ngồi và tư thế cầm điện thoại.',camera:{shot:'medium',motion:'none',focusX:640,focusY:360,zoom:1},
  animationBeats:[],objects:[
    {kind:'character',label:'Pointing',characterKey:'minh',pose:'point',facing,x:270,y:360,width:205,height:320,role:'focal',color:'#687982'},
    {kind:'character',label:'Sitting',characterKey:'duy',pose:'sit',facing,x:640,y:360,width:205,height:320,role:'support',legBandage:'left',color:'#7d8160'},
    {kind:'character',label:'Calling',characterKey:'caller',pose:'talk',facing,x:1010,y:360,width:205,height:320,role:'support',color:'#687982'},
    {kind:'prop',label:'Phone',variant:'phone',heldBy:'caller',width:28,height:64,role:'support'},
  ],
}))};
const project=parsePlan(JSON.stringify(source),'Restrained illustrated horror character rig test');
await writeFile(path.join(directory,'source-plan.json'),JSON.stringify(source,null,2));
await writeFile(path.join(directory,'project.json'),JSON.stringify(project,null,2));
const response=await fetch(`http://127.0.0.1:8787/api/canvas-animation-studio/projects/${project.id}/render-jobs`,{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project}),
});
if(!response.ok)throw new Error(await response.text());
const initial=await response.json() as {id:string};
console.log(`JOB=${initial.id}`);
for(let attempt=0;attempt<600;attempt++){
  await new Promise(resolve=>setTimeout(resolve,1000));
  const job=await (await fetch(`http://127.0.0.1:8787/api/animation-studio/render-jobs/${initial.id}`)).json() as any;
  if(attempt%10===0)console.log(`${job.status} ${job.progress}%`);
  if(job.status==='failed')throw new Error(job.error);
  if(job.status!=='completed')continue;
  const video=path.join(directory,'rig-test.mp4');await copyFile(job.result.path,video);
  const layers=[];
  const secondScene=project.scenes[0]!.durationMs/1000;
  for(const [index,second] of [.4,1.5,secondScene+.4,secondScene+1.5].entries()){
    const file=path.join(directory,`frame-${index}.png`);
    await run('ffmpeg',['-y','-ss',String(second),'-i',video,'-frames:v','1',file]);
    layers.push({input:await sharp(file).resize(960,540).toBuffer(),left:index%2*960,top:Math.floor(index/2)*540});
  }
  await sharp({create:{width:1920,height:1080,channels:3,background:'#192127'}}).composite(layers).png().toFile(path.join(directory,'contact-sheet.png'));
  await run('ffmpeg',['-v','error','-i',video,'-f','null','-']);
  console.log(`VERIFIED=${video}`);break;
}
