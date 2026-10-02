import {mkdir,writeFile,copyFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {parsePlan} from '../server/services/canvasAnimationDirector';
import {evaluateCanvasActionCoverage} from '../shared/canvasActionCoverage';
import {run} from '../server/services/ffmpeg';

const directory=path.resolve(process.env.NARRATIVE_TEST_DIR || 'tmp/narrative-actions');await mkdir(directory,{recursive:true});
const actor=(key:string,extra={})=>({kind:'character',label:key,characterKey:key,archetype:'worker',pose:'idle',role:'focal',slot:'mid-left',sizeClass:'large',...extra});
const prop=(variant:string,extra={})=>({kind:'prop',variant,label:variant,role:'support',slot:'mid-right',...extra});
const actionScene=(name:string,narration:string,action:string,target:string,objects:any[])=>({
  name,narration,durationMs:3200,background:'room',backgroundRef:'bg:room-stilt-house',template:'two-shot',
  camera:{shot:'medium',motion:'none',zoom:1},objects,
  animationBeats:[{action,targets:['minh'],focusTargetId:target,speechCue:narration,atMs:200,durationMs:2600}],
});
const source={name:'Narrated physical actions',scenes:[
  actionScene('Lau kính đèn','Minh lau lại kính đèn.','wipe','lantern',[actor('minh'),prop('lantern')]),
  actionScene('Viết giấy','Minh ghi các nhịp sáng vào một tờ giấy mới.','write','note',[actor('minh'),prop('note'),prop('table')]),
  {...actionScene('Buộc dây','Minh buộc dây vào thân cây.','tie','rope',[actor('minh'),prop('rope',{tiedTo:'tree'}),prop('tree')]),background:'night',backgroundRef:'bg:night-rescue-banks'},
  actionScene('Kiểm tra chân','Minh kiểm tra chân bác Duy.','aid','duy',[actor('minh'),actor('duy',{role:'support',slot:'mid-right',pose:'sit',sittingStyle:'injured',legBandage:'right',sizeClass:'large'})]),
  {name:'Dáng ngồi bị thương',narration:'Bác Duy giữ chân đau, còn Minh ngồi trên ghế.',durationMs:3200,background:'room',backgroundRef:'bg:room-stilt-house',template:'two-shot',
    camera:{shot:'medium',motion:'none',zoom:1},animationBeats:[],objects:[actor('duy',{pose:'sit',sittingStyle:'injured',legBandage:'right'}),actor('minh',{role:'support',slot:'mid-right',pose:'sit',sittingStyle:'chair',sizeClass:'large'}),prop('chair')]},
  actionScene('Dìu người','Minh dìu bác Duy đi chậm.','assist','duy',[
    actor('minh'),actor('duy',{role:'support',slot:'mid-right',pose:'run',legBandage:'right',sizeClass:'large',keyframes:[{atMs:0,dx:0},{atMs:3000,dx:100,easing:'ease-in-out'}]}),
  ]),
]};
if(process.env.BANDAGE_STATE_TEST==='1'){
  source.scenes=[
    ['Kiểm tra','Minh kiểm tra chân bác Duy.',0],
    ['Băng chân','Minh băng chân cho bác Duy.',0],
    ['Đã băng','Minh kiểm tra lại chân đã băng.',1],
  ].map(([name,narration,progress],index)=>actionScene(String(name),String(narration),'aid','duy',[
    actor('minh'),actor('duy',{role:'support',slot:'mid-right',pose:'sit',sittingStyle:'injured',legBandage:'right',bandageProgress:progress,sizeClass:'large',
      ...(index===1?{keyframes:[{atMs:0,bandageProgress:0},{atMs:400,bandageProgress:0},{atMs:2400,bandageProgress:1}]}:{})}),
  ]));
}
const project=parsePlan(JSON.stringify(source),'horror illustrated story');
const missing=evaluateCanvasActionCoverage(project);if(missing.length)throw new Error(JSON.stringify(missing));
const old=JSON.parse(await readFile('tmp/chiec-den-cuoi-ban-v3/project.json','utf8'));
await writeFile(path.join(directory,'original-coverage-issues.json'),JSON.stringify(evaluateCanvasActionCoverage(old),null,2));
await writeFile(path.join(directory,'source-plan.json'),JSON.stringify(source,null,2));
await writeFile(path.join(directory,'project.json'),JSON.stringify(project,null,2));
// The existing watched backend may be rebuilding after a shared-source edit.
// Only probe readiness; never retry a potentially dispatched render request.
let ready=false;
for(let attempt=0;attempt<60&&!ready;attempt++){
  try{ready=(await fetch('http://127.0.0.1:8787/api/animation-studio/render-jobs')).ok;}catch{}
  if(!ready)await new Promise(r=>setTimeout(r,1000));
}
if(!ready)throw new Error('Existing backend is not ready; no render was dispatched.');
const response=await fetch(`http://127.0.0.1:8787/api/canvas-animation-studio/projects/${project.id}/render-jobs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project})});
if(!response.ok)throw new Error(await response.text());
const initial=await response.json() as {id:string};console.log(`JOB=${initial.id}`);
let completed=false;
for(let attempt=0;attempt<600;attempt++){
  await new Promise(r=>setTimeout(r,1000));
  const job=await (await fetch(`http://127.0.0.1:8787/api/animation-studio/render-jobs/${initial.id}`)).json() as any;
  if(attempt%10===0)console.log(`${job.status} ${job.progress}%`);
  if(job.status==='failed')throw new Error(job.error);
  if(job.status!=='completed')continue;
  const video=path.join(directory,'actions-test.mp4');await copyFile(job.result.path,video);
  const layers=[];let cursor=0;
  for(const [row,scene] of project.scenes.entries()){
    for(const [column,offset] of [.6,1.4,2.2].entries()){
      const file=path.join(directory,`frame-${row}-${column}.png`);
      await run('ffmpeg',['-y','-ss',String(cursor+offset),'-i',video,'-frames:v','1',file]);
      layers.push({input:await sharp(file).resize(640,360).toBuffer(),left:column*640,top:row*360});
    }
    cursor+=scene.durationMs/1000;
  }
  await sharp({create:{width:1920,height:project.scenes.length*360,channels:3,background:'#192127'}}).composite(layers).png().toFile(path.join(directory,'contact-sheet.png'));
  await run('ffmpeg',['-v','error','-i',video,'-f','null','-']);
  completed=true;console.log(`VERIFIED=${video}`);break;
}
if(!completed)throw new Error('Render timeout; production job left intact.');
