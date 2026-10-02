import {mkdir,writeFile,copyFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {run} from '../server/services/ffmpeg';
import {DatabaseSync} from 'node:sqlite';
import {request} from 'node:http';
import {compileCanvasCharacterCostumes} from '../server/services/canvasAnimationDirector';
import {compileCanvasProjectLayout} from '../shared/canvasLayoutCompiler';
function generate(body:object):Promise<any>{
  return new Promise((resolve,reject)=>{
    const req=request('http://127.0.0.1:8787/api/canvas-animation-studio/generate',{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(1200000)},res=>{
      const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
      res.on('end',()=>{try{const result=JSON.parse(Buffer.concat(chunks).toString());if(res.statusCode!==200)reject(new Error(result.error));else resolve(result);}catch(error){reject(error);}});
    });req.on('error',reject);req.end(JSON.stringify(body));
  });
}
const dir=path.resolve('tmp/prompt-production-check');await mkdir(dir,{recursive:true});
const db=new DatabaseSync(path.join(process.env.APPDATA!,'9router/db/data.sqlite'),{readOnly:true});
const credential=db.prepare('SELECT key FROM apiKeys WHERE isActive=1 LIMIT 1').get() as {key:string}|undefined;db.close();
if(!credential)throw new Error('No active local Router API credential.');
const provider={id:'qa-router',name:'9Router QA',baseUrl:'http://127.0.0.1:20128/v1',enabled:true,models:[],providerType:'openai-compatible',authType:'bearer',apiKey:credential.key,capabilities:{translation:true}};
const brief='Tạo video hoạt hình kể chuyện 60 giây: Minh đến thăm bác Duy bị thương ở chân phải. Bác Duy ngồi giữ chân đau, Minh ngồi xuống kiểm tra và băng chân cho bác. Sau đó Minh đứng dậy nghe điện thoại, ra ngoài buộc dây vào thân cây rồi quay lại dìu bác Duy đi chậm. Minh mặc áo xanh, bác Duy mặc áo nâu. Minh họa đầy đủ từng hành động theo lời kể, giữ tạo hình nhân vật nhất quán. Phong cách hoạt hình kể chuyện 2D, diễn xuất rõ ràng.';
const save=async(stage:string,extra={})=>{console.log(stage);await writeFile(path.join(dir,'state.json'),JSON.stringify({stage,...extra},null,2));};
try{
  await save('generating-real-prompt');
  const project=process.env.CANVAS_QA_RERENDER==='1'?compileCanvasProjectLayout(compileCanvasCharacterCostumes(JSON.parse(await readFile(path.join(dir,'project.json'),'utf8')))):await generate({brief,provider,model:process.env.CANVAS_QA_MODEL||'ag/gemini-3.8-flash-high',visualMode:'procedural',targetDurationSeconds:60,
    narration:{provider:{id:'edge-tts-local',name:'Edge TTS',baseUrl:'local://edge-tts',enabled:true,models:[],providerType:'edge-tts',authType:'none',capabilities:{tts:true}},model:'edge-tts',voice:'vi-VN-NamMinhNeural',speed:1},audioProduction:{enabled:true,autoSound:true}});
  await writeFile(path.join(dir,'project.json'),JSON.stringify(project,null,2));
  await save('rendering',{scenes:project.scenes.length,durationMs:project.scenes.reduce((sum:number,s:any)=>sum+s.durationMs,0)});
  const render=await fetch(`http://127.0.0.1:8787/api/canvas-animation-studio/projects/${project.id}/render-jobs`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({project})});
  if(!render.ok)throw new Error(await render.text());
  const initial=await render.json();console.log(`JOB=${initial.id}`);
  for(let i=0;i<900;i++){
    await new Promise(r=>setTimeout(r,1000));
    const job=await(await fetch(`http://127.0.0.1:8787/api/animation-studio/render-jobs/${initial.id}`)).json();
    if(i%20===0)console.log(`${job.status} ${job.progress}%`);
    if(job.status==='failed')throw new Error(job.error);
    if(job.status!=='completed')continue;
    const video=path.join(dir,'prompt-test.mp4');await copyFile(job.result.path,video);
    const duration=project.scenes.reduce((sum:number,s:any)=>sum+s.durationMs,0)/1000;
    await run('ffmpeg',['-y','-i',video,'-vf',`fps=25/${duration},scale=384:216,tile=5x5`,'-frames:v','1',path.join(dir,'contact-sheet.png')]);
    await run('ffmpeg',['-v','error','-i',video,'-f','null','-']);
    await save('completed',{video,scenes:project.scenes.length});process.exit(0);
  }
  throw new Error('Render pending; job preserved.');
}catch(error){await save('failed',{error:String(error)});process.exitCode=1;}
