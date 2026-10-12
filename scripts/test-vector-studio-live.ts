// End-to-end QA: the same generate/export endpoints used by Animation Studio.
// No authored drawings, scene rewrites, asset substitutions or manual audio mix.
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {request} from 'node:http';
import {applyRecipeToBrief,filmRecipeById} from '../shared/filmRecipes';
import type {CanvasStudioProject} from '../shared/canvasAnimationStudio';
import {run} from '../server/services/ffmpeg';

const arg=(name:string,fallback:string)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1]!;};
const output=path.resolve(arg('--output-dir','tmp/vector-studio-auto-30s'));
await mkdir(output,{recursive:true});
async function post<T>(url:string,body:unknown):Promise<T>{
  const payload=JSON.stringify(body);
  return new Promise((resolve,reject)=>{
    const req=request('http://127.0.0.1:8787'+url,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)}},res=>{
      const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(Buffer.from(chunk)));res.on('error',reject);
      res.on('end',()=>{try{const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if((res.statusCode||500)>=400)reject(new Error(value.error||`HTTP ${res.statusCode}`));else resolve(value);}catch(error){reject(error);}});
    });
    req.setTimeout(1800000,()=>req.destroy(new Error('Generation timeout; checkpoint retained')));req.on('error',reject);req.end(payload);
  });
}
let project:CanvasStudioProject;
if(process.argv.includes('--render-existing')){
  const saved=JSON.parse(await readFile(path.resolve(arg('--resume-project',path.join(output,'project.json'))),'utf8'));
  project=saved.project||saved;
  await writeFile(path.join(output,'render-project.json'),JSON.stringify(project,null,2));
}
else{
  const db=new DatabaseSync(path.join(process.env.APPDATA!,'9router/db/data.sqlite'),{readOnly:true});
  const credential=db.prepare('SELECT key FROM apiKeys WHERE isActive=1 LIMIT 1').get() as {key:string}|undefined;db.close();
  if(!credential)throw new Error('No configured AI credential');
  const topic=process.argv.includes('--brief-file')?await readFile(path.resolve(arg('--brief-file','')),'utf8'):
    'Tạo truyện ma 30 giây: người lái đò nghe tiếng gõ dưới thuyền, hành khách thấy dấu chân ướt xuất hiện trên sàn, rồi ngọn đèn tắt và một bàn tay trồi lên bám mạn. Người lái đò đánh chuông khiến bàn tay rút xuống. Trăng và đèn phát sáng rõ; xen toàn cảnh và cảnh cận đổi cỡ ngay trên cùng thuyền. Người đầu trọc, tay gắn đúng hai vai, mắt chớp cùng nhau. Diễn đúng lời kể, có giọng kể, nhạc nền và tiếng động.';
  const resumePath=process.argv.includes('--resume-project')?arg('--resume-project',''):undefined;
  const saved=resumePath?JSON.parse(await readFile(path.resolve(resumePath),'utf8')):undefined;
  const retained:CanvasStudioProject|undefined=saved?.project||saved;
  const brief=(retained?.sourcePrompt?[retained.sourcePrompt,...(process.argv.includes('--brief-file')?[topic]:[])].join('\n\n'):applyRecipeToBrief(topic,filmRecipeById('folk-horror'),'code-vector')).trim().slice(0,12000);
  if(retained&&process.argv.includes('--brief-file'))retained.sourcePrompt=brief;
  await writeFile(path.join(output,'brief.txt'),brief);
  console.log(retained?'Rebuilding retained narration through the real Studio API':'Generating from a new topic through the real Studio API');
  project=await post<CanvasStudioProject>('/api/canvas-animation-studio/generate',{
    brief,width:Number(arg('--width','720')),height:Number(arg('--height','1280')),targetDurationSeconds:Number(arg('--duration','30')),visualMode:'code-vector',
    ...(retained?{project:retained,refineVisuals:process.argv.includes('--refine')}:{}) ,
    provider:{id:'qa-router',name:'9Router',baseUrl:'http://127.0.0.1:20128/v1',enabled:true,models:[],providerType:'openai-compatible',authType:'bearer',apiKey:credential.key},
    model:arg('--model','ag/gemini-3.8-flash-high'),
    narration:{provider:{id:'edge-tts-local',name:'Edge TTS',baseUrl:'local://edge-tts',enabled:true,models:[],providerType:'edge-tts',authType:'none'},model:'edge-tts',voice:'vi-VN-NamMinhNeural',speed:1},
    audioProduction:{enabled:true,autoSound:true},
  });
  await writeFile(path.join(output,'project.json'),JSON.stringify(project,null,2));
  console.log(JSON.stringify({scenes:project.scenes.length,durationMs:project.scenes.reduce((n,s)=>n+s.durationMs,0),review:project.vectorReview}));
}
if(process.argv.includes('--generate-only'))process.exit(0);
// Historical hand-authored fixtures used descriptive IDs; the public export
// endpoint requires the same UUID identity as projects created by the UI.
if(!/^[a-f0-9-]{36}$/i.test(project.id)){
  project={...project,id:randomUUID()};
  await writeFile(path.join(output,'project.json'),JSON.stringify(project,null,2));
}
const job=await post<{id:string}>(`/api/canvas-animation-studio/projects/${project.id}/render-jobs`,{project});
await writeFile(path.join(output,'render-job.json'),JSON.stringify(job,null,2));console.log(`Export job ${job.id}`);
for(let i=0;i<1200;i++){
  await new Promise(resolve=>setTimeout(resolve,1000));
  const status=await (await fetch(`http://127.0.0.1:8787/api/animation-studio/render-jobs/${job.id}`)).json();
  if(i%20===0)console.log(`${status.status} ${status.progress}%`);
  if(status.status==='failed'||status.status==='cancelled')throw new Error(status.error||'Export cancelled');
  if(status.status!=='completed')continue;
  await writeFile(path.join(output,'export.json'),JSON.stringify(status,null,2));
  const video=path.join(output,path.basename(arg('--filename','AutoSub_ToolTuTao_30s.mp4')));
  const response=await fetch(`http://127.0.0.1:8787/api/animation-studio/render-jobs/${job.id}/video`);
  if(!response.ok)throw new Error('Completed video download failed');
  await writeFile(video,Buffer.from(await response.arrayBuffer()));
  await run('ffmpeg',['-v','error','-i',video,'-f','null','-']);
  await writeFile(path.join(output,'probe.json'),(await run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',video])).stdout);
  const seconds=Number(JSON.parse(await readFile(path.join(output,'probe.json'),'utf8')).format.duration);
  await run('ffmpeg',['-v','error','-y','-i',video,'-vf',`fps=${30/seconds},scale=320:${Math.round(320*project.height/project.width)},tile=6x5:padding=4:margin=4`,'-frames:v','1',path.join(output,'overview.jpg')]);
  const destination=path.join(process.env.USERPROFILE!,'Downloads',path.basename(video));await copyFile(video,destination);console.log(destination);process.exit(0);
}
throw new Error('Export pending; project and job retained');
